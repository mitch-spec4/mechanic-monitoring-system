import { expect, type Page } from "@playwright/test";

export const DEMO_PASSWORD = "password";

export async function signIn(page: Page, email: string, password = DEMO_PASSWORD) {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".sidebar")).toBeVisible();
}

export async function openPage(page: Page, label: string) {
  await page.locator(".sidebarLink", { hasText: label }).click();
  await expect(page.locator(".subPage h1")).toHaveText(label);
}

/** Fail the test on uncaught page errors. */
export function failOnPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return () => expect(errors, "uncaught page errors").toEqual([]);
}
