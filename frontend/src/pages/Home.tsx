import { useEffect, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  Camera,
  Check,
  ClipboardList,
  Clock,
  FileText,
  History,
  MapPin,
  PenLine,
  ShieldCheck,
  Smartphone,
  Star,
  UserRound,
  Users,
  Wrench,
} from "lucide-react";
import { plans as fetchPlans } from "../services/api";
import { go, money } from "../lib/route";
import "./Home.css";

export type Pricing = {
  plans: { key: string; name: string; mechanics: number; storage_gb: number; prices: { month: number; year: number } }[];
  currency: string;
  trial_days: number;
  yearly_months: number;
  payment_provider: string | null;
};

export function usePricing() {
  const [pricing, setPricing] = useState<Pricing | null>(null);
  useEffect(() => {
    fetchPlans().then(setPricing).catch(() => setPricing(null));
  }, []);
  return pricing;
}

const ROLES = [
  {
    key: "forManager",
    icon: BarChart3,
    title: "For the manager",
    lead: "See the whole operation without a single phone call.",
    points: [
      "Create and assign jobs in seconds",
      "See who is clocked in, and where, on a live team map",
      "Every customer's machines, with the ones that need work first",
      "A full history of every job: who did what, and when",
      "Shifts, hours and reports in one place",
    ],
  },
  {
    key: "forMechanic",
    icon: Wrench,
    title: "For the mechanic",
    lead: "One phone app for the whole job. No paperwork twice.",
    points: [
      "Clock in and see today's jobs",
      "A timer starts with the job, so hours record themselves",
      "Checklists, parts and notes on one worksheet",
      "Before and after photos and short videos",
      "The customer signs on the phone and the job closes",
    ],
  },
  {
    key: "forCustomer",
    icon: UserRound,
    title: "For the customer",
    lead: "Proof of every job, without chasing anyone.",
    points: [
      "Request service for any machine",
      "Follow each job as it moves",
      "See the photos, the work done and the signature",
      "Download the PDF service report",
      "Rate the service",
    ],
  },
];

const STEPS = [
  { icon: ClipboardList, title: "Request or create the job", text: "A customer requests service, or the manager creates the job for a machine." },
  { icon: Users, title: "Assign a mechanic", text: "One click. The mechanic is notified straight away." },
  { icon: Camera, title: "Work on site", text: "Clock in, start the timer, tick the checklist, add parts and photos." },
  { icon: PenLine, title: "Sign-off and report", text: "The customer signs on the phone and gets a PDF report to keep." },
];

const FAQ = [
  ["Do I need a card to start the free trial?", "No. Every plan starts with a free trial. Choose a plan and pay when you're ready."],
  [
    "What happens when the trial ends?",
    "Nothing is deleted. You can still see everything and finish jobs already in progress, but adding new jobs and inviting people needs a plan.",
  ],
  [
    "Who can sign in?",
    "You invite your mechanics and customers with a one-time invitation code. Each person only sees what their role allows, and companies never see each other's data.",
  ],
  [
    "Do mechanics need a special device?",
    "No, any smartphone with a modern browser. Their location is only shared while they're clocked in, and only after they agree.",
  ],
  [
    "Where are photos and videos kept?",
    "In private storage. They're only shown to people in your company who are allowed to see that job.",
  ],
];

export function PlanCards({ pricing, interval, onChoose, cta }: { pricing: Pricing; interval: "month" | "year"; onChoose: (plan: string) => void; cta: (plan: string) => string }) {
  return (
    <div className="planGrid">
      {pricing.plans.map((plan) => {
        const price = plan.prices[interval];
        const featured = plan.key === "team";
        return (
          <article key={plan.key} className={`planCard ${featured ? "featured" : ""}`}>
            {featured && <span className="planBadge">Recommended</span>}
            <h3>{plan.name}</h3>
            <p className="planPrice">
              <strong>{money(interval === "year" ? price / 12 : price, pricing.currency)}</strong>
              <span>/ month</span>
            </p>
            <p className="planBilled">
              {interval === "year" ? `${money(price, pricing.currency)} billed yearly, ${12 - pricing.yearly_months} months free` : "Billed monthly"}
            </p>
            <ul>
              <li>
                <Check size={15} /> Up to {plan.mechanics} mechanics
              </li>
              <li>
                <Check size={15} /> {plan.storage_gb} GB for photos and videos
              </li>
              <li>
                <Check size={15} /> Unlimited customers, machines and jobs
              </li>
              <li>
                <Check size={15} /> Every feature included
              </li>
            </ul>
            <button className={featured ? "primary" : "secondary"} onClick={() => onChoose(plan.key)}>
              {cta(plan.key)}
            </button>
          </article>
        );
      })}
    </div>
  );
}

export function IntervalSwitch({ value, onChange, freeMonths }: { value: "month" | "year"; onChange: (value: "month" | "year") => void; freeMonths: number }) {
  return (
    <div className="intervalSwitch" role="group" aria-label="Billing period" style={{ "--pos": value === "year" ? 1 : 0 } as React.CSSProperties}>
      <span className="intervalThumb" aria-hidden="true" />
      <button type="button" aria-pressed={value === "month"} onClick={() => onChange("month")}>
        Monthly
      </button>
      <button type="button" aria-pressed={value === "year"} onClick={() => onChange("year")}>
        Yearly <em>{freeMonths} months free</em>
      </button>
    </div>
  );
}

function HeroArt() {
  const jobs = [
    ["Service Generator G-102", "In Progress", "progress"],
    ["Repair Hydraulic Pump H-21", "Assigned", "assigned"],
    ["Conveyor Line CL-4 inspection", "Completed", "done"],
  ];
  return (
    <div className="heroArt" aria-hidden="true">
      <div className="artBoard">
        <div className="artHead">
          <span>Today's jobs</span>
          <b>3 active</b>
        </div>
        {jobs.map(([title, status, tone]) => (
          <div className="artJob" key={title}>
            <i className={tone} />
            <span>{title}</span>
            <em className={tone}>{status}</em>
          </div>
        ))}
        <div className="artTeam">
          <span className="artPulse" /> 2 mechanics clocked in
        </div>
      </div>
      <div className="artPhone">
        <div className="artPhoneHead">
          <PenLine size={12} /> Customer sign-off
        </div>
        <div className="artPhotos">
          <i className="before">Before</i>
          <i className="after">After</i>
        </div>
        <svg viewBox="0 0 200 60" className="artSignature">
          <path d="M8 40c10-22 18-30 24-26s-6 28-1 30 13-24 20-25 4 21 10 21 11-18 18-18-1 15 6 15 15-21 24-21 3 17 10 17c8 0 18-12 28-14s7 10 15 10 20-7 30-8" />
        </svg>
        <div className="artSigned">Signed by Grace Wanjiru</div>
        <div className="artButton">
          <Check size={13} /> Complete job
        </div>
      </div>
      <div className="artChip chipOne">
        <MapPin size={14} /> Mitch is on site
      </div>
      <div className="artChip chipTwo">
        <FileText size={14} /> Report ready
      </div>
    </div>
  );
}

export function SiteHeader() {
  return (
    <header className="siteHeader">
      <button className="siteLogo" onClick={() => go("/")}>
        <span className="siteMark">
          <Wrench size={16} />
        </span>
        MECHANIC<em>PRO</em>
      </button>
      <nav>
        <button className="siteLink" onClick={() => go("/signin")}>
          Sign in
        </button>
        <button className="primary" onClick={() => go("/signup")}>
          Start free trial
        </button>
      </nav>
    </header>
  );
}

/** The public homepage: what MechanicPro does, for whom, and what it costs. */
export default function Home() {
  const pricing = usePricing();
  const [interval, setPeriod] = useState<"month" | "year">("month");
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const trialDays = pricing?.trial_days ?? 14;
  return (
    <div className="site">
      <SiteHeader />
      <section className="hero">
        <div className="heroText">
          <span className="heroEyebrow">For equipment service companies</span>
          <h1>Every service job, from call-out to customer sign-off.</h1>
          <p>
            MechanicPro gives managers, mechanics and customers one shared record of every job: who is on site, what was done, the photos, and the
            customer's signature.
          </p>
          <div className="heroActions">
            <button className="primary" onClick={() => go("/signup")}>
              Start your {trialDays}-day free trial <ArrowRight size={16} />
            </button>
            <button className="secondary" onClick={() => scrollTo("pricing")}>
              See pricing
            </button>
          </div>
          <small>No card needed for the trial.</small>
        </div>
        <HeroArt />
      </section>

      <section className="siteSection" id="features">
        <div className="sectionHead">
          <span>One app, three accounts</span>
          <h2>Everyone sees the same job, from their side.</h2>
        </div>
        <div className="roleGrid">
          {ROLES.map(({ key, icon: Icon, title, lead, points }) => (
            <article key={key} className={`roleCard ${key}`}>
              <span className="roleIcon">
                <Icon size={20} />
              </span>
              <h3>{title}</h3>
              <p>{lead}</p>
              <ul>
                {points.map((point) => (
                  <li key={point}>
                    <Check size={15} /> {point}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="siteSection steps">
        <div className="sectionHead">
          <span>How it works</span>
          <h2>From the first call to the signed report.</h2>
        </div>
        <ol className="stepGrid">
          {STEPS.map(({ icon: Icon, title, text }, index) => (
            <li key={title}>
              <span className="stepNumber">{index + 1}</span>
              <Icon size={20} />
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>
        <div className="trustRow">
          <span>
            <ShieldCheck size={16} /> Invite-only accounts, each company's data kept apart
          </span>
          <span>
            <Smartphone size={16} /> Built for phones on site
          </span>
          <span>
            <History size={16} /> Records and reviews can't be deleted
          </span>
          <span>
            <Clock size={16} /> Hours recorded automatically
          </span>
        </div>
      </section>

      <section className="siteSection pricing" id="pricing">
        <div className="sectionHead">
          <span>Pricing</span>
          <h2>Simple plans. Every feature included.</h2>
          <p>
            Start with a {trialDays}-day free trial on any plan. Prices in US dollars.
          </p>
        </div>
        {pricing ? (
          <>
            <IntervalSwitch value={interval} onChange={setPeriod} freeMonths={12 - pricing.yearly_months} />
            <PlanCards
              pricing={pricing}
              interval={interval}
              onChoose={(plan) => go(`/signup?plan=${plan}&interval=${interval}`)}
              cta={() => "Start free trial"}
            />
          </>
        ) : (
          <p className="muted pricingLoading">Loading plans…</p>
        )}
      </section>

      <section className="siteSection faq">
        <div className="sectionHead">
          <span>Questions</span>
          <h2>Good to know</h2>
        </div>
        <div className="faqList">
          {FAQ.map(([question, answer]) => (
            <details key={question}>
              <summary>{question}</summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="finalCta">
        <Star size={22} />
        <h2>Run your next job on MechanicPro.</h2>
        <button className="primary" onClick={() => go("/signup")}>
          Start your free trial <ArrowRight size={16} />
        </button>
      </section>

      <footer className="siteFooter">
        <span>© {new Date().getFullYear()} MechanicPro</span>
        <button className="siteLink" onClick={() => go("/signin")}>
          Sign in
        </button>
      </footer>
    </div>
  );
}
