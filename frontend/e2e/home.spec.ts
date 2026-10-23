import { expect, test } from "@playwright/test";
import { failOnPageErrors } from "./helpers";

// New companies sign up here; each test uses its own email.
test.describe.configure({ mode: "serial" });

async function fillSignup(page: import("@playwright/test").Page, email: string) {
  await page.getByLabel("Company name").fill("Rift Valley Power");
  await page.getByLabel("Your name").fill("Wanjiku Kamau");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("rift-valley-1");
}

test("the homepage explains the product and shows the plans", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Every service job");
  await expect(page.locator(".roleCard h3")).toHaveText(["For the manager", "For the mechanic", "For the customer"]);
  const pricing = page.locator("#pricing");
  await expect(pricing.locator(".planCard h3")).toHaveText(["Starter", "Team", "Business"]);
  await expect(pricing.locator(".planCard").nth(1).locator(".planPrice strong")).toHaveText("$49");
  await pricing.getByRole("button", { name: /Yearly/ }).click();
  await expect(pricing.locator(".planCard").nth(1).locator(".planBilled")).toContainText("$490 billed yearly");
  await pricing.locator(".planCard").first().getByRole("button", { name: "Start free trial" }).click();
  await expect(page).toHaveURL(/#\/signup\?plan=starter&interval=year/);
  await expect(page.locator(".planPicker label.chosen")).toContainText("Starter");
  await expect(page.locator(".signupSummary")).toContainText("$190");

  await page.getByRole("button", { name: "Sign in" }).first().click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  noErrors();
});

test("a new company starts a free trial, then pays from Billing", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await page.goto("/#/signup?plan=team");
  await fillSignup(page, "wanjiku@riftpower.test");
  await page.getByRole("button", { name: /Start 14-day free trial/ }).click();
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator(".planBanner")).toContainText("14 days left");

  await page.locator(".sidebarLink", { hasText: "Billing" }).click();
  await expect(page.locator(".planStatus")).toContainText("Team plan");
  await expect(page.locator(".planStatus")).toContainText("Free trial");
  await expect(page.locator(".meter").first()).toContainText("0 of 10");
  await page.locator(".planCard", { hasText: "Team" }).getByRole("button", { name: "Pay for Team" }).click();

  await expect(page.locator(".testBanner")).toBeVisible();
  await page.getByRole("button", { name: "Try a declined card" }).click();
  await expect(page.locator(".checkoutCard .error")).toContainText("declined");
  await page.getByRole("button", { name: /Pay \$49/ }).click();
  await expect(page.getByRole("heading", { name: "Payment received" })).toBeVisible();
  await page.getByRole("button", { name: "Go to your dashboard" }).click();
  await expect(page.locator(".planStatus")).toContainText("Active");
  await expect(page.locator(".paymentTable")).toContainText("$49");
  noErrors();
});

test("paying at signup skips the trial", async ({ page }) => {
  await page.goto("/#/signup?plan=business&interval=year");
  await fillSignup(page, "accounts@riftpower.test");
  await page.getByRole("button", { name: "Pay now and skip the trial" }).click();
  await expect(page.locator(".orderSummary")).toContainText("Business · Yearly");
  await expect(page.locator(".orderTotal")).toContainText("$990");
  await page.getByRole("button", { name: /Pay \$990/ }).click();
  await expect(page.getByRole("heading", { name: "Payment received" })).toBeVisible();
  await page.getByRole("button", { name: "Go to your dashboard" }).click();
  await expect(page.locator(".planStatus")).toContainText("Business plan");
  await expect(page.locator(".planStatus")).toContainText("Active");
});

test("signup refuses an email that already has an account", async ({ page }) => {
  await page.goto("/#/signup");
  await fillSignup(page, "james@mechanicpro.test");
  await page.getByRole("button", { name: /Start 14-day free trial/ }).click();
  await expect(page.getByRole("alert")).toContainText("already exists");
});
