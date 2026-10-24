import { expect, test, type Page } from "@playwright/test";
import { failOnPageErrors, goTo, openPage, signIn } from "./helpers";

// Managers' insights (charts, the technicians' hours, repeat faults, Excel and PDF), and long
// lists a page at a time.
test.describe.configure({ mode: "serial" });

/** Make (or remove) jobs straight through the API, as the signed-in manager. */
async function inApi(page: Page, action: "add" | "remove", count = 0) {
  return page.evaluate(
    async ({ action, count }) => {
      const csrf = document.cookie.split("; ").find((c) => c.startsWith("csrf_access_token="))?.split("=")[1] ?? "";
      const headers = { "Content-Type": "application/json", "X-CSRF-TOKEN": csrf };
      if (action === "add") {
        for (let number = 1; number <= count; number++) {
          await fetch("/api/jobs", { method: "POST", headers, body: JSON.stringify({ title: `Batch visit ${number}`, description: "Paging test" }) });
        }
        return count;
      }
      const all = (await (await fetch("/api/jobs")).json()) as { jobs: { id: number; title: string }[] };
      const batch = all.jobs.filter((job) => job.title.startsWith("Batch visit "));
      for (const job of batch) await fetch(`/api/jobs/${job.id}`, { method: "DELETE", headers });
      return batch.length;
    },
    { action, count },
  );
}

test("a manager reads the insights and downloads them as Excel and PDF", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signIn(page, "james@mechanicpro.test");
  await openPage(page, "Reports");
  const insights = page.locator(".insights");
  await expect(insights.getByRole("button", { name: "Last 30 days" })).toHaveAttribute("aria-pressed", "true");
  await expect(insights.locator(".insightsTile", { hasText: "Jobs completed" }).locator("strong")).toHaveText(/^\d+$/);
  await expect(insights.locator(".insightsTile", { hasText: "Time to complete" }).locator("strong")).toHaveText(/ h$/);

  // A column a day for a month; a week for longer ranges.
  await expect(insights.getByRole("heading", { name: "Jobs completed each day" })).toBeVisible();
  await expect(insights.locator(".columns li")).toHaveCount(30);
  await insights.getByRole("button", { name: "Last 90 days" }).click();
  await expect(insights.getByRole("heading", { name: "Jobs completed each week" })).toBeVisible();
  await insights.getByRole("button", { name: "Last 7 days" }).click();
  await expect(insights.locator(".columns li")).toHaveCount(7);
  // Every column says its value: on focus, and in the table.
  const lastDay = insights.locator(".columns li").last();
  await lastDay.focus();
  await expect(lastDay.locator(".columnTip")).toBeVisible();
  await insights.getByText("Show as a table").click();
  await expect(insights.locator(".chartTable tbody tr")).toHaveCount(7);

  // The team's hours, and the mixer that keeps failing.
  const team = insights.locator(".insightsTable").first();
  for (const name of ["Amina Otieno", "Brian Kariuki", "Mitch Kamau"]) await expect(team).toContainText(name);
  const faults = insights.locator(".insightsPanel", { hasText: "Repeat faults" });
  await expect(faults.locator("tbody tr", { hasText: "Industrial Mixer MX-08" })).toContainText("XYZ Factory");

  // A custom range.
  await insights.getByRole("button", { name: "Custom" }).click();
  await expect(insights.getByLabel("From", { exact: true })).toBeVisible();
  await expect(insights.getByLabel("To", { exact: true })).toBeVisible();

  // Excel and PDF of the same range.
  for (const [button, extension] of [
    ["Excel", "xlsx"],
    ["PDF", "pdf"],
  ]) {
    const download = page.waitForEvent("download");
    await insights.getByRole("button", { name: button }).click();
    expect((await download).suggestedFilename()).toMatch(new RegExp(`^insights-\\d{4}-\\d\\d-\\d\\d-to-\\d{4}-\\d\\d-\\d\\d\\.${extension}$`));
  }
  await expect(page.locator(".toast", { hasText: /Saved insights-.*\.pdf/ })).toBeVisible();

  // The repeat fault opens its equipment.
  await faults.getByRole("button", { name: "Industrial Mixer MX-08" }).click();
  await expect(page.locator(".equipmentPage h1")).toHaveText("Industrial Mixer MX-08");

  // Downloads are in the activity log.
  await openPage(page, "Activity");
  await expect(page.locator(".activityLog")).toContainText("Downloaded insights");
  noErrors();
});

test("long lists go a page at a time, and search the whole list", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signIn(page, "james@mechanicpro.test");
  await inApi(page, "add", 30);
  try {
    await openPage(page, "Jobs / Requests");
    const pager = page.locator(".pager");
    await expect(pager).toContainText(/^.*1–25 of \d+.*$/);
    await expect(page.locator(".subPageList article")).toHaveCount(25);
    // Newest first: the batch fills page one.
    await expect(page.locator(".subPageList article").first()).toContainText("Batch visit 30");
    await pager.getByRole("button", { name: "Next" }).click();
    await expect(pager).toContainText(/26–\d+ of \d+/);
    await expect(page.locator(".subPageList")).toContainText("Service Generator G-102");
    await expect(pager.getByRole("button", { name: "Next" })).toBeDisabled();

    // The search runs on the server, over every page.
    await page.getByLabel("Search").fill("generator g-102");
    await expect(page.locator(".subPageList article", { hasText: "Service Generator G-102" })).toBeVisible();
    await expect(page.locator(".subPageList article", { hasText: "Batch visit" })).toHaveCount(0);
    await expect(pager).toHaveCount(0);
    await page.getByLabel("Search").fill("batch visit 2");
    // 2, 20-29: eleven, so one page.
    await expect(page.locator(".subPageList article")).toHaveCount(11);
    await page.getByLabel("Search").fill("no such job anywhere");
    await expect(page.getByText("No matches")).toBeVisible();
  } finally {
    // Later tests expect the seeded jobs on the dashboard.
    expect(await inApi(page, "remove")).toBe(30);
  }
  await goTo(page, "Dashboard");
  await expect(page.locator(".job", { hasText: "Batch visit" })).toHaveCount(0);
  noErrors();
});

test("the team map refreshes on its own", async ({ page }) => {
  await signIn(page, "james@mechanicpro.test");
  await openPage(page, "Team Map");
  await expect(page.locator(".teamLive")).toContainText(/Live: updated at \d\d:\d\d/);
  const answered = page.waitForResponse((response) => response.url().includes("/api/location/team"), { timeout: 20_000 });
  expect((await answered).ok()).toBe(true);
});
