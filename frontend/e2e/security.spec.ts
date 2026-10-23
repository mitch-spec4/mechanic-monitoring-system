import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { confirmDialog, DEMO_PASSWORD, failOnPageErrors, finishSignIn, openPage, setUpTwoFactor, signIn } from "./helpers";

// Two-step sign-in, the activity log, exporting and deleting a company, and the legal pages.
// Each test puts back what it changes: the database is shared with the other spec files.
test.describe.configure({ mode: "serial" });

const signOut = async (page: import("@playwright/test").Page) => {
  await page.getByRole("button", { name: "Open profile menu" }).click();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
};

test("the privacy policy and terms are public pages linked from the homepage", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await page.goto("/");
  await page.locator(".siteFooter").getByRole("link", { name: "Privacy policy" }).click();
  await expect(page).toHaveURL(/#\/privacy$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy policy");
  await expect(page.locator(".legalVersion")).toHaveText("Version: draft-1");
  await page.goto("/#/terms");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Terms of service");
  await page.getByRole("button", { name: "Back to the homepage" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Run your service team from one place.");
  // Signing up needs the "I agree" box; its links open the pages in a new tab.
  await page.goto("/#/signup");
  const agreement = page.locator(".termsAgreement");
  await expect(agreement.getByRole("link", { name: "privacy policy" })).toHaveAttribute("href", "#/privacy");
  await expect(agreement.getByRole("link", { name: "terms of service" })).toHaveAttribute("target", "_blank");
  noErrors();
});

test("a new browser asks for the sign-in code; a remembered one doesn't", async ({ page, context }) => {
  await page.goto("/#/signin");
  await page.getByLabel("Email").fill("mitch@mechanicpro.test");
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Enter your sign-in code" })).toBeVisible();
  await page.getByLabel("Sign-in code").fill("000000");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("alert")).toContainText("That code didn't work");
  // The right code, with "Remember this device for 30 days" ticked.
  await finishSignIn(page, "mitch@mechanicpro.test");
  const device = (await context.cookies()).find((cookie) => cookie.name === "mp_device");
  expect(device?.httpOnly).toBe(true);
  expect(device?.path).toBe("/api/auth/");

  await signOut(page);
  await page.getByLabel("Email").fill("mitch@mechanicpro.test");
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator(".codeInput")).toHaveCount(0);
});

test("a manager resets a technician's two-step sign-in and sees it in the activity log", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signIn(page, "james@mechanicpro.test");
  await openPage(page, "Technicians");
  const amina = page.locator(".subPageList article", { hasText: "Amina Otieno" });
  await amina.getByRole("button", { name: "Reset two-step sign-in" }).click();
  await confirmDialog(page, "Reset");
  await expect(page.locator(".toast")).toContainText("Two-step sign-in reset for Amina Otieno");
  await expect(amina.getByRole("button", { name: "Reset two-step sign-in" })).toHaveCount(0);

  await openPage(page, "Activity");
  const latest = page.locator(".activityLog li").first();
  await expect(latest).toContainText("Reset two-step sign-in");
  await expect(latest).toContainText("James Mwangi · amina@mechanicpro.test");
  await expect(page.locator(".activityLog")).toContainText("Signed in");
  await signOut(page);

  // Amina sets it up again with her phone before she can do anything else.
  await page.getByLabel("Email").fill("amina@mechanicpro.test");
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await setUpTwoFactor(page, "amina@mechanicpro.test");
  await expect(page.locator(".sidebarUser")).toContainText("Amina Otieno");
  noErrors();
});

test("a manager exports the company's data as a ZIP", async ({ page }) => {
  await signIn(page, "james@mechanicpro.test");
  await openPage(page, "Settings");
  const section = page.getByRole("form", { name: "Export your data" });
  await section.getByLabel("Current password").fill("not-my-password");
  await section.getByRole("button", { name: "Download my data" }).click();
  await expect(section.locator(".error")).toHaveText("Your current password is incorrect");

  await section.getByLabel("Current password").fill(DEMO_PASSWORD);
  const download = page.waitForEvent("download");
  await section.getByRole("button", { name: "Download my data" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^mechanicpro-DK-Engineering-\d{4}-\d{2}-\d{2}\.zip$/);
  const zip = readFileSync((await file.path())!).toString("latin1");
  expect(zip.startsWith("PK")).toBe(true);
  for (const name of ["jobs.csv", "customers.csv", "files.csv", "data.json", "README.txt"]) expect(zip).toContain(name);
  await expect(page.locator(".toast")).toContainText("Your data is downloading");
});

test("a manager deletes the company, signs in with a backup code, and cancels", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  // A company of its own, so the shared demo company is never at risk.
  await page.goto("/#/signup?plan=starter");
  await page.getByLabel("Company name").fill("Coast Generators");
  await page.getByLabel("Your name").fill("Baraka Mwangi");
  await page.getByLabel("Work email").fill("baraka@coastgen.test");
  await page.getByLabel("Password").fill("coast-gen-1");
  await page.getByLabel(/I agree to the privacy policy/).check();
  await page.getByRole("button", { name: /Start 14-day free trial/ }).click();
  const backupCodes = await setUpTwoFactor(page, "baraka@coastgen.test");

  await openPage(page, "Settings");
  const danger = page.locator(".dangerZone");
  const deleteButton = danger.getByRole("button", { name: "Delete my company" });
  await danger.getByLabel("Type Coast Generators to confirm").fill("coast generators");
  await danger.getByLabel("Current password").fill("coast-gen-1");
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();
  await confirmDialog(page, "Delete my company");
  // Everyone is signed out, this browser too.
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.locator(".toast")).toContainText("Coast Generators will be deleted on");

  // Without the phone: a backup code instead of the app's code.
  await page.getByLabel("Email").fill("baraka@coastgen.test");
  await page.getByLabel("Password").fill("coast-gen-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Sign-in code").fill(backupCodes[0]);
  await page.getByRole("button", { name: "Verify" }).click();
  const banner = page.locator(".deletionBanner");
  await expect(banner).toContainText("Your company and everything in it will be deleted on");
  await banner.getByRole("button", { name: "Cancel the deletion" }).click();
  await expect(page.locator(".toast").last()).toContainText("Your company won't be deleted.");
  await expect(banner).toHaveCount(0);

  await openPage(page, "Activity");
  await expect(page.locator(".activityLog li").first()).toContainText("Cancelled deleting the company");
  await expect(page.locator(".activityLog")).toContainText("Asked to delete the company");
  await expect(page.locator(".activityLog")).toContainText("Set up two-step sign-in");

  // The backup code is spent; new ones replace the rest.
  await openPage(page, "Settings");
  const twoStep = page.getByRole("region", { name: "Two-step sign-in" });
  await expect(twoStep.locator(".settingsView")).toContainText("On");
  await expect(twoStep.locator(".settingsView")).toContainText("9");
  await twoStep.getByRole("button", { name: "New backup codes" }).click();
  const dialog = page.getByRole("dialog", { name: "New backup codes" });
  await dialog.getByLabel("Current password").fill("coast-gen-1");
  await dialog.getByRole("button", { name: "Make new backup codes" }).click();
  await expect(dialog.getByTestId("backup-codes").locator("code")).toHaveCount(10);
  await dialog.getByRole("button", { name: "I've saved my backup codes" }).click();
  await expect(twoStep.locator(".settingsView")).toContainText("10");
  noErrors();
});
