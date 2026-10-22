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

test("an expired access token is refreshed silently", async ({ page }) => {
  await signIn(page, "abc@example.com");
  await page.evaluate(() => localStorage.setItem("token", "expired.or.invalid"));
  await openPage(page, "My Machines");
  await expect(page.locator(".subPageList")).toContainText("Generator G-102");
});

test("a failed refresh signs the user out", async ({ page }) => {
  await signIn(page, "abc@example.com");
  await page.evaluate(() => {
    localStorage.setItem("token", "bad");
    localStorage.setItem("refreshToken", "bad");
  });
  await page.locator(".sidebarLink", { hasText: "Service History" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});
