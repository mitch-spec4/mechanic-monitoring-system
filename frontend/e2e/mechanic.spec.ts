import { expect, test } from "@playwright/test";
import { failOnPageErrors, signIn } from "./helpers";

test("mechanic takes an assigned job all the way to completed", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signIn(page, "amina@mechanicpro.test");

  const job = page.locator(".pendingJob", { hasText: "Inspect Excavator EX-01" });
  await expect(job).toContainText("Assigned");
  await expect(job.getByRole("button", { name: "Accept" })).toBeVisible();

  await job.getByRole("button", { name: "Start work" }).click();
  await expect(job.locator(".jobStatus")).toHaveText("In Progress");

  await job.getByRole("button", { name: "Pause" }).click();
  await expect(job.locator(".jobStatus")).toHaveText("Paused");

  await job.getByRole("button", { name: "Resume" }).click();
  await expect(job.locator(".jobStatus")).toHaveText("In Progress");

  // Completing from the dashboard is refused until the worksheet is filled in.
  await job.getByRole("button", { name: "Complete" }).click();
  await expect(page.locator(".pendingPanel .error")).toContainText("Describe the work done");

  await job.getByRole("button", { name: "Worksheet" }).click();
  const sheet = page.locator(".jobPage");
  await expect(sheet.locator(".jobBlockers")).toContainText("Tick 2 required checklist items");
  const running = sheet.locator(".entryList li.running");
  await running.locator("textarea").fill("Checked hoses and hydraulic pressure under load.");
  await running.getByRole("button", { name: "Save notes" }).click();
  await expect(running.getByRole("button", { name: "Save notes" })).toBeHidden();
  for (const label of ["Visual inspection for leaks and damage", "Check fluid levels"]) {
    await sheet.locator(".checklist label", { hasText: label }).click();
    await expect(sheet.locator(".checklist li", { hasText: label })).toHaveClass(/done/);
  }
  await expect(sheet.locator(".jobBlockers")).toHaveCount(0);
  await sheet.getByRole("button", { name: "Complete job" }).click();
  await expect(sheet.locator(".jobStatusPill")).toHaveText("Completed");
  await sheet.getByRole("button", { name: "Back" }).click();
  await expect(job).toHaveCount(0);
  await expect(page.locator(".recentPanel")).toContainText("Inspect Excavator EX-01");
  await expect(page.locator(".sidebarStats")).toContainText("Jobs completed 1");
  noErrors();
});

test("mechanic only sees their own machines and real stats", async ({ page }) => {
  await signIn(page, "brian@mechanicpro.test");
  const machines = page.locator(".kpi", { hasText: "Machines" });
  await expect(machines.locator("strong")).toHaveText("2");
  await expect(page.locator(".sidebarStats")).not.toContainText("147");
  await expect(page.locator(".pendingJob", { hasText: "Industrial Mixer MX-08 repair" }).getByRole("button", { name: "Resume" })).toBeVisible();
});
