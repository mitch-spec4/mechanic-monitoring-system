import { expect, test } from "@playwright/test";
import { confirmDialog, failOnPageErrors, forget, goTo, signIn } from "./helpers";

// A piece of equipment's page: a manager keeps its site, plans and documents; the customer and the
// technician see the same history from their side.
test.describe.configure({ mode: "serial" });

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");

test("a manager adds a site, then plans maintenance and files the manual on the equipment's page", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signIn(page, "james@mechanicpro.test");
  await page.locator(".customer-card", { hasText: "ABC Engineering" }).click();
  const customerPage = page.locator(".customerPage");
  await expect(customerPage.locator("h1")).toHaveText("ABC Engineering");

  // Sites: the seeded two, and a new one.
  const sites = customerPage.locator(".siteList");
  await expect(sites).toContainText("Industrial Area plant");
  await expect(sites).toContainText("Athi River yard");
  await customerPage.getByRole("button", { name: "Add site" }).click();
  const siteForm = page.locator(".modal", { hasText: "Add site" });
  await siteForm.getByLabel("Site name").fill("Mombasa Road depot");
  await siteForm.getByLabel(/Address/).fill("Mombasa Road, near the SGR terminus");
  await siteForm.getByRole("button", { name: "Add site" }).click();
  await expect(siteForm).toHaveCount(0);
  await expect(sites.locator("li", { hasText: "Mombasa Road depot" })).toContainText("0 pieces of equipment");

  // The equipment card shows its type and site, and opens its page.
  const generator = customerPage.locator(".machineCard", { hasText: "Generator G-102" });
  await expect(generator).toContainText("Generator · CAT XQ200");
  await expect(generator.locator(".machineSite")).toHaveText("Industrial Area plant");
  await expect(generator.locator(".workReasons")).toContainText("Planned maintenance: Oil and filter change Service due");
  await generator.getByRole("button", { name: "Generator G-102", exact: true }).click();

  const equipment = page.locator(".equipmentPage");
  await expect(equipment.locator("h1")).toHaveText("Generator G-102");
  await expect(equipment.locator(".jobMeta")).toContainText("Caterpillar · CAT XQ200");
  await expect(equipment.locator(".jobMeta")).toContainText("Industrial Area plant, Enterprise Road, Industrial Area");
  await expect(equipment.locator(".jobHero .eyebrow")).toHaveText("Generator");

  // The seeded plan is due soon; its job is created now rather than by the daily run.
  const oilChange = equipment.locator(".planRow", { hasText: "Oil and filter change" });
  await expect(oilChange.locator(".planState")).toHaveText("Due soon");
  await expect(oilChange).toContainText("Every 3 months");
  await oilChange.getByRole("button", { name: "Create the job now" }).click();
  await expect(page.locator(".toast", { hasText: "Job created" })).toBeVisible();
  await expect(oilChange.getByRole("button", { name: "Its job is open" })).toBeVisible();
  await expect(oilChange.getByRole("button", { name: "Create the job now" })).toHaveCount(0);
  await expect(equipment.locator(".equipmentJobs")).toContainText("Oil and filter change: Generator G-102");

  // A new plan, every 2 weeks from a week today.
  await equipment.getByRole("button", { name: "Add plan" }).click();
  const planForm = page.locator(".modal", { hasText: "Add maintenance plan" });
  await planForm.getByLabel("What's done").fill("Battery and coolant check");
  await planForm.getByLabel("Repeats every").fill("2");
  await planForm.getByLabel("Unit").selectOption("weeks");
  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  await planForm.getByLabel("Next due").fill(nextWeek);
  await planForm.getByLabel("Create the job").fill("3");
  await planForm.getByRole("button", { name: "Add plan" }).click();
  await expect(planForm).toHaveCount(0);
  const check = equipment.locator(".planRow", { hasText: "Battery and coolant check" });
  await expect(check.locator(".planState")).toHaveText("Scheduled");
  await expect(check).toContainText("Every 2 weeks");

  // Done outside the app today: the next due date moves on two weeks from today.
  await check.getByRole("button", { name: "Mark done" }).click();
  const doneForm = page.locator(".modal", { hasText: "Mark Battery and coolant check done" });
  await doneForm.getByRole("button", { name: "Mark done" }).click();
  await expect(doneForm).toHaveCount(0);
  await expect(check.locator(".planDates")).not.toContainText("Not yet");

  // The manual, uploaded and listed; it downloads rather than opening in the app.
  await equipment.locator("#equipment-document").setInputFiles({ name: "G-102 operator manual.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(page.locator(".toast", { hasText: "Document added" })).toBeVisible();
  const manual = equipment.locator(".docList li", { hasText: "G-102 operator manual.pdf" });
  await expect(manual).toContainText("James Mwangi");
  const href = await manual.locator("a", { hasText: "G-102 operator manual.pdf" }).getAttribute("href");
  const download = await page.request.get(href!);
  expect(download.ok()).toBe(true);
  expect(download.headers()["content-disposition"]).toContain("attachment");

  // Back returns to the customer.
  await page.getByRole("button", { name: "Back" }).click();
  await expect(customerPage.locator("h1")).toHaveText("ABC Engineering");
  noErrors();
});

test("the equipment list filters by type, and repeat faults stand out", async ({ page }) => {
  await signIn(page, "james@mechanicpro.test");
  await goTo(page, "Equipment");
  await page.locator(".machineFilters select").selectOption("Mixer");
  const cards = page.locator(".machineCard");
  await expect(cards).toHaveCount(1);
  const mixer = cards.first();
  await expect(mixer).toContainText("Industrial Mixer MX-08");
  await expect(mixer.locator(".repeatFault")).toHaveText("Repeat fault: 2 in 90 days");
  await mixer.getByRole("button", { name: "Industrial Mixer MX-08", exact: true }).click();
  const equipment = page.locator(".equipmentPage");
  await expect(equipment.locator(".repeatFaultBanner")).toContainText("Repeat fault: 2 in 90 days");
  await expect(equipment.locator(".faultList li")).toHaveCount(2);
  await expect(equipment.locator(".faultList")).toContainText("Worn motor mount and a loose drive belt.");
});

test("the customer and the technician see the same equipment from their side", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signIn(page, "abc@example.com");
  await page.locator(".machine").getByRole("button", { name: "Generator G-102", exact: true }).click();
  const equipment = page.locator(".equipmentPage");
  await expect(equipment.locator("h1")).toHaveText("Generator G-102");
  // Plans are shown, not changed; documents can be read and added.
  await expect(equipment.locator(".planRow", { hasText: "Oil and filter change" })).toBeVisible();
  await expect(equipment.getByRole("button", { name: "Add plan" })).toHaveCount(0);
  await expect(equipment.getByRole("button", { name: "Mark done" })).toHaveCount(0);
  await expect(equipment.getByRole("button", { name: "Edit details" })).toHaveCount(0);
  await expect(equipment.locator(".docList")).toContainText("G-102 operator manual.pdf");
  await expect(equipment.getByRole("button", { name: "Remove G-102 operator manual.pdf" })).toHaveCount(0);
  await forget(page);

  // Mitch, from his job: the equipment's history, with his own job to open.
  await signIn(page, "mitch@mechanicpro.test");
  await goTo(page, "My Jobs");
  await page.locator(".subPageList article", { hasText: "Service Generator G-102" }).getByRole("button", { name: "Service Generator G-102" }).click();
  await page.locator(".jobMeta").getByRole("button", { name: "Generator G-102", exact: true }).click();
  await expect(equipment.locator("h1")).toHaveText("Generator G-102");
  await expect(equipment.locator(".docList")).toContainText("G-102 operator manual.pdf");
  await expect(equipment.locator(".equipmentJobs").getByRole("button", { name: "Service Generator G-102" })).toBeVisible();
  // The plan's job isn't his: listed, not a link.
  await expect(equipment.locator(".equipmentJobs")).toContainText("Oil and filter change: Generator G-102");
  await expect(equipment.locator(".equipmentJobs").getByRole("button", { name: "Oil and filter change: Generator G-102" })).toHaveCount(0);
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.locator(".jobPage h1")).toHaveText("Service Generator G-102");
  noErrors();
});

test("a manager removes a site, the document, and the plan's job", async ({ page }) => {
  await signIn(page, "james@mechanicpro.test");
  await page.locator(".customer-card", { hasText: "ABC Engineering" }).click();
  const customerPage = page.locator(".customerPage");
  await customerPage.getByRole("button", { name: "Edit Mombasa Road depot" }).click();
  await page.locator(".modal").getByRole("button", { name: "Remove site" }).click();
  await confirmDialog(page, "Remove site");
  await expect(customerPage.locator(".siteList")).not.toContainText("Mombasa Road depot");

  await customerPage.locator(".machineCard", { hasText: "Generator G-102" }).getByRole("button", { name: "Generator G-102", exact: true }).click();
  const equipment = page.locator(".equipmentPage");
  await equipment.getByRole("button", { name: "Remove G-102 operator manual.pdf" }).click();
  await confirmDialog(page, "Remove document");
  await expect(equipment.locator(".docList")).toHaveCount(0);

  // The job made early is deleted, so later tests see the seeded jobs on the dashboard; the plan
  // offers to create it again.
  await goTo(page, "Dashboard");
  await page.getByRole("button", { name: "Delete Oil and filter change: Generator G-102" }).click();
  await confirmDialog(page, "Delete job");
  await expect(page.locator(".job", { hasText: "Oil and filter change: Generator G-102" })).toHaveCount(0);
});
