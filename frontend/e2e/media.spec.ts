import { expect, test } from "@playwright/test";
import { failOnPageErrors, signAndComplete, signIn } from "./helpers";

// The unassigned pump repair job is used only here: the boss gives it to Mitch first.
test.describe.configure({ mode: "serial" });

// A small real PNG; the phone-side code converts photos to JPEG before upload.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAIAAADkharWAAAAF0lEQVR4nGM8EaXBQApgIkn1qIYRpAEAEg0BYj9k0WMAAAAASUVORK5CYII=",
  "base64",
);

test("boss assigns the pump repair to Mitch", async ({ page }) => {
  await signIn(page, "james@mechanicpro.test");
  const job = page.locator(".job", { hasText: "Repair Hydraulic Pump H-21" });
  await job.locator("select").selectOption({ label: "Mitch Kamau" });
  await expect(job).toContainText("Assigned");
});

test("mechanic adds before and after photos, the customer signs, and the report is ready", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signIn(page, "mitch@mechanicpro.test");
  await page.locator(".pendingJob", { hasText: "Repair Hydraulic Pump H-21" }).getByRole("button", { name: "Worksheet" }).click();
  const sheet = page.locator(".jobPage");
  await expect(sheet.locator(".jobCard", { hasText: "Photos & videos" })).toContainText("once work starts");
  await sheet.getByRole("button", { name: "Start work" }).click();
  await expect(sheet.locator(".jobStatusPill")).toHaveText("In Progress");

  const media = sheet.locator(".jobCard", { hasText: "Photos & videos" });
  await media.locator(".mediaPick", { hasText: "Before photo" }).locator("input").setInputFiles({ name: "before.png", mimeType: "image/png", buffer: PNG });
  await expect(media.locator(".mediaGrid li")).toHaveCount(1);
  await media.locator(".mediaPick", { hasText: "After photo" }).locator("input").setInputFiles({ name: "after.png", mimeType: "image/png", buffer: PNG });
  await expect(media.locator(".mediaGrid li")).toHaveCount(2);
  await expect(media.locator(".mediaTag")).toHaveText(["Before", "After"]);
  // The photos really load from the server.
  await expect.poll(() => media.locator("img").first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  const running = sheet.locator(".entryList li.running");
  await running.locator("textarea").fill("Replaced the main seal and pressure-tested the pump.");
  await running.getByRole("button", { name: "Save notes" }).click();
  await expect(running.getByRole("button", { name: "Save notes" })).toBeHidden();
  // Tick every required checklist item.
  const required = sheet.locator(".checklist li", { has: page.locator("em", { hasText: "Required" }) });
  for (let index = 0; index < (await required.count()); index++) {
    await required.nth(index).locator("label").click();
    await expect(required.nth(index)).toHaveClass(/done/);
  }

  await sheet.getByRole("button", { name: "Complete job" }).click();
  // The sheet can switch to "Customer not present" with a ready-made reason, and back.
  const dialog = page.getByRole("dialog", { name: "Customer sign-off" });
  await dialog.getByRole("button", { name: "Customer not present" }).click();
  await dialog.getByRole("button", { name: "Approved by phone" }).click();
  await expect(dialog.getByLabel("Why couldn't the customer sign?")).toHaveValue("Approved by phone");
  await dialog.getByRole("button", { name: "Customer signs" }).click();
  // Signing without a name is refused on the phone.
  await dialog.getByRole("button", { name: "Complete job" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Enter the name of the person signing.");
  await signAndComplete(page, "Peter Otieno");
  await expect(sheet.locator(".jobStatusPill")).toHaveText("Completed");
  await expect(sheet.locator(".jobCard", { hasText: "Customer sign-off" })).toContainText("Signed by Peter Otieno");
  await expect(sheet.locator(".signOffView img")).toBeVisible();
  // Finished jobs keep their photos but can't change them.
  await expect(media.locator(".mediaPick")).toHaveCount(0);

  const href = await sheet.getByRole("link", { name: "Download PDF" }).getAttribute("href");
  const pdf = await page.request.get(href!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
  await expect(sheet.locator(".timeline")).toContainText("added a before photo");
  await expect(sheet.locator(".timeline")).toContainText("recorded the customer's signature (Peter Otieno)");
  noErrors();
});

test("the customer sees the photos, the signature and the report", async ({ page }) => {
  // boss.spec resets Kenya Motors' password earlier in the run.
  await signIn(page, "kenya@example.com", "kenya-new-password");
  await page.locator(".record .titleLink").first().click();
  const sheet = page.locator(".jobPage");
  await expect(sheet.locator("h1")).toContainText("Repair Hydraulic Pump H-21");
  await expect(sheet.locator(".mediaGrid li")).toHaveCount(2);
  await expect(sheet.locator(".jobCard", { hasText: "Customer sign-off" })).toContainText("Peter Otieno");
  await expect(sheet.getByRole("button", { name: "Share report" })).toBeVisible();
  await expect(sheet.locator(".mediaRemove")).toHaveCount(0);
});
