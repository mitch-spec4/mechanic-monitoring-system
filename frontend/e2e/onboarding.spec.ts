import { expect, test, type Page } from "@playwright/test";
import { failOnPageErrors, signIn } from "./helpers";

// Emails are written to the server log in the browser tests; /api/test/outbox reads them back.
test.describe.configure({ mode: "serial" });

async function emailLink(page: Page, to: string, path: "verify" | "reset" | "join") {
  const { emails } = await (await page.request.get("/api/test/outbox")).json();
  const email = emails.find((item: { to: string; text: string }) => item.to === to && item.text.includes(`/#/${path}?`));
  expect(email, `a ${path} email to ${to}`).toBeTruthy();
  return email.text.match(new RegExp(`/#/${path}\\?\\S+`))[0] as string;
}

const demoBar = (page: Page) => page.locator(".demoBar");

test("Try the demo opens a private company that can be seen as each role", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo" }).click();
  const chooser = page.getByRole("dialog", { name: "Try MechanicPro with sample data" });
  await chooser.getByRole("button", { name: /Try as Boss/ }).click();
  await expect(page.getByRole("heading", { name: /James\./ })).toBeVisible();
  await expect(demoBar(page)).toContainText("Demo company.");
  await expect(page.locator(".job")).toHaveCount(6);
  await expect(demoBar(page).getByRole("button", { name: "Boss" })).toHaveAttribute("aria-pressed", "true");

  await demoBar(page).getByRole("button", { name: "Mechanic", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Mitch/ })).toBeVisible();
  await expect(page.locator(".sidebarUser")).toContainText("Mitch Kamau");
  await demoBar(page).getByRole("button", { name: "Customer", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Welcome, ABC." })).toBeVisible();

  // Demo accounts can't be signed into with a password; leaving the demo goes to signup.
  await demoBar(page).getByRole("button", { name: /Start your free trial|Sign up/ }).click();
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  noErrors();
});

test("each role card on the homepage opens the demo as that role", async ({ page }) => {
  await page.goto("/");
  await page.locator(".role", { hasText: "Mechanic" }).getByRole("button", { name: /Try it as Mechanic/ }).click();
  await expect(page.getByRole("heading", { name: /Mitch/ })).toBeVisible();
  await expect(demoBar(page).getByRole("button", { name: "Mechanic", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("a new manager confirms their email, then the setup guide walks them through", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await page.goto("/#/signup?plan=starter");
  await page.getByLabel("Company name").fill("Lake Basin Motors");
  await page.getByLabel("Your name").fill("Achieng Odhiambo");
  await page.getByLabel("Work email").fill("achieng@lakebasin.test");
  await page.getByLabel("Password").fill("lake-basin-1");
  await page.getByRole("button", { name: /Start 14-day free trial/ }).click();

  const banner = page.locator(".verifyBanner");
  await expect(banner).toContainText("We sent a link to achieng@lakebasin.test");
  const guide = page.locator(".setupGuide");
  await expect(guide).toContainText("0 of 5 done");
  // Inviting waits for the email to be confirmed.
  await guide.getByRole("button", { name: "Invite a customer" }).click();
  const invite = page.locator("form.form-upgraded");
  await invite.locator("input[name=name]").fill("Kisumu Mills");
  await invite.locator("input[name=email]").fill("ops@kisumumills.test");
  await invite.getByRole("button", { name: "Generate Invitation Code" }).click();
  await expect(invite.locator(".error")).toContainText("Confirm your email address first");
  await page.getByRole("button", { name: "Close" }).click();
  await banner.getByRole("button", { name: "Resend link" }).click();
  await expect(banner).toContainText("We sent a new link to achieng@lakebasin.test");

  await page.goto(await emailLink(page, "achieng@lakebasin.test", "verify"));
  await expect(page.getByRole("heading", { name: "Email confirmed" })).toBeVisible();
  await page.getByRole("button", { name: "Go to your dashboard" }).click();
  await expect(banner).toHaveCount(0);
  await expect(guide).toContainText("1 of 5 done");

  await guide.getByRole("button", { name: "Invite a customer" }).click();
  await invite.locator("input[name=name]").fill("Kisumu Mills");
  await invite.locator("input[name=email]").fill("ops@kisumumills.test");
  await invite.getByRole("button", { name: "Generate Invitation Code" }).click();
  await expect(page.locator(".modal")).toContainText("We emailed an invitation to ops@kisumumills.test");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(guide).toContainText("2 of 5 done");
  // Machines belong to a customer, so that step waits for one to join.
  await expect(guide.getByRole("button", { name: "Add a machine" })).toBeDisabled();

  await guide.getByRole("button", { name: "Hide the setup guide" }).click();
  await expect(guide).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: /Achieng\./ })).toBeVisible();
  await expect(guide).toHaveCount(0);
  noErrors();
});

test("an emailed invitation link fills in the join form, and a forgotten password is reset by email", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signIn(page, "james@mechanicpro.test");
  await page.getByRole("button", { name: "+ Add mechanic" }).click();
  const invite = page.locator("form.form-upgraded");
  await invite.locator("input[name=name]").fill("Otieno Were");
  await invite.locator("input[name=email]").fill("otieno@dkengineering.test");
  await invite.getByRole("button", { name: "Generate Invitation Code" }).click();
  await expect(page.locator(".modal")).toContainText("We emailed an invitation to otieno@dkengineering.test");
  const code = (await page.getByTestId("share-code").textContent()) ?? "";
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Open profile menu" }).click();
  await page.getByRole("button", { name: "Log out" }).click();

  await page.goto(await emailLink(page, "otieno@dkengineering.test", "join"));
  await expect(page.getByRole("heading", { name: "Join your company" })).toBeVisible();
  await expect(page.getByLabel("Invitation code")).toHaveValue(code);
  await expect(page.getByLabel("Email")).toHaveValue("otieno@dkengineering.test");
  await page.getByLabel("Full name").fill("Otieno Were");
  await page.getByLabel("New password").fill("otieno-first-1");
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.locator(".success")).toContainText("Invitation accepted");
  await expect(page).toHaveURL(/#\/signin$/);

  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page.getByLabel("Email").fill("otieno@dkengineering.test");
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.locator(".success")).toContainText("If an account uses that email");

  await page.goto(await emailLink(page, "otieno@dkengineering.test", "reset"));
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  await page.getByLabel("New password").fill("otieno-second-2");
  await page.getByRole("button", { name: "Set new password" }).click();
  await expect(page.locator(".success")).toContainText("Password updated");
  await expect(page.getByLabel("Email")).toHaveValue("otieno@dkengineering.test");
  await page.getByLabel("Password").fill("otieno-second-2");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".sidebarUser")).toContainText("Otieno Were");
  noErrors();
});

test("a used or broken email link explains itself", async ({ page }) => {
  await page.goto("/#/verify?token=not-a-real-token");
  await expect(page.getByRole("heading", { name: "That link didn't work" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("invalid or has expired");
  await page.goto("/#/reset?token=not-a-real-token");
  await page.getByLabel("New password").fill("whatever-123");
  await page.getByRole("button", { name: "Set new password" }).click();
  await expect(page.getByRole("alert")).toContainText("invalid, expired or already used");
});
