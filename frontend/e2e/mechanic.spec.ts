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

  await job.getByRole("button", { name: "Add record" }).click();
  const form = page.locator(".modalForm");
  await form.locator("select[name=machine_id]").selectOption({ label: "Excavator EX-01 (EX01-55218)" });
  await form.locator("input[name=service_type]").fill("Hydraulic inspection");
  await form.locator("input[name=work_done]").fill("Checked hoses and pressure");
  await form.getByRole("button", { name: "Save Service" }).click();
  await expect(form).toBeHidden();

  await job.getByRole("button", { name: "Complete" }).click();
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

test("service records can only be added for machines on the mechanic's jobs", async ({ page }) => {
  await signIn(page, "mitch@mechanicpro.test");
  await page.getByRole("button", { name: "New Service Record" }).click();
  const options = (await page.locator(".modalForm select[name=machine_id] option").allTextContents()).join("|");
  expect(options).toContain("Generator G-102");
  for (const other of ["Excavator EX-01", "Conveyor Line CL-4", "Industrial Mixer MX-08", "Hydraulic Pump H-21"]) {
    expect(options).not.toContain(other);
  }
});
