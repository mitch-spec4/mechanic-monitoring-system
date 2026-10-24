import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, CreditCard, HardDrive, Receipt, Sparkles, Users } from "lucide-react";
import { billing, startCheckout, type Billing } from "../services/api";
import type { Subscription } from "../services/types";
import { go, money } from "../lib/route";
import { errorMessage, formatBytes, formatDay } from "../lib/format";
import { IntervalSwitch, PlanCards, type Interval, type Plan } from "../components/Plans";
import { mark, t } from "../i18n";
import "./Billing.css";
import { Loading } from "../components/States";

const STATE_LABEL: Record<string, string> = { trialing: mark("Free trial"), active: mark("Active"), expired: mark("Ended") };

function statusLine(subscription: Subscription) {
  if (subscription.state === "trialing")
    return subscription.days_left === 1 ? t("1 day left in your free trial.") : t("{count} days left in your free trial.", { count: subscription.days_left ?? 0 });
  if (subscription.state === "expired")
    return subscription.trial_ends_at && !subscription.current_period_end
      ? t("Your free trial has ended. Choose a plan to keep adding jobs and inviting people.")
      : t("Your plan has run out. Pay to keep adding jobs and inviting people.");
  return subscription.current_period_end ? t("Paid until {date}.", { date: formatDay(subscription.current_period_end) }) : t("No renewal date.");
}

function Meter({ icon, label, used, limit, text }: { icon: ReactNode; label: string; used: number; limit: number | null; text: string }) {
  const share = limit ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div className="meter">
      <div className="meterHead">
        {icon}
        <span>{label}</span>
        <b>{text}</b>
      </div>
      <div className="meterTrack">
        <i className={share >= 90 ? "full" : ""} style={{ width: `${Math.max(share, used ? 2 : 0)}%` }} />
      </div>
    </div>
  );
}

type Props = { focus?: { plan: string; interval: Interval } };

/** The boss's plan, usage against its limits, choosing or renewing a plan, and past payments.
 * Coming from the homepage, the plan chosen there is picked out. */
export default function BillingPage({ focus }: Props) {
  const [data, setData] = useState<Billing | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [interval, setPeriod] = useState<Interval>(focus?.interval || "month");

  useEffect(() => {
    billing()
      .then((result) => {
        setData(result);
        if (!focus && result.subscription?.interval === "year") setPeriod("year");
      })
      .catch((problem) => setError(errorMessage(problem)));
  }, []);

  const choose = async (plan: string) => {
    setError("");
    setBusy(plan);
    try {
      const { checkout_url } = await startCheckout(plan, interval);
      go(checkout_url);
    } catch (problem) {
      setError(errorMessage(problem));
      setBusy("");
    }
  };

  if (!data) return <main className="billingPage">{error ? <div className="error">{error}</div> : <Loading label={t("Loading billing…")} />}</main>;
  const { subscription, usage, payments } = data;
  const current = subscription && subscription.state !== "expired" && subscription.state !== "trialing" ? subscription : null;
  const label = (plan: string) => {
    const name = t(data.plans.find((item: Plan) => item.key === plan)?.name ?? plan);
    if (busy === plan) return t("Opening checkout…");
    if (current && current.plan === plan && current.interval === interval) return t("Renew");
    if (subscription?.plan === plan && !current) return t("Pay for {plan}", { plan: name });
    return t("Switch to {plan}", { plan: name });
  };

  return (
    <main className="billingPage">
      <div className="billingHead">
        <span className="eyebrow">{t("Billing")}</span>
        <h1>{t("Your plan")}</h1>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {subscription ? (
        <section className={`planStatus ${subscription.state}`}>
          <span className="planStatusIcon">{subscription.state === "expired" ? <AlertTriangle size={22} /> : <Sparkles size={22} />}</span>
          <div>
            <h2>
              {t("{plan} plan", { plan: t(subscription.plan_name) })} <em className={`statePill ${subscription.state}`}>{t(STATE_LABEL[subscription.state])}</em>
            </h2>
            <p>{statusLine(subscription)}</p>
          </div>
        </section>
      ) : (
        <section className="planStatus active">
          <span className="planStatusIcon">
            <Sparkles size={22} />
          </span>
          <div>
            <h2>{t("No plan needed")}</h2>
            <p>{t("Your company was set up before plans existed, so it has no limits.")}</p>
          </div>
        </section>
      )}

      <section className="billingCard">
        <h2>{t("Usage")}</h2>
        <div className="meters">
          <Meter
            icon={<Users size={16} />}
            label={t("Technicians, including open invitations")}
            used={usage.mechanics}
            limit={usage.mechanic_limit}
            text={usage.mechanic_limit ? t("{used} of {limit}", { used: usage.mechanics, limit: usage.mechanic_limit }) : String(usage.mechanics)}
          />
          <Meter
            icon={<HardDrive size={16} />}
            label={t("Photos, videos and signatures")}
            used={usage.storage_bytes}
            limit={usage.storage_limit_bytes}
            text={
              usage.storage_limit_bytes
                ? t("{used} of {limit}", { used: formatBytes(usage.storage_bytes), limit: formatBytes(usage.storage_limit_bytes) })
                : formatBytes(usage.storage_bytes)
            }
          />
        </div>
      </section>

      <section className="billingCard">
        <div className="billingCardHead">
          <h2>{current ? t("Change or renew your plan") : t("Choose a plan")}</h2>
          <IntervalSwitch value={interval} onChange={setPeriod} freeMonths={12 - data.yearly_months} />
        </div>
        {!data.payment_provider && (
          <p className="billingNote">
            <CreditCard size={15} /> {t("Online payment isn't set up on this server yet.")}
          </p>
        )}
        {data.payment_provider === "test" && (
          <p className="billingNote">
            <CreditCard size={15} /> {t("Payments are in test mode: no real card is charged.")}
          </p>
        )}
        <PlanCards
          pricing={data}
          interval={interval}
          onChoose={(plan) => data.payment_provider && !busy && choose(plan)}
          cta={label}
          focus={focus?.plan}
        />
      </section>

      <section className="billingCard">
        <h2>
          <Receipt size={17} /> {t("Payments")}
        </h2>
        {payments.length ? (
          <table className="paymentTable">
            <thead>
              <tr>
                <th>{t("Date")}</th>
                <th>{t("Plan")}</th>
                <th>{t("Amount")}</th>
                <th>{t("Status")}</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.reference}>
                  <td>{formatDay(payment.paid_at)}</td>
                  <td>
                    {t(payment.plan_name)} · {payment.interval === "year" ? t("yearly") : t("monthly")}
                  </td>
                  <td>{money(payment.amount_cents, payment.currency)}</td>
                  <td>
                    <span className="paidPill">{payment.provider === "test" ? t("Paid (test)") : t("Paid")}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">{t("No payments yet.")}</p>
        )}
      </section>
    </main>
  );
}

/** A reminder on the boss dashboard while on a free trial, or once it has ended. */
export function PlanBanner({ onOpenBilling }: { onOpenBilling: () => void }) {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  useEffect(() => {
    billing()
      .then((result) => setSubscription(result.subscription))
      .catch(() => {});
  }, []);
  if (!subscription || subscription.state === "active") return null;
  const ended = subscription.state === "expired";
  return (
    <div className={`planBanner ${ended ? "ended" : ""}`} role="status">
      {ended ? <AlertTriangle size={17} /> : <Sparkles size={17} />}
      <span>
        {ended ? (
          <>
            <b>{t("Your free trial has ended.")}</b> {t("Choose a plan to keep adding jobs and inviting people.")}
          </>
        ) : (
          <>
            <b>{t("Free trial:")}</b> {statusLine(subscription)}
          </>
        )}
      </span>
      <button className="primary" onClick={onOpenBilling}>
        {t("Choose a plan")}
      </button>
    </div>
  );
}
