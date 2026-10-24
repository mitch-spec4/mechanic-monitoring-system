import { Lock } from "lucide-react";
import type { User } from "../services/api";
import type { Feature } from "../services/types";
import { FEATURES } from "../lib/plan";
import { go } from "../lib/route";
import { t } from "../i18n";

/** In place of a feature the company's plan doesn't include: what it is, which plan has it, and
 *  (for managers) the way to Billing. */
export default function PlanLocked({ feature, user, compact }: { feature: Feature; user: User; compact?: boolean }) {
  const { name, plan } = FEATURES[feature];
  return (
    <div className={`planLocked ${compact ? "compact" : ""}`} role="note">
      <span className="planLockedIcon" aria-hidden="true">
        <Lock size={compact ? 16 : 20} />
      </span>
      <div>
        <strong>{t("{feature} is on the {plan} plan", { feature: t(name), plan: t(plan) })}</strong>
        <p>{user.role === "boss" ? t("Upgrade under Billing to use it. Everything you have now stays as it is.") : t("Ask your manager about upgrading the plan.")}</p>
      </div>
      {user.role === "boss" && (
        <button className="primary" onClick={() => go("/billing")}>
          {t("See plans")}
        </button>
      )}
    </div>
  );
}
