import { expect, test } from "@playwright/test";
import { confirmDialog, failOnPageErrors, openPage, signIn } from "./helpers";

// Brian starts clocked out and hasn't agreed to location sharing; Mitch and Amina are clocked in.
test.describe.configure({ mode: "serial" });

test("mechanic must clock in, with consent and location, before working", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signIn(page, "brian@mechanicpro.test");
  const clock = page.locator(".clockCard");
  const job = page.locator(".pendingJob", { hasText: "Industrial Mixer MX-08 repair" });
  await expect(clock).toContainText("You're clocked out");
  await expect(page.locator(".locationPill")).toHaveCount(0);

  await job.getByRole("button", { name: "Resume" }).click();
  await expect(page.locator(".pendingPanel .error")).toHaveText("Clock in before starting work");

  await clock.getByRole("button", { name: "Clock in" }).click();
  const consent = page.locator(".modal", { hasText: "Share your location while you work" });
  await expect(consent).toContainText("Never while you are clocked out");
  await consent.getByRole("button", { name: /I agree/ }).click();
  await expect(clock).toContainText("Clocked in since");
  await expect(page.locator(".locationPill")).toHaveText("Location on");
  await expect(page.locator(".pendingPanel .error")).toHaveCount(0);

  await job.getByRole("button", { name: "Resume" }).click();
  await expect(job.locator(".jobStatus")).toHaveText("In Progress");
  await expect(clock).toContainText("Working on Industrial Mixer MX-08 repair");

  // Clocking out pauses the job and stops sharing.
  await clock.getByRole("button", { name: "Clock out" }).click();
  await confirmDialog(page, "Clock out");
  await expect(clock).toContainText("You're clocked out");
  await expect(job.locator(".jobStatus")).toHaveText("Paused");
  await expect(page.locator(".locationPill")).toHaveCount(0);
  noErrors();
});

test("blocked location gives clear steps and does not clock in", async ({ page }) => {
  // Behave like a phone where the person tapped "Block" on the location prompt.
  await page.addInitScript(() => {
    const denied = { code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: "User denied Geolocation" };
    const geolocation = {
      getCurrentPosition: (_ok: unknown, fail: (error: unknown) => void) => setTimeout(() => fail(denied), 50),
      watchPosition: (_ok: unknown, fail: (error: unknown) => void) => (setTimeout(() => fail(denied), 50), 1),
      clearWatch: () => {},
    };
    Object.defineProperty(navigator, "geolocation", { value: geolocation, configurable: true });
  });
  await signIn(page, "brian@mechanicpro.test");
  const clock = page.locator(".clockCard");
  await clock.getByRole("button", { name: "Clock in" }).click();
  await expect(clock.locator(".clockProblem")).toContainText("You can't clock in without sharing your location");
  await expect(clock.locator(".clockProblem")).toContainText("Allow it in your browser's site settings");
  await expect(clock).toContainText("You're clocked out");

  // Consent was given in the previous test, and can be withdrawn while clocked out.
  await openPage(page, "Settings");
  const settings = page.locator(".locationSettings");
  await expect(settings).toContainText("You have agreed");
  await settings.getByRole("button", { name: "Withdraw consent" }).click();
  await expect(settings).toContainText("You haven't agreed");
});

test("boss sees clocked-in mechanics on the map, shifts, and job locations", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signIn(page, "james@mechanicpro.test");

  await openPage(page, "Team Map");
  const rows = page.locator(".teamRow");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Amina Otieno");
  await expect(rows.nth(1)).toContainText("Mitch Kamau");
  await expect(rows.nth(1)).toContainText("Working on Service Generator G-102");
  await expect(page.locator(".teamMarker")).toHaveCount(2);
  await expect(page.locator(".teamMap")).not.toContainText("Brian Kariuki");

  await openPage(page, "Shifts");
  await page.getByLabel("Technician").selectOption({ label: "Brian Kariuki" });
  const corrected = page.locator(".shiftRow", { hasText: "Set by James Mwangi" });
  await expect(corrected).toContainText("Not shared");
  await corrected.getByRole("button", { name: "Fix clock-out" }).click();
  const form = page.locator(".modal", { hasText: "Clock-out for Brian Kariuki" });
  await expect(form.getByLabel("Clock-out time")).not.toHaveValue("");
  await form.getByRole("button", { name: "Save clock-out" }).click();
  await expect(form).toHaveCount(0);
  await expect(page.locator(".shiftRow", { hasText: "Set by James Mwangi" })).toHaveCount(1);

  await page.locator(".sidebarLink", { hasText: "Dashboard" }).click();
  await page.locator(".job", { hasText: "Service Generator G-102" }).locator(".titleLink").click();
  await expect(page.locator(".jobCard", { hasText: "Locations" })).toContainText("Started or resumed work");
  noErrors();
});

test("customers never see locations", async ({ page }) => {
  await signIn(page, "abc@example.com");
  // The API itself leaves locations out for customers, not just the screen.
  const list = await (await page.request.get("/api/jobs")).json();
  const job = list.jobs.find((item: { title: string }) => item.title === "Service Generator G-102");
  const detail = await (await page.request.get(`/api/jobs/${job.id}`)).json();
  expect(detail.job.title).toBe("Service Generator G-102");
  expect(detail.job).not.toHaveProperty("locations");
  expect((await page.request.get("/api/location/team")).status()).toBe(403);
  expect((await page.request.get("/api/shifts")).status()).toBe(403);
});
