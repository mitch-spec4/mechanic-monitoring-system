import { expect, test } from "@playwright/test";
import { failOnPageErrors, goTo, setUpTwoFactor } from "./helpers";

// What a plan includes, extra technicians, and what happens when a renewal fails or is cancelled.
// A new company of its own, so nothing here touches the demo company.
test.describe.configure({ mode: "serial" });

test("a Starter company sees what its plan leaves out, then pays, renews and cancels", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await page.goto("/#/signup?plan=starter");
  await page.getByLabel("Company name").fill("Kisumu Pumps");
  await page.getByLabel("Your name").fill("Achieng Otieno");
  await page.getByLabel("Work email").fill("achieng@kisumupumps.test");
  await page.getByLabel("Password").fill("kisumu-pumps-1");
  await page.getByLabel(/I agree to the privacy policy/).check();
  await page.getByRole("button", { name: /Start 14-day free trial/ }).click();
  await setUpTwoFactor(page, "achieng@kisumupumps.test");

  // The trial counts down on every page.
  const banner = page.getByTestId("plan-banner");
  await expect(banner).toContainText("Free trial: 14 days left.");

  // Starter leaves out route planning and insights: locked, with the way to upgrade.
  const routes = page.locator('.sidebarLink[data-page="Routes"]');
  await expect(routes.locator(".sidebarLock")).toBeVisible();
  await goTo(page, "Routes");
  await expect(page.locator(".planLocked")).toContainText("Route planning is on the Business plan");
  await goTo(page, "Reports");
  await expect(page.locator(".planLocked")).toContainText("Insights and exports is on the Professional plan");
  await page.locator(".planLocked").getByRole("button", { name: "See plans" }).click();
  await expect(page.locator(".billingPage h1")).toHaveText("Your plan");
  await expect(banner).toHaveCount(0);

  // Two extra technicians on top of Starter's three, paid with a card that declines next time.
  const extra = page.locator(".extraMechanics");
  await expect(extra).toContainText("KSh 500 each / month");
  await extra.getByRole("button", { name: "One more" }).click();
  await extra.getByRole("button", { name: "One more" }).click();
  await expect(extra.locator("output")).toHaveText("2");
  await expect(extra).toContainText("Adds KSh 1,000 / month");
  await page.locator(".planCard", { hasText: "Starter" }).getByRole("button", { name: "Pay for Starter" }).click();
  await expect(page.locator(".orderSummary")).toContainText("Extra technicians");
  await expect(page.locator(".orderTotal")).toContainText("KSh 2,500");
  await page.getByRole("button", { name: "Pay with a card that will decline at renewal" }).click();
  await expect(page.getByRole("heading", { name: "Payment received" })).toBeVisible();
  await page.getByRole("button", { name: "Go to your dashboard" }).click();

  const status = page.locator(".planStatus");
  await expect(status).toContainText("Active");
  await expect(status).toContainText("2 extra technicians · Renews with Test card •••• 0002");
  await expect(status).toContainText("then renews automatically");
  await expect(page.locator(".meter").first()).toContainText("0 of 5");

  // The renewal is declined: a warning here and across the app, everything still working.
  await status.getByRole("button", { name: "Renew now (test)" }).click();
  await expect(page.locator(".toast", { hasText: "The test card was declined" })).toBeVisible();
  await expect(status).toContainText("The renewal payment didn't go through");
  await expect(page.locator(".paymentTable tbody tr").first()).toContainText("Failed");
  await expect(page.locator(".paymentTable tbody tr").first()).toContainText("Declined (test card)");
  await goTo(page, "Dashboard");
  await expect(banner).toContainText("Your last payment didn't go through");
  await banner.getByRole("button", { name: "Pay now" }).click();

  // Paying again clears it.
  await page.locator(".planCard", { hasText: "Starter" }).getByRole("button", { name: "Renew" }).click();
  await page.getByRole("button", { name: /Pay KSh 2,500/ }).click();
  await page.getByRole("button", { name: "Go to your dashboard" }).click();
  await expect(status).not.toContainText("didn't go through");
  await goTo(page, "Dashboard");
  await expect(banner).toHaveCount(0);

  // Cancelling renewal keeps the plan to the end of what's paid.
  await goTo(page, "Billing");
  await status.getByRole("button", { name: "Cancel renewal" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel renewal" }).click();
  await expect(status).toContainText("It won't renew.");
  await status.getByRole("button", { name: "Turn renewal back on" }).click();
  await expect(status).toContainText("then renews automatically");
  noErrors();
});
