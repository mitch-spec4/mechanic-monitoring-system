import { useEffect, useId, useState, type ReactNode } from "react";
import { go, money } from "../lib/route";
import { usePricing, type Interval, type Plan, type Pricing } from "../components/Plans";
import { startDemo, type User } from "../services/api";
import { errorMessage } from "../lib/format";
import LanguagePicker from "../components/LanguagePicker";
import LanguageSuggestion from "../components/LanguageSuggestion";
import { mark, t } from "../i18n";
import { Trans } from "../i18n/Trans";
import "./Home.css";
import { ForwardArrow } from "../components/Arrows";

const SECTIONS = [
  ["features", mark("Features")],
  ["roles", mark("How it works")],
  ["subscriptions", mark("Subscriptions")],
] as const;

const FEATURES = [
  ["📋", mark("Job management"), mark("Create jobs, assign technicians, track progress and keep job information together.")],
  ["🔧", mark("Equipment history"), mark("See previous repairs, replaced parts, solutions and service records for every piece of equipment.")],
  ["👨‍🔧", mark("Technician tracking"), mark("Give technicians their jobs, collect updates and know what work is complete.")],
  ["📦", mark("Parts tracking"), mark("Record parts used during service and keep a replacement history for all your equipment.")],
  ["⭐", mark("Customer feedback"), mark("Customers rate completed work, and their requests and updates stay with the job.")],
  ["📊", mark("Reports"), mark("Follow jobs by status, customer ratings and the hours your team has worked.")],
  ["📸", mark("Photos & sign-off"), mark("Before and after photos and videos on every job, and the customer signs on the technician's phone.")],
  ["📍", mark("Clock-in & team map"), mark("Technicians clock in on their phones, and you see who is on site, with their consent.")],
  ["📄", mark("PDF service reports"), mark("Every finished job gets a PDF report with the work done, parts, photos and signature.")],
];

const ROLES = [
  {
    role: "boss",
    label: mark("Boss"),
    icon: "👔",
    title: mark("Boss / Manager"),
    lead: mark("Control the operation and keep jobs moving."),
    points: [
      mark("Assign technicians to jobs"),
      mark("Monitor job progress"),
      mark("Manage customers and their equipment"),
      mark("See who is on shift on the team map"),
      mark("View reports and service history"),
    ],
  },
  {
    role: "mechanic",
    label: mark("Technician"),
    icon: "🧰",
    title: mark("Technician"),
    lead: mark("Everything needed to complete a job."),
    points: [mark("View assigned jobs"), mark("Update work status"), mark("Record parts used"), mark("Add solutions and notes"), mark("Add photos and get the customer's signature")],
  },
  {
    role: "customer",
    label: mark("Customer"),
    icon: "👤",
    title: mark("Customer"),
    lead: mark("A simple portal for service customers."),
    points: [mark("Request service"), mark("Track service requests"), mark("View equipment history"), mark("Download signed service reports"), mark("Leave reviews")],
  },
];

/** Words for each plan. What a plan includes and costs comes from the server; "planned" items
 * aren't built yet and are shown as such. */
const PLAN_COPY: Record<string, { desc: string; team: string; features: string[]; planned: string[]; best: string }> = {
  starter: {
    desc: mark("Do the work. Keep everyday service jobs organized."),
    team: mark("Small teams"),
    features: [
      mark("Job creation and assignment"),
      mark("Equipment and customer records"),
      mark("Service history and repair notes"),
      mark("Parts, checklists and photos"),
      mark("Customer sign-off and PDF reports"),
      mark("Clock-in, team map and notifications"),
    ],
    planned: [],
    best: mark("Small workshops needing a simple, fast workflow."),
  },
  professional: {
    desc: mark("Organize the work across a growing team."),
    team: mark("Growing teams"),
    features: [mark("Everything in Starter"), mark("Insights with Excel and PDF exports"), mark("Planned maintenance and reminders")],
    planned: [mark("Custom statuses and fields"), mark("Approvals"), mark("Workload and job timelines")],
    best: mark("Teams ready for more structure and fewer manual follow-ups."),
  },
  business: {
    desc: mark("Run a larger operation, with room to grow."),
    team: mark("Larger operations"),
    features: [mark("Everything in Professional"), mark("Route planning for each technician's day"), mark("Job costing and margins")],
    planned: [
      mark("Branch, team and technician views"),
      mark("Bulk actions and saved views"),
      mark("Advanced roles and permissions"),
      mark("Escalations and assignment rules"),
    ],
    best: mark("Established service businesses with multiple teams or sites."),
  },
};

const RECOMMENDED = "professional";

// Cells are shown as they are, except the markers "Planned" and "Included", which get a badge.
const COMPARE: [string, (plan: Plan) => string][] = [
  [mark("Technicians"), (plan) => t("Up to {count}", { count: plan.mechanics })],
  [mark("Storage for photos, videos & signatures"), (plan) => `${plan.storage_gb} GB`],
  [mark("Jobs, customers & equipment"), () => t("Unlimited")],
  [mark("Technician app, checklists & parts"), () => "Included"],
  [mark("Photos, sign-off & PDF reports"), () => "Included"],
  [mark("Team map, shifts & reviews"), () => "Included"],
  [mark("Customer requests, booking & chat"), () => "Included"],
  // What a plan includes comes from the server (backend/app/services/plans.py).
  [mark("Insights & Excel/PDF exports"), (plan) => (plan.features.includes("insights") ? "Included" : "—")],
  [mark("Planned maintenance & reminders"), (plan) => (plan.features.includes("maintenance") ? "Included" : "—")],
  [mark("Route planning"), (plan) => (plan.features.includes("routes") ? "Included" : "—")],
  [mark("Job costing & margins"), (plan) => (plan.features.includes("costing") ? "Included" : "—")],
  [mark("Custom statuses & fields"), (plan) => (plan.key === "starter" ? "—" : "Planned")],
  [mark("Approvals & integrations"), (plan) => (plan.key === "starter" ? "—" : "Planned")],
  [mark("Branches & advanced roles"), (plan) => (plan.key === "business" ? "Planned" : "—")],
];

const scrollToSection = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

/** The bar across the top of the public pages; each page adds its own links and buttons. */
export function SiteNav({ children }: { children?: ReactNode }) {
  return (
    <div className="siteNav">
      <div className="container navRow">
        <button className="siteLogo" onClick={() => go("/")} aria-label={t("MechanicPro home")}>
          <span className="logoIcon" aria-hidden="true">
            🔧
          </span>
          <span className="logoText">MechanicPro</span>
        </button>
        {children}
      </div>
    </div>
  );
}

export function PeriodToggle({ value, onChange, freeMonths }: { value: Interval; onChange: (value: Interval) => void; freeMonths: number }) {
  return (
    <div className="periodToggle" role="group" aria-label={t("Billing period")}>
      <button type="button" aria-pressed={value === "month"} onClick={() => onChange("month")}>
        {t("Monthly")}
      </button>
      <button type="button" aria-pressed={value === "year"} onClick={() => onChange("year")}>
        {t("Yearly")} <span className="save">{t("Save {count} months", { count: freeMonths })}</span>
      </button>
    </div>
  );
}

/** An illustration of the manager's dashboard. */
function DashboardPreview() {
  const jobs = [
    [t("Hydraulic pump inspection"), t("In progress"), "progress"],
    [t("Engine service · CAT 320"), t("Assigned"), "assigned"],
    [t("Generator maintenance"), t("Completed"), "done"],
  ];
  return (
    <div className="preview" aria-hidden="true">
      <div className="previewInner">
        <div className="dots">
          ● &nbsp; ● &nbsp; ●<span className="sample">{t("Sample data")}</span>
        </div>
        <div className="dash">
          <div className="side">
            <div className="current">▣ {t("Dashboard")}</div>
            <div>◉ {t("Jobs")}</div>
            <div>⚙ {t("Equipment")}</div>
            <div>♙ {t("Technicians")}</div>
            <div>▤ {t("Service history")}</div>
          </div>
          <div className="dashMain">
            <h3>{t("Good morning, Manager")} 👋</h3>
            <div className="pvStats">
              <div>
                <small>{t("Active jobs").toUpperCase()}</small>
                <b>18</b>
              </div>
              <div>
                <small>{t("Completed").toUpperCase()}</small>
                <b>126</b>
              </div>
              <div>
                <small>{t("Technicians").toUpperCase()}</small>
                <b>12</b>
              </div>
            </div>
            <div className="pvJobs">
              {jobs.map(([title, status, tone]) => (
                <div className="pvJob" key={title}>
                  <span>{title}</span>
                  <span className="pvStatus" data-tone={tone}>
                    {status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlanCard({ plan, pricing, interval }: { plan: Plan; pricing: Pricing; interval: Interval }) {
  const copy = PLAN_COPY[plan.key] ?? { desc: "", team: "", features: [], planned: [], best: "" };
  const recommended = plan.key === RECOMMENDED;
  const yearlySaving = plan.prices.month * 12 - plan.prices.year;
  return (
    <article className={`plan ${recommended ? "popular" : ""}`}>
      {recommended && <span className="tag">{t("Recommended")}</span>}
      <h3>{t(plan.name)}</h3>
      <p className="desc">{copy.desc && t(copy.desc)}</p>
      <div className="price">
        {money(plan.prices[interval], pricing.currency)} <small>{interval === "year" ? t("/ year") : t("/ month")}</small>
      </div>
      <div className="yearNote">
        {interval === "year"
          ? t("Up to {count} technicians · Save {amount} a year", { count: plan.mechanics, amount: money(yearlySaving, pricing.currency) })
          : `${copy.team && t(copy.team)} · ${t("Up to {count} technicians", { count: plan.mechanics })}`}
      </div>
      <button className={`btn ${recommended ? "primary" : "outline"}`} onClick={() => go(`/signup?plan=${plan.key}&interval=${interval}`)}>
        {t("Choose {plan}", { plan: t(plan.name) })}
      </button>
      <ul>
        {copy.features.map((item) => (
          <li key={item}>{t(item)}</li>
        ))}
        {copy.planned.map((item) => (
          <li key={item} className="planned">
            {t(item)} <em>{t("Planned")}</em>
          </li>
        ))}
      </ul>
      <h4>{t("Customers & jobs")}</h4>
      <p className="detail">{t("Unlimited customers, equipment and jobs.")}</p>
      <h4>{t("Storage")}</h4>
      <p className="detail">{t("{size} GB for photos, videos and signatures.", { size: plan.storage_gb })}</p>
      <h4>{t("Best for")}</h4>
      <p className="detail">{copy.best && t(copy.best)}</p>
    </article>
  );
}

function CompareCell({ value }: { value: string }) {
  if (value === "Planned") return <em className="pill">{t("Planned")}</em>;
  if (value === "Included") return <span className="yes">✓ {t("Included")}</span>;
  return <>{value}</>;
}

/** Existing companies change plan from Billing, after signing in. */
function PlanSwitcher({ plans, interval }: { plans: Plan[]; interval: Interval }) {
  const [choice, setChoice] = useState(RECOMMENDED);
  return (
    <div className="switcher">
      <h3>{t("Already using MechanicPro?")}</h3>
      <p>{t("Change your plan from Billing in your account. Renewing the plan you have adds time after it ends; a different plan starts the day you pay.")}</p>
      <div className="switchRow">
        <select aria-label={t("Choose a subscription plan")} value={choice} onChange={(event) => setChoice(event.target.value)}>
          {plans.map((plan) => (
            <option key={plan.key} value={plan.key}>
              {t(plan.name)}
            </option>
          ))}
        </select>
        <button className="btn primary" onClick={() => go(`/signin?next=billing&plan=${choice}&interval=${interval}`)}>
          {t("Continue to Billing")}
        </button>
      </div>
    </div>
  );
}

/** "Try the demo": opens a private copy of the demo company as the chosen person. */
function useDemo(onDemo: (user: User) => void) {
  const [opening, setOpening] = useState("");
  const [error, setError] = useState("");
  const open = async (role: string) => {
    setError("");
    setOpening(role);
    try {
      onDemo((await startDemo(role)).user);
    } catch (problem) {
      setError(errorMessage(problem));
      setOpening("");
    }
  };
  return { opening, error, open };
}

function DemoChooser({ demo, onClose }: { demo: ReturnType<typeof useDemo>; onClose: () => void }) {
  const titleId = useId();
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  return (
    <div className="demoOverlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="demoDialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <button className="demoClose" aria-label={t("Close")} onClick={onClose}>
          ×
        </button>
        <h2 id={titleId}>{t("Try MechanicPro with sample data")}</h2>
        <p>
          {t(
            "You get your own private copy of a service company, with jobs, technicians and customers. Nothing you do affects anyone else, and it's deleted after 24 hours. You can switch between the three views at any time.",
          )}
        </p>
        {demo.error && (
          <div className="error" role="alert">
            {demo.error}
          </div>
        )}
        <div className="demoChoices">
          {ROLES.map(({ role, label, icon, lead }) => (
            <button key={role} className="demoChoice" disabled={!!demo.opening} onClick={() => demo.open(role)}>
              <span className="ico" aria-hidden="true">
                {icon}
              </span>
              <b>{demo.opening === role ? t("Opening the demo…") : t("Try as {role}", { role: t(label) })}</b>
              <span>{t(lead)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The public homepage: what MechanicPro does, for whom, and what it costs. */
export default function Home({ onDemo }: { onDemo: (user: User) => void }) {
  const [pricing, failed] = usePricing();
  const [interval, setPeriod] = useState<Interval>("month");
  const [choosing, setChoosing] = useState(false);
  const demo = useDemo(onDemo);
  const trialDays = pricing?.trial_days ?? 14;
  return (
    <div className="site home">
      <SiteNav>
        <nav className="navLinks" aria-label={t("Sections")}>
          {SECTIONS.map(([id, label]) => (
            <button key={id} onClick={() => scrollToSection(id)}>
              {t(label)}
            </button>
          ))}
        </nav>
        <div className="navActions">
          <button className="btn outline" onClick={() => go("/signin")}>
            {t("Log in")}
          </button>
          <button className="btn primary" onClick={() => go("/signup")}>
            {t("Get started")}
          </button>
        </div>
      </SiteNav>

      <section className="hero">
        <div className="container">
          <div className="badge">● {t("Field service management made simple")}</div>
          <h1>
            <Trans text="Run your service team from {highlight}" values={{ highlight: <span className="gradient">{t("one place.")}</span> }} />
          </h1>
          <p>{t("Manage jobs, technicians, equipment, parts, service history and customers without drowning in paperwork.")}</p>
          <div className="heroButtons">
            <button className="btn primary" onClick={() => go("/signup")}>
              {t("Start now")} <ForwardArrow />
            </button>
            <button className="btn outline" onClick={() => setChoosing(true)}>
              {t("Try the demo")}
            </button>
            <button className="btn outline" onClick={() => scrollToSection("features")}>
              {t("Explore features")}
            </button>
          </div>
          <DashboardPreview />
        </div>
      </section>

      <section id="features" className="siteSection">
        <div className="container">
          <div className="head">
            <h2>{t("Everything your service operation needs.")}</h2>
            <p>{t("Keep the whole service lifecycle connected, from the first request to the final report.")}</p>
          </div>
          <div className="featureGrid">
            {FEATURES.map(([icon, title, text]) => (
              <article className="feature" key={title}>
                <div className="ico" aria-hidden="true">
                  {icon}
                </div>
                <h3>{t(title)}</h3>
                <p>{t(text)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="roles" className="siteSection">
        <div className="container">
          <div className="head">
            <h2>{t("One workflow. Three powerful views.")}</h2>
            <p>{t("Everyone gets the information they need without exposing what they don't.")}</p>
          </div>
          <div className="roleGrid">
            {ROLES.map(({ role, label, icon, title, lead, points }) => (
              <article className="role" key={title}>
                <div className="ico" aria-hidden="true">
                  {icon}
                </div>
                <h3>{t(title)}</h3>
                <p>{t(lead)}</p>
                <ul>
                  {points.map((point) => (
                    <li key={point}>{t(point)}</li>
                  ))}
                </ul>
                <button className="roleTry" disabled={!!demo.opening} onClick={() => demo.open(role)}>
                  {demo.opening === role ? (
                    t("Opening the demo…")
                  ) : (
                    <>
                      {t("Try it as {role}", { role: t(label) })} <ForwardArrow />
                    </>
                  )}
                </button>
              </article>
            ))}
          </div>
          {demo.error && !choosing && (
            <div className="error" role="alert">
              {demo.error}
            </div>
          )}
        </div>
      </section>

      <section id="subscriptions" className="siteSection">
        <div className="container">
          <div className="head">
            <h2>{t("Choose the level that fits your operation.")}</h2>
            <p>{t("Every plan includes everything that works today. Bigger plans add technicians and storage now, with more control and automation on the way.")}</p>
          </div>
          {pricing ? (
            <>
              <PeriodToggle value={interval} onChange={setPeriod} freeMonths={12 - pricing.yearly_months} />
              <div className="pricingGrid">
                {pricing.plans.map((plan) => (
                  <PlanCard key={plan.key} plan={plan} pricing={pricing} interval={interval} />
                ))}
              </div>
              <div className="compareWrap">
                <table className="compare">
                  <thead>
                    <tr>
                      <th>{t("Capability")}</th>
                      {pricing.plans.map((plan) => (
                        <th key={plan.key}>{t(plan.name)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {COMPARE.map(([label, value]) => (
                      <tr key={label}>
                        <td>{t(label)}</td>
                        {pricing.plans.map((plan) => (
                          <td key={plan.key}>
                            <CompareCell value={value(plan)} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <PlanSwitcher plans={pricing.plans} interval={interval} />
              <p className="pricingNote">
                {t(
                  "Prices in Kenyan shillings. Every plan starts with a {days}-day free trial, no card needed. When a trial ends nothing is deleted, and jobs in progress can still be finished. Planned features are on the way and not available yet.",
                  { days: trialDays },
                )}{" "}
                {t("More technicians can be added to any plan for {price} a month each.", { price: money(pricing.extra_mechanic_cents, pricing.currency) })}
                {pricing.payment_provider === "test" && ` ${t("Payments on this server are in test mode: no real money is taken.")}`}
                {!pricing.payment_provider && ` ${t("Online payment isn't switched on yet, so every company starts on the free trial.")}`}
              </p>
            </>
          ) : (
            <p className="pricingNote">{failed ? t("Prices couldn't be loaded. Refresh the page to try again.") : t("Loading plans…")}</p>
          )}
        </div>
      </section>

      <section className="siteSection ctaSection">
        <div className="container">
          <div className="cta">
            <h2>{t("Stop managing service work in spreadsheets.")}</h2>
            <p>{t("Bring your jobs, technicians, equipment and customers into one organized system.")}</p>
            <button className="btn primary" onClick={() => go("/signup")}>
              {t("Create your account")} <ForwardArrow />
            </button>
          </div>
        </div>
      </section>

      {choosing && <DemoChooser demo={demo} onClose={() => setChoosing(false)} />}

      <footer className="siteFooter">
        <div className="container foot">
          <span>
            © {new Date().getFullYear()} MechanicPro. {t("Field service management.")}
          </span>
          <LanguagePicker className="footLanguage" />
          <nav className="footLinks" aria-label={t("Legal")}>
            <a href="#/privacy">{t("Privacy policy")}</a>
            <a href="#/terms">{t("Terms of service")}</a>
          </nav>
          <span>{t("Built for service teams.")}</span>
        </div>
      </footer>
      <LanguageSuggestion />
    </div>
  );
}
