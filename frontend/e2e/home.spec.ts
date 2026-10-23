import { expect, test } from "@playwright/test";
import { DEMO_PASSWORD, failOnPageErrors, finishSignIn, setUpTwoFactor } from "./helpers";

// New companies sign up here; each test uses its own email.
test.describe.configure({ mode: "serial" });

async function fillSignup(page: import("@playwright/test").Page, email: string) {
  await page.getByLabel("Company name").fill("Rift Valley Power");
  await page.getByLabel("Your name").fill("Wanjiku Kamau");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("rift-valley-1");
  await page.getByLabel(/I agree to the privacy policy/).check();
}

test("the homepage explains the product and shows the plans", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Run your service team from one place.");
  await expect(page.locator(".preview .sample")).toHaveText("Sample data");
  await expect(page.locator(".role h3")).toHaveText(["Boss / Manager", "Technician", "Customer"]);
  const pricing = page.locator("#subscriptions");
  await expect(pricing.locator(".plan h3")).toHaveText(["Starter", "Professional", "Business"]);
  await expect(pricing.locator(".plan.popular .tag")).toHaveText("Recommended");
  await expect(pricing.locator(".plan").nth(1).locator(".price")).toContainText("KSh 4,500");
  await expect(pricing.locator(".compare tbody tr").first()).toContainText("Up to 30");
  // Features that aren't built yet say so.
  await expect(pricing.locator(".plan").nth(2).locator("li.planned").first()).toContainText("Planned");
  await pricing.getByRole("button", { name: /Yearly/ }).click();
  await expect(pricing.locator(".plan").nth(1).locator(".price")).toContainText("KSh 45,000");
  await expect(pricing.locator(".plan").nth(1).locator(".yearNote")).toContainText("Save KSh 9,000 a year");
  await pricing.getByRole("button", { name: "Choose Starter" }).click();
  await expect(page).toHaveURL(/#\/signup\?plan=starter&interval=year/);
  await expect(page.locator(".planPicker label.chosen")).toContainText("Starter");
  await expect(page.locator(".signupSummary")).toContainText("KSh 15,000");

  await page.getByRole("button", { name: "Log in" }).first().click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await page.getByRole("button", { name: "Back to the homepage" }).click();
  await page.getByRole("button", { name: "Get started" }).click();
  await expect(page.locator(".planPicker label.chosen")).toContainText("Professional");
  noErrors();
});

test("a new company starts a free trial, then pays from Billing", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await page.goto("/#/signup?plan=professional");
  await fillSignup(page, "wanjiku@riftpower.test");
  await page.getByRole("button", { name: /Start 14-day free trial/ }).click();
  // Two-step sign-in is set up before anything else.
  await setUpTwoFactor(page, "wanjiku@riftpower.test");
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator(".planBanner")).toContainText("14 days left");

  await page.locator(".sidebarLink", { hasText: "Billing" }).click();
  await expect(page.locator(".planStatus")).toContainText("Professional plan");
  await expect(page.locator(".planStatus")).toContainText("Free trial");
  await expect(page.locator(".meter").first()).toContainText("0 of 10");
  await page.locator(".planCard", { hasText: "Professional" }).getByRole("button", { name: "Pay for Professional" }).click();

  await expect(page.locator(".testBanner")).toBeVisible();
  await page.getByRole("button", { name: "Try a declined card" }).click();
  await expect(page.locator(".checkoutCard .error")).toContainText("declined");
  await page.getByRole("button", { name: "Pay KSh 4,500" }).click();
  await expect(page.getByRole("heading", { name: "Payment received" })).toBeVisible();
  await page.getByRole("button", { name: "Go to your dashboard" }).click();
  await expect(page.locator(".planStatus")).toContainText("Active");
  await expect(page.locator(".paymentTable")).toContainText("KSh 4,500");
  noErrors();
});

test("paying at signup skips the trial", async ({ page }) => {
  await page.goto("/#/signup?plan=business&interval=year");
  await fillSignup(page, "accounts@riftpower.test");
  await page.getByRole("button", { name: "Pay now and skip the trial" }).click();
  await setUpTwoFactor(page, "accounts@riftpower.test");
  await expect(page.locator(".orderSummary")).toContainText("Business · Yearly");
  await expect(page.locator(".orderTotal")).toContainText("KSh 120,000");
  await page.getByRole("button", { name: "Pay KSh 120,000" }).click();
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

test("a manager changes plan from the homepage", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await page.goto("/");
  const switcher = page.locator(".switcher");
  await switcher.getByRole("combobox", { name: "Choose a subscription plan" }).selectOption("business");
  await switcher.getByRole("button", { name: "Continue to Billing" }).click();
  await expect(page).toHaveURL(/#\/signin\?next=billing&plan=business/);
  await page.getByLabel("Email").fill("james@mechanicpro.test");
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await finishSignIn(page, "james@mechanicpro.test");
  await expect(page.locator(".billingPage")).toBeVisible();
  await expect(page.locator(".planCard.focused h3")).toHaveText("Business");
  await expect(page.locator(".planCard.focused")).toContainText("KSh 12,000");
  noErrors();
});

test("signing in from a checkout comes back to it", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await page.goto("/#/signup?plan=starter");
  await fillSignup(page, "finance@riftpower.test");
  await page.getByRole("button", { name: "Pay now and skip the trial" }).click();
  await setUpTwoFactor(page, "finance@riftpower.test");
  await expect(page.locator(".orderSummary")).toContainText("Starter · Monthly");
  // The session ends, then the same checkout link is opened.
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole("heading", { name: "Log in to finish paying" })).toBeVisible();
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByLabel("Email").fill("finance@riftpower.test");
  await page.getByLabel("Password").fill("rift-valley-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await finishSignIn(page, "finance@riftpower.test", ".orderTotal");
  await expect(page.locator(".orderTotal")).toContainText("KSh 1,500");
  await page.getByRole("button", { name: "Pay KSh 1,500" }).click();
  await expect(page.getByRole("heading", { name: "Payment received" })).toBeVisible();
  noErrors();
});
