import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { plans as fetchPlans } from "../services/api";
import { money } from "../lib/route";
import { FEATURES } from "../lib/plan";
import { t } from "../i18n";

import type { Interval, Plan, Pricing } from "../services/types";

export type { Interval, Plan, Pricing };

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
          <article
            key={plan.key}
            ref={plan.key === focus ? focused : undefined}
            className={`planCard ${featured ? "featured" : ""} ${plan.key === focus ? "focused" : ""}`}
          >
            {featured && <span className="planBadge">{t("Recommended")}</span>}
            <h3>{t(plan.name)}</h3>
            <p className="planPrice">
              <strong>{money(price, pricing.currency)}</strong>
              <span>{interval === "year" ? t("/ year") : t("/ month")}</span>
            </p>
            <p className="planBilled">
              {interval === "year" ? t("{count} months free compared with monthly", { count: 12 - pricing.yearly_months }) : t("Billed monthly")}
            </p>
            <ul>
              <li>
                <Check size={15} /> {t("Up to {count} technicians", { count: plan.mechanics })}
              </li>
              <li>
                <Check size={15} /> {t("{size} GB for photos and videos", { size: plan.storage_gb })}
              </li>
              <li>
                <Check size={15} /> {t("Unlimited customers, equipment and jobs")}
              </li>
              {plan.features.map((feature) => (
                <li key={feature}>
                  <Check size={15} /> {t(FEATURES[feature].name)}
                </li>
              ))}
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
    <div className="intervalSwitch" role="group" aria-label={t("Billing period")} style={{ "--pos": value === "year" ? 1 : 0 } as React.CSSProperties}>
      <span className="intervalThumb" aria-hidden="true" />
      <button type="button" aria-pressed={value === "month"} onClick={() => onChange("month")}>
        {t("Monthly")}
      </button>
      <button type="button" aria-pressed={value === "year"} onClick={() => onChange("year")}>
        {t("Yearly")} <em>{t("{count} months free", { count: freeMonths })}</em>
      </button>
    </div>
  );
}
