import { expect, test, type Page } from "@playwright/test";
import { failOnPageErrors, forget, goTo, openPage, signIn } from "./helpers";

// The service catalog: managers keep it in Settings and start a job from a service in one tap;
// customers book a service directly; a technician's route adds up the day's work.
test.describe.configure({ mode: "serial" });

/** The app's API, as the signed-in person (with the CSRF token the app itself sends). */
async function call(page: Page, method: "delete" | "get" | "patch" | "post", path: string, data?: object) {
  const token = (await page.context().cookies()).find((cookie) => cookie.name === "csrf_access_token")?.value ?? "";
  const response = await page.request[method](`/api/${path}`, { data, headers: { "X-CSRF-TOKEN": token } });
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
  return response.json();
}

test("a manager adds a service, then starts a job from it in one tap", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signIn(page, "james@mechanicpro.test");
  try {
    await openPage(page, "Settings");
    const catalog = page.locator(".serviceCatalog");
    const generator = catalog.locator(".serviceList li", { hasText: "Generator 500-hour service" });
    await expect(generator).toContainText("3 h · Generator · Checklist: Preventive maintenance · Customers book it directly");
    await expect(generator.locator(".skillTag")).toHaveText(["Generators", "Electrical"]);
    await expect(catalog.locator(".serviceList li", { hasText: "Conveyor belt replacement" })).toContainText("Managers only");

    await catalog.getByRole("button", { name: "Add a service" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a service" });
    await dialog.getByLabel("Name").fill("Pump seal replacement");
    await dialog.getByLabel("Description").fill("New shaft seals, then a pressure test.");
    await dialog.getByLabel("For equipment of type").fill("Pump");
    await dialog.getByLabel("Usual time (minutes)").fill("90");
    await dialog.getByLabel("Checklist").selectOption({ label: "Repair" });
    await dialog.getByLabel("Skills needed").fill("Hydraulics, Seals, hydraulics");
    await dialog.getByText("Customers book an inspection first").click();
    await dialog.getByRole("button", { name: "Add service" }).click();
    await expect(page.locator(".toast", { hasText: "Service added" })).toBeVisible();
    const pump = catalog.locator(".serviceList li", { hasText: "Pump seal replacement" });
    await expect(pump).toContainText("1 h 30 min · Pump · Checklist: Repair · Customers book an inspection first");
    await expect(pump.locator(".skillTag")).toHaveText(["Hydraulics", "Seals"]);

    // On the pump's page: only the services that fit a pump (or any equipment), one tap each.
    await goTo(page, "Equipment");
    await page.locator(".machineCard").getByRole("button", { name: "Hydraulic Pump H-21", exact: true }).click();
    const start = page.locator(".equipmentPage .jobCard", { hasText: "Start a job" });
    await expect(start.locator(".serviceShortcut b")).toHaveText(["Breakdown call-out", "Pump seal replacement"]);
    await start.getByRole("button", { name: /Pump seal replacement/ }).click();
    await expect(page.locator(".toast", { hasText: "Job created: Pump seal replacement" })).toBeVisible();
    const job = page.locator(".jobPage");
    await expect(job.locator("h1")).toHaveText("Pump seal replacement");
    await expect(job.locator(".jobDescription")).toHaveText("New shaft seals, then a pressure test.");
    await expect(job.locator(".jobMeta div", { hasText: "Estimated time" })).toContainText("1 h 30 min");
    await expect(job.locator(".jobService")).toContainText("Pump seal replacement");
    await expect(job.locator(".jobService .skillTag")).toHaveText(["Hydraulics", "Seals"]);

    // The New job form fills itself in from a service too.
    await goTo(page, "Dashboard");
    await page.getByRole("button", { name: "Create job" }).first().click();
    const form = page.locator(".modal", { hasText: "Create service job" });
    await form.getByLabel("Start from a service").selectOption({ label: "Compressor full service" });
    await expect(form.locator("input[name=title]")).toHaveValue("Compressor full service");
    await expect(form.locator("textarea[name=description]")).toHaveValue(/Oil, air and separator filters/);
    await expect(form.locator("select[name=job_type]")).toHaveValue("Preventive maintenance");
    await expect(form.locator("input[name=estimated_minutes]")).toHaveValue("120");
    await form.locator(".closeBtn").click();
    noErrors();
  } finally {
    const { jobs } = await call(page, "get", "jobs?q=Pump%20seal%20replacement");
    for (const made of jobs) await call(page, "delete", `jobs/${made.id}`);
    const { services } = await call(page, "get", "catalog");
    const added = services.find((service: { name: string }) => service.name === "Pump seal replacement");
    if (added) await call(page, "delete", `catalog/${added.id}`);
  }
});

test("a customer books a service directly, at the service's length", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signIn(page, "abc@example.com");
  try {
    await page.getByRole("button", { name: "Request service" }).click();
    const form = page.locator("form.form");
    await form.locator("select[name=machine_id]").selectOption({ label: "Generator G-102" });
    // The services they can book for a generator, and "something else".
    const choices = form.locator(".choiceCards label");
    await expect(choices.locator("b")).toHaveText(["Breakdown call-out", "Generator 500-hour service", "Something else"]);
    await expect(choices.filter({ hasText: "Generator 500-hour service" })).toContainText("About 3 h. You pick a time for the work.");
    await choices.filter({ hasText: "Generator 500-hour service" }).click();
    // A service names the request: no subject to type, and the notes are optional.
    await expect(form.locator("input[name=subject]")).toHaveCount(0);
    await form.getByLabel(/Anything we should know/).fill("The service hatch sticks.");
    await form.getByRole("button", { name: "Send request" }).click();
    await expect(page.locator(".toast", { hasText: "Request sent. Now pick a time for the service." })).toBeVisible();

    const request = page.locator(".requestPage");
    await expect(request.locator("h1")).toHaveText("Generator 500-hour service");
    await expect(request.locator(".requestSteps li")).toHaveText(["1Submitted", "2Service booked", "3Completed"]);
    const picker = page.locator(".slotPicker");
    await expect(picker.locator("h2")).toHaveText("Pick a time for the service");
    await expect(picker.locator(".jobBadge")).toHaveText("About 3 h");
    await picker.locator(".slotTimes button").first().click();
    await expect(picker.locator(".slotBook")).toHaveText(/^Book \w{3} \d\d \w{3}, (\d\d):\d\d–\d\d:\d\d$/);
    const label = (await picker.locator(".slotBook").textContent()) ?? "";
    const [, from, to] = label.match(/(\d\d):\d\d–(\d\d):\d\d/) ?? [];
    expect(Number(to) - Number(from)).toBe(3);
    await picker.locator(".slotBook").click();
    await expect(request.locator(".jobHero .jobStatusPill")).toHaveText("Service booked");
    await expect(request.locator(".visitCard .visitHead strong")).toHaveText("Service visit");
    noErrors();
  } finally {
    // Cancelled, so the visit doesn't hold a technician for the tests after this one.
    const { requests } = await call(page, "get", "customers/requests?q=Generator%20500-hour%20service");
    for (const made of requests) if (!["Completed", "Declined", "Cancelled"].includes(made.status)) await call(page, "post", `customers/requests/${made.id}/cancel`, {});
  }
});

test("a technician's route adds up the day's work", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signIn(page, "james@mechanicpro.test");
  const { mechanics } = await call(page, "get", "users/mechanics");
  const amina = mechanics.find((person: { email: string }) => person.email === "amina@mechanicpro.test");
  const { machines } = await call(page, "get", "machines");
  const { services } = await call(page, "get", "catalog");
  const day = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const ids: number[] = [];
  try {
    for (const [service, machine] of [
      ["Generator 500-hour service", "Generator G-102"],
      ["Compressor full service", "Compressor C-55"],
    ]) {
      const { job } = await call(page, "post", "jobs", {
        service_id: services.find((item: { name: string }) => item.name === service).id,
        machine_id: machines.find((item: { name: string }) => item.name === machine).id,
        mechanic_id: amina.id,
        due_date: day,
      });
      ids.push(job.id);
    }
    await openPage(page, "Routes");
    const planner = page.locator(".routePlanner");
    await planner.getByLabel("Technician").selectOption({ label: "Amina Otieno" });
    await planner.getByLabel("Day").fill(day);
    // 3 h and 2 h from the two services, plus the driving.
    await expect(planner.locator(".routeWork")).toContainText(/^Work: about 5 h, plus .+ driving\./);
    await expect(planner.locator(".routeStops > li", { hasText: "Generator 500-hour service" })).toContainText("about 3 h of work");
    noErrors();
  } finally {
    for (const id of ids) await call(page, "delete", `jobs/${id}`);
  }
});

test("the technician sees the service and the skills it needs", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signIn(page, "james@mechanicpro.test");
  const { mechanics } = await call(page, "get", "users/mechanics");
  const amina = mechanics.find((person: { email: string }) => person.email === "amina@mechanicpro.test");
  const { machines } = await call(page, "get", "machines");
  const { services } = await call(page, "get", "catalog");
  const { job: made } = await call(page, "post", "jobs", {
    service_id: services.find((item: { name: string }) => item.name === "Compressor full service").id,
    machine_id: machines.find((item: { name: string }) => item.name === "Compressor C-55").id,
    mechanic_id: amina.id,
  });
  try {
    await forget(page);
    await signIn(page, "amina@mechanicpro.test");
    await page.locator(".pendingJob", { hasText: "Compressor full service" }).getByRole("button", { name: "Worksheet" }).click();
    const job = page.locator(".jobPage");
    await expect(job.locator("h1")).toHaveText("Compressor full service");
    await expect(job.locator(".jobService")).toContainText("Compressor full service");
    await expect(job.locator(".jobService .skillTag")).toHaveText(["Compressors"]);
    await expect(job.locator(".jobMeta div", { hasText: "Estimated time" })).toContainText("2 h");
    // The service's checklist came with it.
    await expect(job.locator(".checklist")).toContainText("Change oil and filters");
    noErrors();
  } finally {
    await forget(page);
    await signIn(page, "james@mechanicpro.test");
    await call(page, "delete", `jobs/${made.id}`);
  }
});
