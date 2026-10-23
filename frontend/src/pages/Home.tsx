import { useState, type ReactNode } from "react";
import { go, money } from "../lib/route";
import { usePricing, type Interval, type Plan, type Pricing } from "../components/Plans";
import "./Home.css";

const SECTIONS = [
  ["features", "Features"],
  ["roles", "How it works"],
  ["subscriptions", "Subscriptions"],
] as const;

const FEATURES = [
  ["📋", "Job management", "Create jobs, assign mechanics, track progress and keep job information together."],
  ["🔧", "Machine history", "See previous repairs, replaced parts, solutions and service records for every machine."],
  ["👨‍🔧", "Mechanic tracking", "Give mechanics their jobs, collect updates and know what work is complete."],
  ["📦", "Parts tracking", "Record parts used during service and keep a replacement history for every machine."],
  ["⭐", "Customer feedback", "Customers rate completed work, and their requests and updates stay with the job."],
  ["📊", "Reports", "Follow jobs by status, customer ratings and the hours your team has worked."],
  ["📸", "Photos & sign-off", "Before and after photos and videos on every job, and the customer signs on the mechanic's phone."],
  ["📍", "Clock-in & team map", "Mechanics clock in on their phones, and you see who is on site, with their consent."],
  ["📄", "PDF service reports", "Every finished job gets a PDF report with the work done, parts, photos and signature."],
];

const ROLES = [
  {
    icon: "👔",
    title: "Boss / Manager",
    lead: "Control the operation and keep jobs moving.",
    points: ["Assign mechanics to jobs", "Monitor job progress", "Manage customers and their machines", "See who is on shift on the team map", "View reports and service history"],
  },
  {
    icon: "🧰",
    title: "Mechanic",
    lead: "Everything needed to complete a job.",
    points: ["View assigned jobs", "Update work status", "Record parts used", "Add solutions and notes", "Add photos and get the customer's signature"],
  },
  {
    icon: "👤",
    title: "Customer",
    lead: "A simple portal for service customers.",
    points: ["Request service", "Track service requests", "View machine history", "Download signed service reports", "Leave reviews"],
  },
];

/** Words for each plan. What a plan includes and costs comes from the server; "planned" items
 * aren't built yet and are shown as such. */
const PLAN_COPY: Record<string, { desc: string; team: string; features: string[]; planned: string[]; best: string }> = {
  starter: {
    desc: "Do the work. Keep everyday service jobs organized.",
    team: "Small teams",
    features: [
      "Job creation and assignment",
      "Machine and customer records",
      "Service history and repair notes",
      "Parts, checklists and photos",
      "Customer sign-off and PDF reports",
      "Clock-in, team map and notifications",
    ],
    planned: [],
    best: "Small workshops needing a simple, fast workflow.",
  },
  professional: {
    desc: "Organize the work across a growing team.",
    team: "Growing teams",
    features: ["Everything in Starter"],
    planned: ["Custom statuses and fields", "Reminders and approvals", "Workload and job timelines", "More detailed dashboard analytics"],
    best: "Teams ready for more structure and fewer manual follow-ups.",
  },
  business: {
    desc: "Run a larger operation, with room to grow.",
    team: "Larger operations",
    features: ["Everything in Professional"],
    planned: [
      "Branch, team and mechanic views",
      "Bulk actions and saved views",
      "Costing and operational analytics",
      "Advanced roles and permissions",
      "Escalations and assignment rules",
    ],
    best: "Established service businesses with multiple teams or sites.",
  },
};

const RECOMMENDED = "professional";

const COMPARE: [string, (plan: Plan) => string][] = [
  ["Mechanics", (plan) => `Up to ${plan.mechanics}`],
  ["Storage for photos, videos & signatures", (plan) => `${plan.storage_gb} GB`],
  ["Jobs, customers & machines", () => "Unlimited"],
  ["Mechanic app, checklists & parts", () => "Included"],
  ["Photos, sign-off & PDF reports", () => "Included"],
  ["Team map, shifts & reviews", () => "Included"],
  ["Custom statuses & fields", (plan) => (plan.key === "starter" ? "—" : "Planned")],
  ["Reminders & approvals", (plan) => (plan.key === "starter" ? "—" : "Planned")],
  ["Integrations", (plan) => (plan.key === "starter" ? "—" : "Planned")],
  ["Branches, roles & costing", (plan) => (plan.key === "business" ? "Planned" : "—")],
];

const scrollToSection = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

/** The bar across the top of the public pages; each page adds its own links and buttons. */
export function SiteNav({ children }: { children?: ReactNode }) {
  return (
    <div className="siteNav">
      <div className="container navRow">
        <button className="siteLogo" onClick={() => go("/")} aria-label="MechanicPro home">
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
    <div className="periodToggle" role="group" aria-label="Billing period">
      <button type="button" aria-pressed={value === "month"} onClick={() => onChange("month")}>
        Monthly
      </button>
      <button type="button" aria-pressed={value === "year"} onClick={() => onChange("year")}>
        Yearly <span className="save">Save {freeMonths} months</span>
      </button>
    </div>
  );
}

/** An illustration of the manager's dashboard. */
function DashboardPreview() {
  const jobs = [
    ["Hydraulic pump inspection", "In progress", "progress"],
    ["Engine service · CAT 320", "Assigned", "assigned"],
    ["Generator maintenance", "Completed", "done"],
  ];
  return (
    <div className="preview" aria-hidden="true">
      <div className="previewInner">
        <div className="dots">
          ● &nbsp; ● &nbsp; ●<span className="sample">Sample data</span>
        </div>
        <div className="dash">
          <div className="side">
            <div className="current">▣ Dashboard</div>
            <div>◉ Jobs</div>
            <div>⚙ Machines</div>
            <div>♙ Mechanics</div>
            <div>▤ Service history</div>
          </div>
          <div className="dashMain">
            <h3>Good morning, Manager 👋</h3>
            <div className="pvStats">
              <div>
                <small>ACTIVE JOBS</small>
                <b>18</b>
              </div>
              <div>
                <small>COMPLETED</small>
                <b>126</b>
              </div>
              <div>
                <small>MECHANICS</small>
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
      {recommended && <span className="tag">Recommended</span>}
      <h3>{plan.name}</h3>
      <p className="desc">{copy.desc}</p>
      <div className="price">
        {money(plan.prices[interval], pricing.currency)} <small>/ {interval}</small>
      </div>
      <div className="yearNote">
        {interval === "year"
          ? `Up to ${plan.mechanics} mechanics · Save ${money(yearlySaving, pricing.currency)} a year`
          : `${copy.team} · Up to ${plan.mechanics} mechanics`}
      </div>
      <button className={`btn ${recommended ? "primary" : "outline"}`} onClick={() => go(`/signup?plan=${plan.key}&interval=${interval}`)}>
        Choose {plan.name}
      </button>
      <ul>
        {copy.features.map((item) => (
          <li key={item}>{item}</li>
        ))}
        {copy.planned.map((item) => (
          <li key={item} className="planned">
            {item} <em>Planned</em>
          </li>
        ))}
      </ul>
      <h4>Customers & jobs</h4>
      <p className="detail">Unlimited customers, machines and jobs.</p>
      <h4>Storage</h4>
      <p className="detail">{plan.storage_gb} GB for photos, videos and signatures.</p>
      <h4>Best for</h4>
      <p className="detail">{copy.best}</p>
    </article>
  );
}

function CompareCell({ value }: { value: string }) {
  if (value === "Planned") return <em className="pill">Planned</em>;
  if (value === "Included") return <span className="yes">✓ Included</span>;
  return <>{value}</>;
}

/** Existing companies change plan from Billing, after signing in. */
function PlanSwitcher({ plans, interval }: { plans: Plan[]; interval: Interval }) {
  const [choice, setChoice] = useState(RECOMMENDED);
  return (
    <div className="switcher">
      <h3>Already using MechanicPro?</h3>
      <p>
        Change your plan from Billing in your account. Renewing the plan you have adds time after it ends; a different plan starts the day you pay.
      </p>
      <div className="switchRow">
        <select aria-label="Choose a subscription plan" value={choice} onChange={(event) => setChoice(event.target.value)}>
          {plans.map((plan) => (
            <option key={plan.key} value={plan.key}>
              {plan.name}
            </option>
          ))}
        </select>
        <button className="btn primary" onClick={() => go(`/signin?next=billing&plan=${choice}&interval=${interval}`)}>
          Continue to Billing
        </button>
      </div>
    </div>
  );
}

/** The public homepage: what MechanicPro does, for whom, and what it costs. */
export default function Home() {
  const [pricing, failed] = usePricing();
  const [interval, setPeriod] = useState<Interval>("month");
  const trialDays = pricing?.trial_days ?? 14;
  return (
    <div className="site home">
      <SiteNav>
        <nav className="navLinks" aria-label="Sections">
          {SECTIONS.map(([id, label]) => (
            <button key={id} onClick={() => scrollToSection(id)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="navActions">
          <button className="btn outline" onClick={() => go("/signin")}>
            Log in
          </button>
          <button className="btn primary" onClick={() => go("/signup")}>
            Get started
          </button>
        </div>
      </SiteNav>

      <section className="hero">
        <div className="container">
          <div className="badge">● Field service management made simple</div>
          <h1>
            Run your service team from <span className="gradient">one place.</span>
          </h1>
          <p>Manage jobs, mechanics, machines, parts, service history and customers without drowning in paperwork.</p>
          <div className="heroButtons">
            <button className="btn primary" onClick={() => go("/signup")}>
              Start now →
            </button>
            <button className="btn outline" onClick={() => scrollToSection("features")}>
              Explore features
            </button>
          </div>
          <DashboardPreview />
        </div>
      </section>

      <section id="features" className="siteSection">
        <div className="container">
          <div className="head">
            <h2>Everything your service operation needs.</h2>
            <p>Keep the whole service lifecycle connected, from the first request to the final report.</p>
          </div>
          <div className="featureGrid">
            {FEATURES.map(([icon, title, text]) => (
              <article className="feature" key={title}>
                <div className="ico" aria-hidden="true">
                  {icon}
                </div>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="roles" className="siteSection">
        <div className="container">
          <div className="head">
            <h2>One workflow. Three powerful views.</h2>
            <p>Everyone gets the information they need without exposing what they don't.</p>
          </div>
          <div className="roleGrid">
            {ROLES.map(({ icon, title, lead, points }) => (
              <article className="role" key={title}>
                <div className="ico" aria-hidden="true">
                  {icon}
                </div>
                <h3>{title}</h3>
                <p>{lead}</p>
                <ul>
                  {points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="subscriptions" className="siteSection">
        <div className="container">
          <div className="head">
            <h2>Choose the level that fits your operation.</h2>
            <p>Every plan includes everything that works today. Bigger plans add mechanics and storage now, with more control and automation on the way.</p>
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
                      <th>Capability</th>
                      {pricing.plans.map((plan) => (
                        <th key={plan.key}>{plan.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {COMPARE.map(([label, value]) => (
                      <tr key={label}>
                        <td>{label}</td>
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
                Prices in Kenyan shillings. Every plan starts with a {trialDays}-day free trial, no card needed. When a trial ends nothing is deleted, and
                jobs in progress can still be finished. Planned features are on the way and not available yet.
                {pricing.payment_provider === "test" && " Payments on this server are in test mode: no real money is taken."}
                {!pricing.payment_provider && " Online payment isn't switched on yet, so every company starts on the free trial."}
              </p>
            </>
          ) : (
            <p className="pricingNote">{failed ? "Prices couldn't be loaded. Refresh the page to try again." : "Loading plans…"}</p>
          )}
        </div>
      </section>

      <section className="siteSection ctaSection">
        <div className="container">
          <div className="cta">
            <h2>Stop managing service work in spreadsheets.</h2>
            <p>Bring your jobs, mechanics, machines and customers into one organized system.</p>
            <button className="btn primary" onClick={() => go("/signup")}>
              Create your account →
            </button>
          </div>
        </div>
      </section>

      <footer className="siteFooter">
        <div className="container foot">
          <span>© {new Date().getFullYear()} MechanicPro. Field service management.</span>
          <span>Built for service teams.</span>
        </div>
      </footer>
    </div>
  );
}
