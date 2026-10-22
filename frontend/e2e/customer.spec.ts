import { expect, test } from "@playwright/test";
import { failOnPageErrors, openPage, signIn } from "./helpers";

test("customer requests service with the unified priorities", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signIn(page, "abc@example.com");
  await page.getByRole("button", { name: "Request service" }).click();
  const form = page.locator("form.form");
  await expect(form.locator("select[name=priority] option")).toHaveText(["Low", "Medium", "High", "Urgent"]);
  await form.locator("select[name=machine_id]").selectOption({ label: "Generator G-102" });
  await form.locator("input[name=subject]").fill("Strange noise");
  await form.locator("textarea[name=description]").fill("Knocking at startup");
  await form.getByRole("button", { name: "Send request" }).click();
  await expect(page.locator(".request", { hasText: "Strange noise" })).toContainText("Submitted");
  noErrors();
});

test("customer sees their company and requests", async ({ page }) => {
  await signIn(page, "abc@example.com");
  await openPage(page, "My Company");
  await expect(page.locator(".settingsView")).toContainText("DK Engineering");
  await expect(page.locator(".settingsView")).toContainText("James Mwangi");
  await openPage(page, "Service Requests");
  await expect(page.locator(".subPageList")).toContainText("Generator G-102 overheating issue");
});
