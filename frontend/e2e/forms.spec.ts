import { expect, test, type Page } from "@playwright/test";
import { DEMO_PASSWORD, confirmDialog, failOnPageErrors, forget, goTo, openPage, signIn } from "./helpers";

// Custom forms: a manager builds one (with a question that only shows for some answers), a
// technician fills one in with no signal, the customer downloads a certificate, and the
// company's logo goes on it.
test.describe.configure({ mode: "serial" });

/** The app's API, as the signed-in person (with the CSRF token the app itself sends). */
async function call(page: Page, method: "get" | "put", path: string, data?: object) {
  const token = (await page.context().cookies()).find((cookie) => cookie.name === "csrf_access_token")?.value ?? "";
  return page.request[method](`/api/${path}`, { data, headers: { "X-CSRF-TOKEN": token } });
}

async function json(page: Page, path: string) {
  const response = await call(page, "get", path);
  expect(response.ok(), `get ${path}: ${await response.text()}`).toBeTruthy();
  return response.json();
}

// A small real PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAIAAADkharWAAAAF0lEQVR4nGM8EaXBQApgIkn1qIYRpAEAEg0BYj9k0WMAAAAASUVORK5CYII=",
  "base64",
);
const MIXER_JOB = "Industrial Mixer MX-08 repair";
// Shared with the customer's test: the mixer job and its internal safety check.
let mixerJobId = 0;
let safetyFormId = 0;

test("a manager builds a form and tries its show-and-hide rule in the preview", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signIn(page, "james@mechanicpro.test");
  try {
    await openPage(page, "Forms");
    const cards = page.locator(".formCard");
    await expect(cards.locator("h3")).toHaveText(["Generator load test certificate", "Inspection certificate", "Site safety check"]);
    const inspection = cards.filter({ hasText: "Inspection certificate" });
    await expect(inspection.locator(".formTag")).toHaveText(["Certificate"]);
    await expect(inspection).toContainText("7 questions · On: Inspection");
    await expect(inspection).toContainText("Filled in on 1 job");
    const generator = cards.filter({ hasText: "Generator load test certificate" });
    await expect(generator.locator(".formTag")).toHaveText(["Required", "Certificate"]);
    await expect(generator).toContainText("On: Generator 500-hour service");

    await page.getByRole("button", { name: "New form" }).click();
    const dialog = page.getByRole("dialog", { name: "New form" });
    // The dialog covers the window, not just the page's panel (a panel left transformed by its
    // entry animation used to trap it).
    const view = await page.evaluate(() => ({ width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }));
    expect(await page.locator(".overlay").boundingBox()).toEqual({ x: 0, y: 0, ...view });
    await dialog.getByLabel("Name").fill("Handover sheet");
    await dialog.locator(".formAttach").getByText("Job type: Repair").click();
    // The first question is a required yes/no; the second only shows when it's "Yes".
    await dialog.getByLabel("Question 1", { exact: true }).fill("Customer present at handover");
    await dialog.getByLabel("Type of question to add").selectOption({ label: "Text" });
    await dialog.getByRole("button", { name: "Add question" }).click();
    await dialog.getByLabel("Question 2", { exact: true }).fill("Who received the machine");
    await dialog.getByLabel("When to ask question 2").selectOption({ label: "Only when “Customer present at handover” is…" });
    await dialog.getByLabel("Answer that shows question 2").selectOption({ label: "Yes" });

    await dialog.getByRole("button", { name: "Preview" }).click();
    const preview = dialog.locator(".formPreview");
    const present = preview.getByRole("group", { name: "Customer present at handover *" });
    await expect(present).toBeVisible();
    await expect(preview.getByLabel("Who received the machine")).toHaveCount(0);
    await present.getByText("Yes").click();
    await expect(preview.getByLabel("Who received the machine")).toBeVisible();
    await present.getByText("No").click();
    await expect(preview.getByLabel("Who received the machine")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Back to editing" }).click();

    await dialog.getByRole("button", { name: "Add form" }).click();
    await expect(page.locator(".toast", { hasText: "Form added" })).toBeVisible();
    const handover = cards.filter({ hasText: "Handover sheet" });
    await expect(handover).toContainText("Version 1");
    await expect(handover).toContainText("2 questions · On: Repair");
    await expect(handover).toContainText("Filled in on 0 jobs");

    // Not filled in anywhere, so it can be deleted (a filled-in one can only be turned off).
    await handover.getByRole("button", { name: "Edit" }).click();
    await page.getByRole("dialog", { name: "Edit Handover sheet" }).getByRole("button", { name: "Delete form" }).click();
    await confirmDialog(page, "Delete form");
    await expect(page.locator(".toast", { hasText: "Form deleted" })).toBeVisible();
    await expect(cards).toHaveCount(3);

    // The conveyor's page lists its certificate for the manager too, and fits the window.
    await goTo(page, "Equipment");
    await page.locator(".machineCard").getByRole("button", { name: "Conveyor Line CL-4", exact: true }).click();
    const certificates = page.locator(".equipmentPage .jobCard", { has: page.locator("#equipment-certificates") });
    await expect(certificates.locator("h2")).toHaveText("Forms and certificates");
    await expect(certificates.locator(".certificateList li strong")).toHaveText(["Inspection certificate"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    noErrors();
  } finally {
    await forget(page);
  }
});

test("a technician fills in the safety check with no signal; it's sent when the signal is back", async ({ page, context }) => {
  test.setTimeout(90_000);
  const noErrors = failOnPageErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "brian@mechanicpro.test");
  try {
    const pill = page.getByTestId("sync-pill");
    await expect(pill).toHaveText("All synced");
    // Online once, so the job and its forms are kept on the phone.
    const card = page.locator(".pendingJob", { hasText: MIXER_JOB });
    await card.getByRole("button", { name: "Worksheet" }).click();
    const sheet = page.locator(".jobPage");
    const forms = sheet.locator(".jobForms");
    const safety = forms.locator(".formRows li", { hasText: "Site safety check" });
    await expect(safety).toContainText("Not started");
    await expect(safety.locator(".formTag")).toHaveCount(0); // not required, not a certificate
    await sheet.getByRole("button", { name: "Back" }).click();

    await context.setOffline(true);
    await card.getByRole("button", { name: "Worksheet" }).click();
    await safety.getByRole("button", { name: "Fill in" }).click();
    const dialog = page.getByRole("dialog", { name: "Site safety check" });
    await expect(dialog).toContainText("Before starting a repair. For the team only.");

    // Completing it checks the required questions first, on the phone.
    await dialog.getByRole("button", { name: "Complete the form" }).click();
    await expect(dialog.locator(".error")).toHaveText(
      "Answer every required question first: Machine isolated and locked out; Work area made safe and signposted.",
    );
    await dialog.getByRole("group", { name: "Machine isolated and locked out *" }).getByText("Yes").click();
    await dialog.getByRole("group", { name: "Work area made safe and signposted *" }).getByText("Yes").click();
    await dialog.getByRole("group", { name: "Protective equipment worn" }).getByText("Full PPE").click();
    await dialog.getByLabel("Hazards noticed").fill("Oil on the floor by the mixer; cleaned before starting.");
    await dialog.getByRole("button", { name: "Complete the form" }).click();
    await expect(page.locator(".toast", { hasText: "Saved on this phone. It's sent when you're back online." })).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await expect(safety).toContainText("Completed");
    await expect(safety).toContainText("Waiting to sync");
    await expect(sheet.locator(".timeline")).toContainText("completed the form Site safety check");
    await expect(pill).toHaveText("Offline · 1 waiting");

    // Reopened before it's sent: the answers kept on the phone.
    await safety.getByRole("button", { name: "Open" }).click();
    await expect(dialog.getByRole("group", { name: "Protective equipment worn" }).getByLabel("Full PPE")).toBeChecked();
    await expect(dialog.getByLabel("Hazards noticed")).toHaveValue("Oil on the floor by the mixer; cleaned before starting.");
    await dialog.getByRole("button", { name: "Close" }).click();

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(pill).toHaveText("All synced");
    await expect(safety).toContainText("Completed by Brian Kariuki");
    await expect(safety).not.toContainText("Waiting to sync");

    // What the server kept.
    const { jobs } = await json(page, "jobs");
    mixerJobId = jobs.find((job: { title: string }) => job.title === MIXER_JOB).id;
    const { job } = await json(page, `jobs/${mixerJobId}`);
    const kept = job.forms.find((form: { name: string }) => form.name === "Site safety check");
    safetyFormId = kept.form_id;
    expect(kept.submission.status).toBe("completed");
    expect(kept.submission.answers).toEqual({
      isolated: "yes",
      area: "yes",
      ppe: "Full PPE",
      hazards: "Oil on the floor by the mixer; cleaned before starting.",
    });
    expect(job.history.filter((row: { action: string }) => row.action === "form_completed")).toHaveLength(1);
    noErrors();
  } finally {
    await context.setOffline(false);
    await forget(page);
  }
});

/** XYZ's password: auth.spec.ts changes it, and this file can also run on its own. */
async function xyzPassword(page: Page) {
  const response = await page.request.post("/api/auth/login", { data: { email: "xyz@example.com", password: DEMO_PASSWORD } });
  await page.context().clearCookies();
  return response.ok() ? DEMO_PASSWORD : "xyz-new-password";
}

test("the customer downloads the inspection certificate; internal forms stay internal", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signIn(page, "xyz@example.com", await xyzPassword(page));
  try {
    await openPage(page, "My Equipment");
    await page.locator("main").getByRole("button", { name: "Conveyor Line CL-4", exact: true }).click();
    const certificates = page.locator(".equipmentPage .jobCard", { has: page.locator("#equipment-certificates") });
    await expect(certificates.locator("h2")).toHaveText("Certificates");
    await expect(certificates.locator(".certificateList li strong")).toHaveText(["Inspection certificate"]);
    await expect(certificates.locator(".certificateList li")).toContainText("Conveyor Line CL-4 inspection");
    const href = await certificates.getByRole("link", { name: "PDF" }).getAttribute("href");
    const pdf = await page.request.get(href ?? "");
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

    // The safety check on their mixer is the team's: not on the job, no PDF.
    if (mixerJobId && safetyFormId) {
      const { job } = await json(page, `jobs/${mixerJobId}`);
      expect(job.forms).toEqual([]);
      const hidden = await call(page, "get", `jobs/${mixerJobId}/forms/${safetyFormId}/certificate.pdf`);
      expect(hidden.status()).toBe(404);
    }
    noErrors();
  } finally {
    await forget(page);
  }
});

test("a manager changes the logo that certificates carry", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signIn(page, "james@mechanicpro.test");
  try {
    await openPage(page, "Settings");
    const logo = page.locator(".settingsSection", { has: page.locator("#settings-logo") });
    await expect(logo.getByRole("img", { name: "Your logo" })).toBeVisible(); // the demo's
    await logo.getByRole("button", { name: "Remove logo" }).click();
    await expect(page.locator(".toast", { hasText: "Logo removed" })).toBeVisible();
    await expect(logo).toContainText("No logo yet");

    // Only PNG or JPEG.
    await logo.locator("input[type=file]").setInputFiles({ name: "logo.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") });
    await expect(logo.locator(".error")).toHaveText("The logo must be a PNG or JPEG image");

    await logo.locator("input[type=file]").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
    await expect(page.locator(".toast", { hasText: "Logo saved" })).toBeVisible();
    await expect(logo.getByRole("img", { name: "Your logo" })).toBeVisible();
    const stored = await call(page, "get", "company/logo");
    expect(stored.status()).toBe(200);
    expect(stored.headers()["content-type"]).toBe("image/png");
    expect((await stored.body()).equals(PNG)).toBeTruthy();
    noErrors();
  } finally {
    await forget(page);
  }
});
