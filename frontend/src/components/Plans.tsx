import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { plans as fetchPlans } from "../services/api";
import { money } from "../lib/route";

export type Interval = "month" | "year";
export type Plan = { key: string; name: string; mechanics: number; storage_gb: number; prices: Record<Interval, number> };
export type Pricing = { plans: Plan[]; currency: string; trial_days: number; yearly_months: number; payment_provider: string | null };

/** The plans and prices come from the server, so every page shows what checkout charges. */
export function usePricing() {
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetchPlans()
      .then(setPricing)
      .catch(() => setFailed(true));
  }, []);
  return [pricing, failed] as const;
}

/** The plan cards on the in-app Billing page. */
export function PlanCards({
  pricing,
  interval,
  onChoose,
  cta,
  focus,
}: {
  pricing: Pricing;
  interval: Interval;
  onChoose: (plan: string) => void;
  cta: (plan: string) => string;
  focus?: string;
}) {
  const focused = useRef<HTMLElement>(null);
  useEffect(() => {
    focused.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);
  return (
    <div className="planGrid">
      {pricing.plans.map((plan) => {
        const price = plan.prices[interval];
        const featured = plan.key === "professional";
        return (
          <article key={plan.key} ref={plan.key === focus ? focused : undefined} className={`planCard ${featured ? "featured" : ""} ${plan.key === focus ? "focused" : ""}`}>
            {featured && <span className="planBadge">Recommended</span>}
            <h3>{plan.name}</h3>
            <p className="planPrice">
              <strong>{money(price, pricing.currency)}</strong>
              <span>/ {interval}</span>
            </p>
            <p className="planBilled">
              {interval === "year" ? `${12 - pricing.yearly_months} months free compared with monthly` : "Billed monthly"}
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

export function IntervalSwitch({ value, onChange, freeMonths }: { value: Interval; onChange: (value: Interval) => void; freeMonths: number }) {
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
