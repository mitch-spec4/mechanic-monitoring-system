import { expect, test, type Page } from "@playwright/test";
import { confirmDialog, failOnPageErrors, finishSignIn, forget, openPage, setUpOnNewPhone, setUpTwoFactor, signIn } from "./helpers";

// People who leave, and customers and equipment added by mistake. Every test makes its own people
// and equipment: the database is shared with the other spec files, and the demo team stays as it is.
test.describe.configure({ mode: "serial" });

const TECHNICIAN = { name: "Juma Kiprono", email: "juma@dkengineering.test", password: "juma-first-1" };
const CUSTOMER = { name: "Tana Bottlers", email: "tana@example.com", password: "tana-first-1" };

/** The app's API, as the signed-in person (with the CSRF token the app itself sends). */
async function call(page: Page, method: "get" | "post", path: string, data?: unknown) {
  const token = (await page.context().cookies()).find((cookie) => cookie.name === "csrf_access_token")?.value ?? "";
  return page.request[method](`/api/${path}`, { data, headers: { "X-CSRF-TOKEN": token } });
}

/** Invited by the manager and joined, without going through the emails (onboarding.spec.ts does). */
async function joined(page: Page, person: { name: string; email: string; password: string }, role: string) {
  const invited = await call(page, "post", "customers/invite", { name: person.name, email: person.email, role });
  expect(invited.status()).toBe(201);
  const { code } = await invited.json();
  const accepted = await page.request.post("/api/auth/accept-invitation", {
    data: { code, name: person.name, email: person.email, password: person.password, accept_terms: true },
  });
  expect(accepted.status()).toBe(201);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Open profile menu" }).click();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
}

test("a technician moves two-step sign-in to a new phone, which needs their password", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signIn(page, "james@mechanicpro.test");
  await joined(page, TECHNICIAN, "mechanic");
  await joined(page, CUSTOMER, "customer");
  await forget(page);

  await page.getByLabel("Email").fill(TECHNICIAN.email);
  await page.getByLabel("Password").fill(TECHNICIAN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await setUpTwoFactor(page, TECHNICIAN.email);
  await openPage(page, "Settings");
  const twoStep = page.getByRole("region", { name: "Two-step sign-in" });
  await twoStep.getByRole("button", { name: "Set up on a new phone" }).click();
  await setUpOnNewPhone(page, TECHNICIAN.email, TECHNICIAN.password, "not-my-password");
  await expect(twoStep.locator(".settingsView")).toContainText("10");

  // Only the new phone's codes work from now on.
  await signOut(page);
  await page.getByLabel("Email").fill(TECHNICIAN.email);
  await page.getByLabel("Password").fill(TECHNICIAN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await finishSignIn(page, TECHNICIAN.email);
  noErrors();
});

test("a manager removes a technician who leaves, but not one with open jobs", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signIn(page, "james@mechanicpro.test");
  await openPage(page, "Technicians");
  // Brian has a paused job: it has to go to someone else first.
  const brian = page.locator(".subPageList article", { hasText: "Brian Kariuki" });
  await brian.getByRole("button", { name: "Remove" }).click();
  await confirmDialog(page, "Remove");
  await expect(page.locator(".toast").last()).toContainText("Reassign Brian Kariuki's open jobs first");
  await expect(brian).toBeVisible();

  const juma = page.locator(".subPageList article", { hasText: TECHNICIAN.name });
  await juma.getByRole("button", { name: "Remove" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText(`Remove ${TECHNICIAN.name}?`);
  await expect(dialog).toContainText("They're signed out and can't sign in again.");
  await confirmDialog(page, "Remove");
  await expect(page.locator(".toast").last()).toContainText(`${TECHNICIAN.name} was removed`);
  await expect(juma).toHaveCount(0);

  await openPage(page, "Activity");
  await expect(page.locator(".activityLog li").first()).toContainText(TECHNICIAN.email);
  await forget(page);
  await page.getByLabel("Email").fill(TECHNICIAN.email);
  await page.getByLabel("Password").fill(TECHNICIAN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".error")).toHaveText("Invalid email or password");
  noErrors();
});

test("a manager deletes equipment and a customer added by mistake, but not ones with history", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signIn(page, "james@mechanicpro.test");
  const customers = (await (await call(page, "get", "customers")).json()).customers as { id: number; name: string }[];
  const tana = customers.find((customer) => customer.name === CUSTOMER.name)!;
  const added = await call(page, "post", "machines", { name: "Tana Filler TF-2", serial_no: "TF-2-0001", customer_id: tana.id });
  expect(added.status()).toBe(201);

  await openPage(page, "Equipment");
  await page.locator("main").getByRole("button", { name: "Tana Filler TF-2", exact: true }).click();
  await page.locator(".equipmentActions").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Delete Tana Filler TF-2?");
  await confirmDialog(page, "Delete equipment");
  await expect(page.locator(".toast").last()).toContainText("Tana Filler TF-2 was deleted");
  await expect(page.locator(".subPage h1")).toHaveText("Equipment");
  await expect(page.locator("main").getByRole("button", { name: "Tana Filler TF-2", exact: true })).toHaveCount(0);

  await openPage(page, "Customers");
  // ABC Engineering has equipment and service history: kept.
  const abc = page.locator(".subPageList article", { hasText: "ABC Engineering" });
  await abc.getByRole("button", { name: "Delete" }).click();
  await confirmDialog(page, "Delete customer");
  await expect(page.locator(".toast").last()).toContainText("This customer has equipment or service history and cannot be deleted.");
  await expect(abc).toBeVisible();

  const row = page.locator(".subPageList article", { hasText: CUSTOMER.name });
  await row.getByRole("button", { name: "Delete" }).click();
  await confirmDialog(page, "Delete customer");
  await expect(page.locator(".toast").last()).toContainText(`${CUSTOMER.name} was deleted`);
  await expect(row).toHaveCount(0);
  noErrors();
});
