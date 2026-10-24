import { expect, test } from "@playwright/test";
import { failOnPageErrors, openPage, signIn, signAndComplete } from "./helpers";

// PR 2 "done when": a mechanic fills a worksheet and completes a job; the boss sees the full history.
test.describe.configure({ mode: "serial" });

test("mechanic fills in the worksheet and completes the job", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signIn(page, "mitch@mechanicpro.test");
  await page.locator(".pendingJob", { hasText: "Service Generator G-102" }).getByRole("button", { name: "Worksheet" }).click();
  const sheet = page.locator(".jobPage");
  await expect(sheet.locator("h1")).toHaveText("Service Generator G-102");
  await expect(sheet.locator(".jobTimer")).toContainText("Timer running");

  // Parts: validation, add, remove.
  const partForm = sheet.locator(".partForm");
  await partForm.locator("input[name=name]").fill("Radiator cap");
  await partForm.locator("input[name=quantity]").fill("2");
  await partForm.getByRole("button", { name: "Add" }).click();
  await expect(sheet.locator(".partList")).toContainText("Radiator cap");
  await sheet.getByRole("button", { name: "Remove Radiator cap" }).click();
  await expect(sheet.locator(".partList")).not.toContainText("Radiator cap");
  await partForm.locator("input[name=name]").fill("Fan belt");
  await partForm.locator("input[name=quantity]").fill("1");
  await partForm.getByRole("button", { name: "Add" }).click();
  await expect(sheet.locator(".partList li")).toHaveCount(3);

  // Checklist and the customer summary.
  await sheet.locator(".checklist label", { hasText: "Check belts and hoses" }).click();
  await expect(sheet.locator(".jobBlockers")).toHaveCount(0);
  await sheet.locator("textarea[name=solution]").fill("Replaced the thermostat and fan belt.");
  await sheet.locator("textarea[name=advice]").fill("Check the coolant level weekly.");
  await sheet.getByRole("button", { name: "Save summary" }).click();
  await expect(sheet.locator(".error")).toHaveCount(0);

  // Manual time entry for an earlier visit.
  await sheet.getByRole("button", { name: "Add time manually" }).click();
  const manual = sheet.locator(".entryList ~ form");
  const day = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  await manual.locator("input[name=started_at]").fill(`${day}T09:00`);
  await manual.locator("input[name=ended_at]").fill(`${day}T10:30`);
  await manual.locator("textarea[name=work_done]").fill("Initial diagnosis visit.");
  await manual.getByRole("button", { name: "Add time" }).click();
  await expect(sheet.locator(".entryList li")).toHaveCount(3);
  await expect(sheet.locator(".entryList")).toContainText("1 h 30 min");

  await sheet.getByRole("button", { name: "Complete job" }).click();
  await signAndComplete(page);
  await expect(sheet.locator(".jobStatusPill")).toHaveText("Completed");
  await expect(sheet.locator(".jobTimer")).toContainText("Total time on this job");
  // Finished jobs are read-only.
  await expect(sheet.locator(".partForm")).toHaveCount(0);
  await expect(sheet.locator(".checklist input").first()).toBeDisabled();
  noErrors();
});

test("boss sees the full history, parts and checklist", async ({ page }) => {
  await signIn(page, "james@mechanicpro.test");
  // From the full list: the dashboard only shows the newest jobs.
  await openPage(page, "Jobs / Requests");
  await page.locator(".subPageList article", { hasText: "Service Generator G-102" }).locator(".titleLink").click();
  const sheet = page.locator(".jobPage");
  await expect(sheet.locator(".jobStatusPill")).toHaveText("Completed");
  const history = sheet.locator(".timeline");
  for (const line of [
    "James Mwangi created the job",
    "Mitch Kamau moved it from Paused to In Progress",
    "Mitch Kamau added part Radiator cap ×2",
    "Mitch Kamau removed part Radiator cap ×2",
    'Mitch Kamau ticked "Check belts and hoses"',
    "Mitch Kamau added time (1.5 h)",
    "Mitch Kamau moved it from In Progress to Completed",
  ]) {
    await expect(history).toContainText(line);
  }
  await expect(sheet.locator(".partList")).toContainText("Fan belt");
  await expect(sheet.locator(".jobCard", { hasText: "Service summary" })).toContainText("Replaced the thermostat and fan belt.");

  await sheet.locator(".noteForm input").fill("Called the customer to confirm.");
  await sheet.getByRole("button", { name: "Add note" }).click();
  await expect(history).toContainText("Called the customer to confirm.");
});

test("customer sees the work but not hours or internal history", async ({ page }) => {
  await signIn(page, "abc@example.com");
  // Completed jobs leave "Upcoming services"; the newest service record links to the job.
  await page.locator(".record .titleLink").first().click();
  const sheet = page.locator(".jobPage");
  await expect(sheet.locator("h1")).toHaveText("Service Generator G-102");
  await expect(sheet).toContainText("Fan belt");
  await expect(sheet).toContainText("Replacing the thermostat.");
  await expect(sheet.locator(".jobTimer")).toHaveCount(0);
  await expect(sheet.locator(".timeline")).toHaveCount(0);
  await expect(sheet.locator(".partForm")).toHaveCount(0);
});
