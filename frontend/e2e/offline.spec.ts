import { expect, test, type Page } from "@playwright/test";
import { failOnPageErrors, forget, openPage, signAndComplete, signIn } from "./helpers";

// A technician's day with no signal: everything is saved on the phone and sent, once, when the
// signal returns, with the times it really happened. Brian is clocked out (location.spec.ts).
test.use({ viewport: { width: 390, height: 844 } });
test.describe.configure({ mode: "serial" });

// On a failure: the page as text and what it logged, in the run's output (CI's screenshots are
// only in a downloadable report).
const logged: string[] = [];
test.beforeEach(({ page }) => {
  logged.length = 0;
  page.on("console", (message) => logged.push(`${message.type()}: ${message.text()}`));
});
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  console.log(`--- The page when "${testInfo.title}" failed ---\n${await page.locator("body").ariaSnapshot().catch(String)}`);
  console.log(`--- Its console ---\n${logged.join("\n")}`);
});

// A small real PNG; the phone turns photos into JPEG before keeping them.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAIAAADkharWAAAAF0lEQVR4nGM8EaXBQApgIkn1qIYRpAEAEg0BYj9k0WMAAAAASUVORK5CYII=",
  "base64",
);
const TITLE = "Check the quarry pump";
// Shared with the manager's test: the job, and when the phone lost and found its signal.
let jobId = 0;
let offlineAt = 0;
let onlineAt = 0;

/** The app's API, as the signed-in person (with the CSRF token the app itself sends). */
async function call(page: Page, method: "get" | "post" | "patch", path: string, data?: object) {
  const token = (await page.context().cookies()).find((cookie) => cookie.name === "csrf_access_token")?.value ?? "";
  const response = await page.request[method](`/api/${path}`, { data, headers: { "X-CSRF-TOKEN": token } });
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
  return response.json();
}

const seconds = (value: string) => Date.parse(/Z$/.test(value) ? value : `${value}Z`);

test("the whole job with no signal, sent once when it's back", async ({ page, context, browserName }) => {
  test.setTimeout(120_000);
  // Playwright's offline mode in WebKit fails every load, a photo file on the phone included
  // ("WebKit encountered an internal error"), which a phone with no signal doesn't do. WebKit
  // checks the rest of the day offline; its photos are tested online (media.spec.ts).
  const photoOffline = browserName !== "webkit";
  const waiting = photoOffline ? 10 : 9;
  const noErrors = failOnPageErrors(page);
  // The manager gives Brian an inspection; its checklist comes with it.
  await signIn(page, "james@mechanicpro.test");
  const { mechanics } = await call(page, "get", "users/mechanics");
  const brian = mechanics.find((person: { email: string }) => person.email === "brian@mechanicpro.test");
  const { job } = await call(page, "post", "jobs", {
    title: TITLE,
    description: "The pump trips under load.",
    mechanic_id: brian.id,
    job_type: "Inspection",
    location: "Kitengela quarry",
  });
  jobId = job.id;
  await forget(page);

  // Online once: the job list and the job's worksheet are kept on the phone.
  await signIn(page, "brian@mechanicpro.test");
  const pill = page.getByTestId("sync-pill");
  await expect(pill).toHaveText("All synced");
  const card = page.locator(".pendingJob", { hasText: TITLE });
  await card.getByRole("button", { name: "Worksheet" }).click();
  const sheet = page.locator(".jobPage");
  await expect(sheet.locator(".checklist li")).toHaveCount(3);
  await sheet.getByRole("button", { name: "Back" }).click();

  await context.setOffline(true);
  offlineAt = Date.now();

  // Clock in, agreeing to location sharing.
  const clock = page.locator(".clockCard");
  await clock.getByRole("button", { name: "Clock in" }).click();
  await page.locator(".modal").getByRole("button", { name: /I agree/ }).click();
  await expect(clock).toContainText("Clocked in since");
  await expect(pill).toHaveText("Offline · 2 waiting");
  await expect(page.locator(".offlineNotice")).toContainText("Offline");

  // Start, and fill in the worksheet from the copy on the phone.
  await card.getByRole("button", { name: "Start work" }).click();
  await expect(card.locator(".jobStatus")).toHaveText("In Progress");
  await expect(card).toContainText("Waiting to sync");
  await card.getByRole("button", { name: "Worksheet" }).click();
  await expect(sheet.locator(".jobStatusPill")).toHaveText("In Progress");
  await expect(page.locator(".offlineNotice")).toContainText("last updated");

  const parts = sheet.locator(".partForm");
  await parts.locator("input[name=name]").fill("Pump seal");
  await parts.getByRole("button", { name: "Add" }).click();
  await expect(sheet.locator(".partList li", { hasText: "Pump seal" })).toContainText("Waiting to sync");

  const running = sheet.locator(".entryList li.running");
  await running.locator("textarea").fill("Replaced the seal. No more leaks under load.");
  await running.getByRole("button", { name: "Save notes" }).click();
  await expect(running).toContainText("Waiting to sync");

  for (const label of ["Visual inspection for leaks and damage", "Check fluid levels"]) {
    await sheet.locator(".checklist label", { hasText: label }).click();
    await expect(sheet.locator(".checklist li", { hasText: label })).toHaveClass(/done/);
  }
  await expect(sheet.locator(".jobBlockers")).toHaveCount(0);

  await sheet.locator(".noteForm input").fill("No phone signal at the quarry.");
  await sheet.getByRole("button", { name: "Add note" }).click();
  await expect(sheet.locator(".timeline")).toContainText("No phone signal at the quarry.");

  const media = sheet.locator(".jobCard", { hasText: "Photos & videos" });
  if (photoOffline) {
    await media.locator(".mediaPick", { hasText: "Before photo" }).locator("input").setInputFiles({ name: "pump.png", mimeType: "image/png", buffer: PNG });
    await expect(media.locator(".mediaGrid li, .error").first()).toBeVisible();
    expect(await media.locator(".error").allTextContents()).toEqual([]);
    await expect(media.locator(".mediaGrid li")).toHaveCount(1);
    await expect(media.locator(".mediaGrid li")).toContainText("Waiting to sync");
  }

  // Complete with the customer's signature.
  await sheet.locator(".jobActions").getByRole("button", { name: "Complete job" }).click();
  await signAndComplete(page, "Grace Wanjiru");
  await expect(sheet.locator(".jobStatusPill")).toHaveText("Completed");
  await expect(pill).toHaveText(`Offline · ${waiting} waiting`);

  // Signing out now would lose it all: the app says so.
  await page.locator(".profileTrigger").click();
  await expect(page.locator(".profileTrigger")).toHaveAttribute("aria-expanded", "true");
  await page.locator(".profileLogout").click();
  const warning = page.getByRole("alertdialog");
  await expect(warning).toContainText(`${waiting} changes haven't synced`);
  await warning.getByRole("button", { name: "Stay signed in" }).click();
  await expect(sheet).toBeVisible();

  // Back online. The answer to the part is lost on its way back: the phone sends it again, and the
  // server, which already has it, keeps one.
  let dropped = false;
  await page.route("**/api/jobs/*/parts", async (route) => {
    if (dropped || route.request().method() !== "POST") return route.continue();
    dropped = true;
    await route.fetch();
    await route.abort("connectionreset");
  });
  onlineAt = Date.now();
  await context.setOffline(false);
  await expect.poll(() => dropped).toBe(true);
  // The next try (when the signal comes back, or within 30 seconds).
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(pill).toHaveText("All synced", { timeout: 30_000 });
  await expect(sheet.locator(".waitingTag")).toHaveCount(0);
  await expect(sheet.locator(".jobStatusPill")).toHaveText("Completed");

  // On the server: everything once, dated when it happened (offline), not when it arrived.
  const { job: saved } = await call(page, "get", `jobs/${jobId}`);
  expect(saved.status).toBe("Completed");
  expect(saved.parts.map((part: { name: string }) => part.name)).toEqual(["Pump seal"]);
  expect(saved.files).toHaveLength(photoOffline ? 1 : 0);
  expect(saved.signature.name).toBe("Grace Wanjiru");
  expect(saved.entries).toHaveLength(1);
  expect(seconds(saved.entries[0].started_at)).toBeGreaterThan(offlineAt - 5000);
  expect(seconds(saved.entries[0].ended_at)).toBeLessThan(onlineAt);
  const started = saved.history.find((event: { to_status: string | null }) => event.to_status === "In Progress");
  expect(seconds(started.created_at)).toBeLessThan(onlineAt);
  expect(saved.history.filter((event: { action: string }) => event.action === "note")).toHaveLength(1);
  const shift = await call(page, "get", "shifts/current");
  expect(seconds(shift.shift.clocked_in_at)).toBeLessThan(onlineAt);
  noErrors();

  // Leave Brian clocked out for the tests after this one; with nothing waiting, signing out just
  // clears the phone.
  await call(page, "post", "shifts/clock-out", { location_error: "unavailable" });
  await page.locator(".profileTrigger").click();
  await page.locator(".profileLogout").click();
  await expect(page.getByLabel("Email")).toBeVisible();
});

test("the manager sees work done offline with the time it happened", async ({ page }) => {
  await signIn(page, "james@mechanicpro.test");
  // Brian's job from the test before: started and completed while his phone had no signal.
  const { job } = await call(page, "get", `jobs/${jobId}`);
  for (const status of ["In Progress", "Completed"]) {
    const event = job.history.find((line: { to_status: string | null }) => line.to_status === status);
    expect(seconds(event.created_at)).toBeGreaterThan(offlineAt - 5000);
    expect(seconds(event.created_at)).toBeLessThan(onlineAt);
  }

  // Seeded: a note Mitch wrote with no signal, sent when his phone was back online.
  await openPage(page, "Jobs / Requests");
  await page.locator(".subPageList article", { hasText: "Service Generator G-102" }).locator(".titleLink").click();
  await expect(page.locator(".timeline li", { hasText: "No signal in the plant room" })).toContainText(/Done offline at .+, synced at .+/);

  // Managers' screens are online only: offline, they say so.
  await page.context().setOffline(true);
  await expect(page.locator(".offlineNotice")).toContainText("You're offline. Reconnect to see and change your data.");
  await page.context().setOffline(false);
  await expect(page.locator(".offlineNotice")).toHaveCount(0);
});
