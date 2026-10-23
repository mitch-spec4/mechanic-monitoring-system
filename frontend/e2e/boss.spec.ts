import { expect, test } from "@playwright/test";
import { confirmDialog, failOnPageErrors, openPage, signIn } from "./helpers";

test.describe.configure({ mode: "serial" });

test("boss creates and assigns a job with a real due date", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signIn(page, "james@mechanicpro.test");
  await page.getByRole("button", { name: "Create job" }).click();
  const form = page.locator("form.form");
  await form.locator("input[name=title]").fill("E2E boiler check");
  await form.locator("textarea[name=description]").fill("Annual check");
  await form.locator("select[name=customer_id]").selectOption({ label: "Kenya Motors" });
  await expect(form.locator("select[name=machine_id] option")).toHaveText([
    "Equipment (optional)",
    "Compressor C-55 (C55-77890)",
    "Hydraulic Pump H-21 (H21-44012)",
  ]);
  await form.locator("select[name=machine_id]").selectOption({ label: "Compressor C-55 (C55-77890)" });
  await form.locator("select[name=mechanic_id]").selectOption({ label: "Amina Otieno" });
  await form.locator("select[name=priority]").selectOption("Low");
  await form.locator("input[name=due_date]").fill("2026-11-05");
  await form.getByRole("button", { name: "Create & notify technician" }).click();

  const created = page.locator(".job", { hasText: "E2E boiler check" });
  await expect(created).toContainText("Due 05 Nov 2026");
  await expect(created).toContainText("Assigned");
  noErrors();
});

test("started jobs can be cancelled but not deleted", async ({ page }) => {
  await signIn(page, "james@mechanicpro.test");
  // Mitch's accepted compressor job: started, so it can be cancelled but not deleted.
  const started = page.locator(".job", { hasText: "Compressor C-55 maintenance" });
  await expect(started).toContainText("Accepted");
  await expect(started.getByTitle("Delete job")).toHaveCount(0);
  await expect(page.locator(".job", { hasText: "Repair Hydraulic Pump H-21" }).getByTitle("Delete job")).toBeVisible();
  await expect(page.locator(".job", { hasText: "Conveyor Line CL-4 inspection" }).getByTitle("Cancel job")).toHaveCount(0);

  await started.getByTitle("Cancel job").click();
  await confirmDialog(page, "Cancel job");
  await expect(started.locator(".status")).toHaveText("Cancelled");
  await expect(started.getByTitle("Cancel job")).toHaveCount(0);
});

test("deleting a started job through the API is still refused", async ({ page }) => {
  await signIn(page, "james@mechanicpro.test");
  const result = await page.evaluate(async () => {
    const csrf = document.cookie.split("; ").find((c) => c.startsWith("csrf_access_token="))?.split("=")[1] ?? "";
    const jobs = await (await fetch("/api/jobs")).json();
    const started = jobs.jobs.find((job: any) => job.status === "In Progress");
    const withoutCsrf = await fetch(`/api/jobs/${started.id}`, { method: "DELETE" });
    const withCsrf = await fetch(`/api/jobs/${started.id}`, { method: "DELETE", headers: { "X-CSRF-TOKEN": csrf } });
    return [withoutCsrf.status, withCsrf.status];
  });
  // A request without the CSRF header is rejected outright; with it, the delete rule applies.
  expect(result).toEqual([401, 409]);
});

test("customers show their machines and which need work", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signIn(page, "james@mechanicpro.test");
  const card = page.locator(".customer-card", { hasText: "ABC Engineering" });
  await expect(card).toContainText("2 pieces of equipment · 2 need work");
  await card.click();

  const customerPage = page.locator(".customerPage");
  await expect(customerPage.locator("h1")).toHaveText("ABC Engineering");
  await expect(customerPage.locator(".needsWorkPill")).toContainText("2 pieces of equipment need work");
  const generator = customerPage.locator(".machineCard", { hasText: "Generator G-102" });
  await expect(generator).toHaveClass(/needsWork/);
  await expect(generator.locator(".workReasons")).toContainText("Service Generator G-102");
  await expect(generator.locator(".workReasons")).toContainText("Customer requested service");

  // Create job fills in this customer and machine.
  await generator.getByRole("button", { name: "Create job" }).click();
  const form = page.locator(".modal", { hasText: "Create service job" });
  await expect(form.locator("select[name=customer_id]")).toHaveValue(/\d+/);
  await expect(form.locator("select[name=customer_id] option:checked")).toHaveText("ABC Engineering");
  await expect(form.locator("select[name=machine_id] option:checked")).toHaveText("Generator G-102 (G102-88421)");
  await expect(form.locator("input[name=title]")).toHaveValue("Service Generator G-102");
  // Creating jobs is covered above; close without saving so later tests see the seeded job list.
  await form.locator(".closeBtn").click();
  await expect(form).toHaveCount(0);

  // A job link opens the job, and Back returns to the customer.
  await generator.locator(".reasonLink", { hasText: "Service Generator G-102" }).click();
  await expect(page.locator(".jobHero h1")).toHaveText("Service Generator G-102");
  await page.getByRole("button", { name: "Back" }).click();
  await expect(customerPage.locator("h1")).toHaveText("ABC Engineering");
  noErrors();
});

test("machines are grouped by customer with a needs-work filter", async ({ page }) => {
  await signIn(page, "james@mechanicpro.test");
  await openPage(page, "Equipment");
  const groups = page.locator(".machineGroup");
  await expect(groups.first()).toBeVisible();
  const xyz = page.locator(".machineGroup", { hasText: "XYZ Factory" });
  // Earlier tests may add machines, so check by name rather than by count.
  await expect(xyz).toContainText("Conveyor Line CL-4");
  await expect(xyz).toContainText("Industrial Mixer MX-08");
  await page.getByLabel("Needs work only").check();
  await expect(xyz).not.toContainText("Conveyor Line CL-4");
  await expect(xyz).toContainText("Industrial Mixer MX-08");
  await xyz.locator(".machineGroupHead .titleLink").click();
  await expect(page.locator(".customerPage h1")).toHaveText("XYZ Factory");
});

test("boss adds a machine and duplicate serials are rejected", async ({ page }) => {
  await signIn(page, "james@mechanicpro.test");
  await openPage(page, "Equipment");
  await page.getByRole("button", { name: /Add equipment/ }).click();
  const form = page.locator("form.form-upgraded");
  await form.locator("select[name=customer_id]").selectOption({ label: "XYZ Factory" });
  await form.locator("input[name=name]").fill("Boiler B-7");
  await form.locator("input[name=serial_no]").fill("C55-77890");
  await form.getByRole("button", { name: "Add equipment" }).click();
  await expect(form.locator(".error")).toContainText("serial number already exists");
  await form.locator("input[name=serial_no]").fill("B7-0001");
  await form.getByRole("button", { name: "Add equipment" }).click();
  await expect(page.locator(".machineGroup", { hasText: "XYZ Factory" })).toContainText("Boiler B-7");
});

test("invited customer joins with the code and signs in", async ({ page, context, browserName }) => {
  // Only Chromium lets tests grant clipboard access; elsewhere the click itself is the user gesture.
  if (browserName === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page, "james@mechanicpro.test");
  await page.getByRole("button", { name: "Add customer" }).click();
  const form = page.locator("form.form-upgraded");
  await form.locator("input[name=name]").fill("Delta Industries");
  await form.locator("input[name=email]").fill("delta@example.com");
  await form.getByRole("button", { name: "Send invitation" }).click();

  const code = (await page.getByTestId("share-code").textContent()) ?? "";
  expect(code).toMatch(/^DK-[0-9A-F]{10}$/);
  const email = page.getByRole("link", { name: "Email this code" });
  await expect(email).toHaveAttribute("href", /^mailto:delta%40example\.com\?subject=/);
  expect(decodeURIComponent((await email.getAttribute("href")) ?? "")).toContain(code);
  await page.getByRole("button", { name: "Copy code" }).click();
  if (browserName === "chromium") await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  else await expect(page.getByRole("button", { name: "Copied" }).or(page.getByText("Copy failed"))).toBeVisible();
  if (browserName === "chromium") expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);
  await page.getByRole("button", { name: "Done" }).click();

  // A fresh visit as someone else: forget the signed-in user and reload on the sign-in page.
  await page.evaluate(() => localStorage.clear());
  await page.goto("/#/signin");
  await page.reload();
  await page.getByRole("button", { name: "Have an invitation code?" }).click();
  await page.getByLabel("Invitation code").fill(code);
  await page.getByLabel("Full name").fill("Delta Industries");
  await page.getByLabel("Email").fill("delta@example.com");
  await page.getByLabel("Password").fill("delta-password");
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.locator(".success")).toContainText("Invitation accepted");

  await page.getByLabel("Email").fill("delta@example.com");
  await page.getByLabel("Password").fill("delta-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Welcome, Delta/ })).toBeVisible();
});

test("boss workspace pages load real data", async ({ page }) => {
  await signIn(page, "james@mechanicpro.test");
  for (const [label, expected] of [
    ["Technicians", "Amina Otieno"],
    ["Notifications", "New service request"],
    ["Reports", "Jobs by status"],
  ]) {
    await openPage(page, label);
    await expect(page.locator(".subPage")).toContainText(expected);
  }
  await expect(page.locator(".sidebarStats")).toContainText("Customers");
  await expect(page.locator(".sidebarStats")).not.toContainText("147");
});

test("inviting an email that already has an account is refused immediately", async ({ page }) => {
  await signIn(page, "james@mechanicpro.test");
  await page.getByRole("button", { name: "+ Add technician" }).click();
  const form = page.locator("form.form-upgraded");
  await form.locator("input[name=name]").fill("Amina again");
  await form.locator("input[name=email]").fill("amina@mechanicpro.test");
  await form.getByRole("button", { name: "Send invitation" }).click();
  await expect(form.locator(".error")).toHaveText("This email address already has an account");
});

test("boss edits a job", async ({ page }) => {
  await signIn(page, "james@mechanicpro.test");
  const job = page.locator(".job", { hasText: "Repair Hydraulic Pump H-21" });
  await job.getByTitle("Edit job").click();
  const form = page.locator(".modal form");
  await form.locator("input[name=title]").fill("Repair Hydraulic Pump H-21 (seal)");
  await form.locator("select[name=priority]").selectOption("Urgent");
  await form.locator("input[name=due_date]").fill("2026-12-03");
  await form.getByRole("button", { name: "Save changes" }).click();
  const edited = page.locator(".job", { hasText: "Repair Hydraulic Pump H-21 (seal)" });
  await expect(edited).toContainText("Due 03 Dec 2026");
});

test("boss edits a machine and a customer", async ({ page }) => {
  await signIn(page, "james@mechanicpro.test");
  await openPage(page, "Equipment");
  await page.locator(".machineCard", { hasText: "Industrial Mixer MX-08" }).getByRole("button", { name: "Edit" }).click();
  const machineForm = page.locator(".modal form");
  await machineForm.locator("select[name=status]").selectOption("Under Repair");
  await machineForm.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".machineCard", { hasText: "Industrial Mixer MX-08" }).locator(".machineStatus")).toHaveText("Under Repair");

  await openPage(page, "Customers");
  await page.locator(".subPageList article", { hasText: "Kenya Motors" }).getByRole("button", { name: "Edit" }).click();
  const customerForm = page.locator(".modal form");
  await customerForm.locator("input[name=phone]").fill("+254 711 000 111");
  await customerForm.locator("input[name=name]").fill("");
  await customerForm.locator("input[name=name]").fill("Kenya Motors Ltd");
  await customerForm.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".subPageList")).toContainText("Kenya Motors Ltd");
});

test("manager reset code lets a customer choose a new password", async ({ page }) => {
  await signIn(page, "james@mechanicpro.test");
  await openPage(page, "Technicians");
  await expect(page.locator(".subPageList article", { hasText: "Brian Kariuki" }).getByRole("button", { name: "Reset password" })).toBeVisible();
  await openPage(page, "Customers");
  await page.locator(".subPageList article", { hasText: "Kenya Motors" }).getByRole("button", { name: "Reset password" }).click();
  await page.getByRole("button", { name: "Create reset code" }).click();
  const code = (await page.getByTestId("share-code").textContent()) ?? "";
  expect(code).toMatch(/^RS-[0-9A-F]{10}$/);
  await expect(page.getByRole("link", { name: "Email this code" })).toHaveAttribute("href", /^mailto:kenya%40example\.com/);
  await page.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: "Open profile menu" }).click();
  await page.getByRole("button", { name: "Log out" }).click();
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page.getByRole("button", { name: "Have a reset code from your manager?" }).click();
  await page.getByLabel("Reset code").fill(code);
  await page.getByLabel("Email").fill("kenya@example.com");
  await page.getByLabel("New password").fill("kenya-new-password");
  await page.getByRole("button", { name: "Set new password" }).click();
  await expect(page.locator(".success")).toContainText("Password updated");
  await signIn(page, "kenya@example.com", "kenya-new-password");
});

test("boss creates a checklist and uses it as a job type", async ({ page }) => {
  await signIn(page, "james@mechanicpro.test");
  await openPage(page, "Checklists");
  await page.getByRole("button", { name: "New checklist" }).click();
  const editor = page.locator(".checklistEditor");
  await editor.getByLabel("Job type").fill("Installation");
  await editor.getByLabel("Item 1", { exact: true }).fill("Confirm mounting points");
  await editor.getByRole("button", { name: "+ Add item" }).click();
  await editor.getByLabel("Item 2", { exact: true }).fill("Commissioning test");
  await editor.locator(".checklistRow").nth(1).getByLabel("Required").check();
  await editor.getByRole("button", { name: "Save checklist" }).click();
  const card = page.locator(".checklistCard", { hasText: "Installation" });
  await expect(card).toContainText("2 items");
  await expect(card.locator("em")).toHaveCount(2);

  await page.locator(".sidebarLink", { hasText: "Dashboard" }).click();
  await page.getByRole("button", { name: "Create job" }).click();
  const form = page.locator("form.form");
  await form.locator("input[name=title]").fill("Install new compressor");
  await form.locator("textarea[name=description]").fill("Fit and commission");
  await form.locator("select[name=mechanic_id]").selectOption({ label: "Amina Otieno" });
  await form.locator("select[name=job_type]").selectOption("Installation");
  await form.getByRole("button", { name: "Create & notify technician" }).click();
  await page.locator(".job", { hasText: "Install new compressor" }).locator(".titleLink").click();
  await expect(page.locator(".jobHero .eyebrow")).toContainText("Installation");
  await expect(page.locator(".jobCard", { hasText: "Checklist" })).toContainText("The checklist appears when work starts.");
});
