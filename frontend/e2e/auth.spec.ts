import { expect, test } from "@playwright/test";
import { openPage, signIn } from "./helpers";

test("sign-in page shows no demo credentials", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("MechanicPro");
  await expect(page.getByLabel("Email")).toHaveValue("");
  await expect(page.getByLabel("Password")).toHaveValue("");
  await expect(page.getByText(/demo accounts/i)).toHaveCount(0);
  await expect(page.getByText("@mechanicpro.test")).toHaveCount(0);
});

test("wrong password shows an error", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("james@mechanicpro.test");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".error")).toHaveText("Invalid email or password");
});

test("session cookies are httpOnly and never exposed to page scripts", async ({ page, context }) => {
  await signIn(page, "abc@example.com");
  const cookies = await context.cookies();
  for (const name of ["access_token_cookie", "refresh_token_cookie"]) {
    expect(cookies.find((cookie) => cookie.name === name)?.httpOnly, name).toBe(true);
  }
  const visible = await page.evaluate(() => document.cookie + JSON.stringify(localStorage));
  expect(visible).not.toContain("access_token_cookie");
  expect(visible).not.toMatch(/eyJ[\w-]+\.[\w-]+\./); // no JWT anywhere scripts can read
});

test("an expired access token is refreshed silently", async ({ page, context }) => {
  await signIn(page, "abc@example.com");
  await context.clearCookies({ name: "access_token_cookie" });
  await openPage(page, "My Machines");
  await expect(page.locator(".subPageList")).toContainText("Generator G-102");
});

test("a failed refresh signs the user out", async ({ page, context }) => {
  await signIn(page, "abc@example.com");
  await context.clearCookies();
  await page.locator(".sidebarLink", { hasText: "Service History" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("signing out ends the session on the server", async ({ page }) => {
  await signIn(page, "kenya@example.com");
  await page.getByRole("button", { name: "Open profile menu" }).click();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  const status = await page.evaluate(async () => (await fetch("/api/jobs", { credentials: "include" })).status);
  expect(status).toBe(401);
});

test("user changes their own password in Settings", async ({ page }) => {
  await signIn(page, "xyz@example.com");
  await openPage(page, "Settings");
  const form = page.locator("form.changePassword");
  await form.getByLabel("Current password").fill("password");
  await form.getByLabel("New password", { exact: true }).fill("xyz-new-password");
  await form.getByLabel("Confirm new password").fill("xyz-different");
  await form.getByRole("button", { name: "Update password" }).click();
  await expect(form.locator(".error")).toHaveText("The new passwords do not match");
  await form.getByLabel("Confirm new password").fill("xyz-new-password");
  await form.getByRole("button", { name: "Update password" }).click();
  await expect(form.locator(".success")).toContainText("Password changed");
  await openPage(page, "My Machines"); // still signed in here
  await expect(page.locator(".subPageList")).toContainText("Conveyor Line CL-4");
  await page.getByRole("button", { name: "Open profile menu" }).click();
  await page.getByRole("button", { name: "Log out" }).click();
  await signIn(page, "xyz@example.com", "xyz-new-password");
});
