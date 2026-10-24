import { expect, test, type Page } from "@playwright/test";
import { failOnPageErrors, forget, signIn } from "./helpers";

// A technician's phone, in every browser: the bottom bar instead of the sidebar, and today's jobs
// first on the dashboard.
test.use({ viewport: { width: 390, height: 844 } });
test.describe.configure({ mode: "serial" });

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date());

/** The app's API, as the signed-in person (with the CSRF token the app itself sends). */
async function call(page: Page, method: "post" | "patch", path: string, data: object) {
  const token = (await page.context().cookies()).find((cookie) => cookie.name === "csrf_access_token")?.value ?? "";
  const response = await page.request[method](`/api/${path}`, { data, headers: { "X-CSRF-TOKEN": token } });
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
  return response.json();
}

test("technicians get a bottom bar on a phone, with everything else under More", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signIn(page, "brian@mechanicpro.test");
  const bar = page.getByRole("navigation", { name: "Main" });
  await expect(bar).toBeVisible();
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(bar.getByRole("button")).toHaveText(["Today", "Jobs", "Shifts", "Alerts", "More"]);
  await expect(bar.getByRole("button", { name: "Today" })).toHaveAttribute("aria-current", "page");
  // Nothing hides behind it: the page ends above the bar.
  const barTop = (await bar.boundingBox())!.y;
  await expect(page.locator(".todayPanel")).toBeVisible();

  await bar.getByRole("button", { name: "Jobs" }).click();
  await expect(page.locator(".subPage h1")).toHaveText("My Jobs");
  await expect(bar.getByRole("button", { name: "Jobs" })).toHaveAttribute("aria-current", "page");
  // The stat cards' values stay whole words on one line ("Connected", not "Connect / ed").
  const value = page.locator(".subPageStats strong").nth(1);
  await expect(value).toHaveText("Connected");
  expect((await value.boundingBox())!.height).toBeLessThan(36);

  await bar.getByRole("button", { name: "More" }).click();
  const more = page.getByRole("dialog", { name: "More" });
  await expect(more.getByRole("button")).toContainText(["Assigned Jobs", "Service Records", "Reviews", "Settings", "Help & Support"]);
  await more.getByRole("button", { name: "Settings" }).click();
  await expect(more).toHaveCount(0);
  await expect(page.locator(".subPage h1")).toHaveText("Settings");
  // A page under More lights up More.
  await expect(bar.getByRole("button", { name: "More" })).toHaveClass(/active/);

  const scrolled = await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
    return document.documentElement.scrollHeight;
  });
  expect(scrolled).toBeGreaterThan(0);
  const lastBottom = await page.locator(".subPage > *").last().evaluate((element) => element.getBoundingClientRect().bottom);
  expect(lastBottom).toBeLessThanOrEqual(barTop + 1);
  noErrors();
});

test("managers keep the sidebar on a phone", async ({ page }) => {
  await signIn(page, "james@mechanicpro.test");
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator(".bottomNav")).toHaveCount(0);
});

test("today's jobs: open the one in progress, resume a paused one", async ({ page }) => {
  // Mitch is working on the generator (seeded In Progress); Brian's mixer is paused.
  await signIn(page, "mitch@mechanicpro.test");
  const mitchToday = page.locator(".todayJob", { hasText: "Service Generator G-102" });
  await expect(mitchToday).toContainText("In Progress");
  await mitchToday.getByRole("button", { name: "Open" }).click();
  await expect(page.locator(".jobPage h1")).toHaveText("Service Generator G-102");

  await forget(page);
  await signIn(page, "brian@mechanicpro.test");
  const brianToday = page.locator(".todayJob", { hasText: "Industrial Mixer MX-08 repair" });
  await expect(brianToday).toContainText("Paused");
  await expect(brianToday.getByRole("button", { name: "Resume" })).toBeVisible();
  // Jobs due later and not started stay out of today's list.
  await expect(page.locator(".todayJob", { hasText: "Conveyor Line CL-4" })).toHaveCount(0);
});

test.describe("on a computer", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("today's jobs keep each button beside its job", async ({ page }) => {
    await signIn(page, "mitch@mechanicpro.test");
    const row = page.locator(".todayJob", { hasText: "Service Generator G-102" });
    const title = (await row.locator("strong").boundingBox())!;
    const button = (await row.getByRole("button", { name: "Open" }).boundingBox())!;
    expect(button.x).toBeGreaterThan(title.x + title.width);
    expect(button.width).toBeLessThan(200);
    // The row is the same height whatever the job's status says, so nothing below it jumps.
    expect((await row.boundingBox())!.height).toBeLessThan(90);
  });
});

test("today's jobs: a job due today is started with one press", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  // A job for Amina (clocked in, location shared), due today, made by the manager.
  await signIn(page, "james@mechanicpro.test");
  const { mechanics } = await (await page.request.get("/api/users/mechanics")).json();
  const amina = mechanics.find((person: { email: string }) => person.email === "amina@mechanicpro.test");
  const { job } = await call(page, "post", "jobs", {
    title: "Check the boiler gauges",
    description: "Pressure reads high in the mornings.",
    mechanic_id: amina.id,
    due_date: today(),
  });
  try {
    await forget(page);
    await signIn(page, "amina@mechanicpro.test");
    const card = page.locator(".todayJob", { hasText: "Check the boiler gauges" });
    await expect(card).toContainText("Due today");
    await card.getByRole("button", { name: "Start work" }).click();
    await expect(card.locator(".jobStatus")).toHaveText("In Progress");
    await card.getByRole("button", { name: "Open" }).click();
    await expect(page.locator(".jobPage h1")).toHaveText("Check the boiler gauges");
    await expect(page.locator(".jobStatusPill")).toHaveText("In Progress");
    noErrors();
  } finally {
    // Leave Amina with no job in progress for the spec files after this one.
    await forget(page);
    await signIn(page, "james@mechanicpro.test");
    await call(page, "patch", `jobs/${job.id}`, { status: "Cancelled" });
  }
});
