import { AlertTriangle, Sparkles } from "lucide-react";
import type { Subscription } from "../services/types";
import { formatDay } from "../lib/format";
import { go } from "../lib/route";
import { t } from "../i18n";
import "./Plan.css";

/** Across the app for managers: the free trial's days left, a payment that failed or is due, or a
 *  plan that has ended (new jobs and invitations then wait; nothing is deleted). */
export default function PlanBanner({ subscription }: { subscription: Subscription | null | undefined }) {
  if (!subscription || (subscription.state === "active" && !subscription.payment_problem)) return null;
  const { state, days_left: days } = subscription;
  const grace = subscription.grace_ends_at ? formatDay(subscription.grace_ends_at) : "";
  let tone = "trial";
  let text;
  if (state === "trialing") {
    tone = days != null && days <= 3 ? "soon" : "trial";
    text = days === 1 ? t("Free trial: 1 day left.") : t("Free trial: {count} days left.", { count: days ?? 0 });
  } else if (state === "expired") {
    tone = "ended";
    text = subscription.current_period_end
      ? t("Your plan has ended. New jobs and invitations wait until it's paid; nothing is deleted.")
      : t("Your free trial has ended. New jobs and invitations wait until you choose a plan; nothing is deleted.");
  } else {
    tone = "soon";
    text = state === "past_due" ? t("Your plan is due for payment. Everything keeps working until {date}.", { date: grace }) : t("Your last payment didn't go through. Pay by {date} to keep everything working.", { date: grace });
  }
  return (
    <div className={`planBanner ${tone}`} role="status" data-testid="plan-banner">
      {tone === "trial" ? <Sparkles size={17} /> : <AlertTriangle size={17} />}
      <span>{text}</span>
      <button className="primary" onClick={() => go("/billing")}>
        {state === "trialing" || state === "expired" ? t("Choose a plan") : t("Pay now")}
      </button>
    </div>
  );
}
