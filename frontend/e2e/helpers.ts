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

/** The customer signs on the open sign-off pad, then the job is completed. */
export async function signAndComplete(page: Page, name = "Grace Wanjiru") {
  const dialog = page.getByRole("dialog", { name: "Customer sign-off" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name of the person signing").fill(name);
  const pad = dialog.locator("canvas");
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + box.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 12; step++) {
    await page.mouse.move(box.x + 30 + step * 18, box.y + box.height / 2 + (step % 2 ? -25 : 25));
  }
  await page.mouse.up();
  await dialog.getByRole("button", { name: "Complete job" }).click();
  await expect(dialog.getByRole("status")).toContainText(`Signed by ${name}`);
  await expect(dialog).toHaveCount(0);
}
