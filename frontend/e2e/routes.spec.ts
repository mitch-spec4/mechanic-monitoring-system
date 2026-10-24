import { expect, test, type Page } from "@playwright/test";
import { failOnPageErrors, forget, openPage, signIn } from "./helpers";

// Planning a technician's day (the order to visit their jobs in), directions, and what a job cost
// and made: pay rates, part costs, what the customer was charged, and the margin.
test.describe.configure({ mode: "serial" });

/** The app's API, as the signed-in person (with the CSRF token the app itself sends). */
async function call(page: Page, method: "delete" | "get" | "patch" | "post", path: string, data?: object) {
  const token = (await page.context().cookies()).find((cookie) => cookie.name === "csrf_access_token")?.value ?? "";
  const response = await page.request[method](`/api/${path}`, { data, headers: { "X-CSRF-TOKEN": token } });
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
  return response.json();
}

/** Open a job's page from the jobs list, as the manager. */
async function openJob(page: Page, title: string) {
  await openPage(page, "Jobs / Requests");
  await page.getByRole("textbox", { name: "Search" }).fill(title);
  await page.locator(".subPageList article", { hasText: title }).getByRole("button", { name: title }).click();
  await expect(page.locator(".jobPage h1")).toHaveText(title);
}

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date());

// Three of Brian's jobs for today, made in the worst order (by priority: Athi River, then Thika
// Road, then Industrial Area). From the base in Industrial Area, the plant is next door, then Thika
// Road, then Athi River.
const STOPS = [
  { title: "Route check: Athi River yard", machine: "Excavator EX-01", priority: "Urgent" },
  { title: "Route check: Thika Road workshop", machine: "Compressor C-55", priority: "High" },
  { title: "Route check: Industrial Area plant", machine: "Generator G-102", priority: "Low" },
];

test("a manager plans a technician's day, and the technician's list follows it", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signIn(page, "james@mechanicpro.test");
  const { mechanics } = await call(page, "get", "users/mechanics");
  const brian = mechanics.find((person: { email: string }) => person.email === "brian@mechanicpro.test");
  const { machines } = await call(page, "get", "machines");
  const ids: number[] = [];
  for (const stop of STOPS) {
    const machine = machines.find((item: { name: string }) => item.name === stop.machine);
    const { job } = await call(page, "post", "jobs", {
      title: stop.title,
      description: "Checking the route planner.",
      priority: stop.priority,
      mechanic_id: brian.id,
      machine_id: machine.id,
      due_date: today(),
    });
    ids.push(job.id);
  }
  try {
    await openPage(page, "Routes");
    const planner = page.locator(".routePlanner");
    await planner.getByLabel("Technician").selectOption({ label: "Brian Kariuki" });
    const stops = planner.locator(".routeStops > li");
    await expect(stops.filter({ hasText: "Route check:" })).toHaveCount(3);
    // The shortest order, against the order they were in: it says what it saves.
    const order = (await stops.locator("strong").allTextContents()).filter((title) => title.startsWith("Route check:"));
    expect(order).toEqual(["Route check: Industrial Area plant", "Route check: Thika Road workshop", "Route check: Athi River yard"]);
    await expect(planner.locator(".routeSummary")).toContainText(/Saves [\d.]+ km and/);
    await expect(planner.locator(".routeSummary")).toContainText("Distances are straight lines and times are rough");
    // Numbered on the map, with the start: one marker a stop, and one more.
    await expect(planner.locator(".routeMarker")).toHaveCount((await stops.count()) + 1);
    // Directions to each stop in the map app, and the whole route in one link.
    const thika = stops.filter({ hasText: "Route check: Thika Road workshop" });
    await expect(thika.getByRole("link", { name: "Directions" })).toHaveAttribute("href", /destination=-1\.219,36\.888/);
    await expect(planner.getByRole("link", { name: "Whole route in Maps" })).toHaveAttribute("href", /waypoints=/);

    await planner.getByRole("button", { name: "Use this order" }).click();
    await expect(page.locator(".toast")).toContainText("Route saved: Brian Kariuki's jobs are in this order");
    await expect(planner.locator(".routeSaved")).toContainText("Saved: Brian Kariuki's Today's jobs follow this order.");
    const numbers = new Map<string, string>();
    for (const stop of STOPS) numbers.set(stop.title, (await stops.filter({ hasText: stop.title }).locator(".routeNumber").textContent())!.trim());

    // A day with nothing due: nothing to route.
    await planner.getByLabel("Day").fill("2020-01-06");
    await expect(planner.getByText("Nothing to route on 06 Jan 2020")).toBeVisible();
    noErrors();

    // Brian's Today's jobs: in that order, numbered, and the day's route in the map app.
    await forget(page);
    await signIn(page, "brian@mechanicpro.test");
    const day = page.locator(".todayPanel");
    for (const stop of STOPS) {
      await expect(day.locator(".todayJob", { hasText: stop.title }).locator(".todayStop")).toHaveText(`Stop ${numbers.get(stop.title)}`);
    }
    const listed = (await day.locator(".todayJob strong").allTextContents()).filter((title) => title.startsWith("Route check:"));
    expect(listed).toEqual(order);
    await expect(day.getByRole("link", { name: "Today's route in Maps" })).toHaveAttribute("href", /destination=-1\.456,36\.978.*waypoints=/);
    noErrors();
  } finally {
    await forget(page);
    await signIn(page, "james@mechanicpro.test");
    for (const id of ids) await call(page, "delete", `jobs/${id}`);
  }
});

test("a manager sees what a job cost and made, and fills in what's missing", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signIn(page, "james@mechanicpro.test");

  // Brian's conveyor inspection: 2 h at KSh 550, four fasteners at KSh 350, charged KSh 12,000.
  await openJob(page, "Conveyor Line CL-4 inspection");
  const costing = page.locator(".jobCard", { hasText: "Costs and margin" });
  await expect(costing.locator("tbody tr", { hasText: "Labour: Brian Kariuki" })).toContainText("KSh 550 an hour");
  await expect(costing.locator("tbody tr", { hasText: "Labour: Brian Kariuki" })).toContainText("KSh 1,100");
  await expect(costing.locator("tbody tr", { hasText: "Belt fastener" })).toContainText("KSh 1,400");
  await expect(costing.locator("tfoot")).toContainText("KSh 2,500");
  await expect(costing.locator(".costingMargin")).toContainText("KSh 9,500");
  await expect(costing.locator(".costingMargin")).toContainText("79% of what you charged");
  // The directions link goes to the site's pin.
  await expect(page.locator(".jobDirections")).toHaveAttribute("href", /destination=-1\.312,36\.83/);

  // Charging more raises the margin; a dearer part lowers it.
  await costing.getByLabel("Charged to the customer (KSh)").fill("13000");
  await costing.getByLabel("Unit cost of Belt fastener (KSh)").fill("400");
  await costing.getByRole("button", { name: "Save costs" }).click();
  await expect(page.locator(".toast")).toContainText("Costs saved");
  await expect(costing.locator(".costingMargin")).toContainText("KSh 10,300");
  await costing.getByLabel("Charged to the customer (KSh)").fill("abc");
  await costing.getByRole("button", { name: "Save costs" }).click();
  await expect(costing.locator(".error")).toContainText("Charged must be an amount");

  // The generator job: the thermostat has no cost yet, so it isn't counted, and it says so.
  await openJob(page, "Service Generator G-102");
  const generator = page.locator(".jobCard", { hasText: "Costs and margin" });
  await expect(generator.locator(".costingGaps")).toContainText("Not counted, no unit cost yet: Thermostat.");
  await expect(generator.locator(".costingMargin")).toContainText("Add what you charged to see the margin.");

  // Pay rates are set on the Technicians page.
  await openPage(page, "Technicians");
  const brian = page.locator(".subPageList article", { hasText: "Brian Kariuki" });
  await expect(brian).toContainText("KSh 550 an hour");
  await brian.getByRole("button", { name: "Pay rate" }).click();
  const dialog = page.getByRole("dialog", { name: "Pay rate: Brian Kariuki" });
  await dialog.getByLabel("Pay rate per hour (KSh)").fill("600");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(brian).toContainText("KSh 600 an hour");

  // The insights add it up.
  await openPage(page, "Reports");
  await expect(page.locator(".insightsTile", { hasText: "Margin" }).locator("strong")).toHaveText(/^−?KSh [\d,]+(\.\d\d)?$/);
  noErrors();

  // Put things back for the spec files after this one.
  const { mechanics } = await call(page, "get", "users/mechanics");
  const brianId = mechanics.find((person: { email: string }) => person.email === "brian@mechanicpro.test").id;
  await call(page, "patch", `users/${brianId}`, { pay_rate: "550" });
});
