import { useEffect, useState } from "react";
import { AlertTriangle, CreditCard, HardDrive, Receipt, Sparkles, Users } from "lucide-react";
import { billing, startCheckout } from "../services/api";
import { go, money } from "../lib/route";
import { errorMessage, formatBytes, formatDate } from "../lib/format";
import { IntervalSwitch, PlanCards } from "./Home";
import "./Home.css";
import "./Billing.css";

const STATE_LABEL: Record<string, string> = { trialing: "Free trial", active: "Active", expired: "Ended" };

function statusLine(subscription: any) {
  if (subscription.state === "trialing") return `${subscription.days_left} day${subscription.days_left === 1 ? "" : "s"} left in your free trial.`;
  if (subscription.state === "expired")
    return subscription.trial_ends_at && !subscription.current_period_end
      ? "Your free trial has ended. Choose a plan to keep adding jobs and inviting people."
      : "Your plan has run out. Pay to keep adding jobs and inviting people.";
  return subscription.current_period_end ? `Paid until ${formatDate(subscription.current_period_end)}.` : "No renewal date.";
}

function Meter({ icon, label, used, limit, text }: { icon: any; label: string; used: number; limit: number | null; text: string }) {
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

/** The boss's plan, usage against its limits, choosing or renewing a plan, and past payments. */
export default function BillingPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [interval, setPeriod] = useState<"month" | "year">("month");

  useEffect(() => {
    billing()
      .then((result) => {
        setData(result);
        if (result.subscription?.interval === "year") setPeriod("year");
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

  if (!data) return <main className="billingPage">{error ? <div className="error">{error}</div> : <p className="muted">Loading billing…</p>}</main>;
  const { subscription, usage, payments } = data;
  const current = subscription && subscription.state !== "expired" && subscription.state !== "trialing" ? subscription : null;
  const label = (plan: string) => {
    if (busy === plan) return "Opening checkout…";
    if (current && current.plan === plan && current.interval === interval) return "Renew";
    if (subscription?.plan === plan && !current) return `Pay for ${data.plans.find((item: any) => item.key === plan).name}`;
    return `Switch to ${data.plans.find((item: any) => item.key === plan).name}`;
  };

  return (
    <main className="billingPage">
      <div className="billingHead">
        <span className="eyebrow">Billing</span>
        <h1>Your plan</h1>
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
              {subscription.plan_name} plan <em className={`statePill ${subscription.state}`}>{STATE_LABEL[subscription.state]}</em>
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
            <h2>No plan needed</h2>
            <p>Your company was set up before plans existed, so it has no limits.</p>
          </div>
        </section>
      )}

      <section className="billingCard">
        <h2>Usage</h2>
        <div className="meters">
          <Meter
            icon={<Users size={16} />}
            label="Mechanics, including open invitations"
            used={usage.mechanics}
            limit={usage.mechanic_limit}
            text={usage.mechanic_limit ? `${usage.mechanics} of ${usage.mechanic_limit}` : String(usage.mechanics)}
          />
          <Meter
            icon={<HardDrive size={16} />}
            label="Photos, videos and signatures"
            used={usage.storage_bytes}
            limit={usage.storage_limit_bytes}
            text={usage.storage_limit_bytes ? `${formatBytes(usage.storage_bytes)} of ${formatBytes(usage.storage_limit_bytes)}` : formatBytes(usage.storage_bytes)}
          />
        </div>
      </section>

      <section className="billingCard">
        <div className="billingCardHead">
          <h2>{current ? "Change or renew your plan" : "Choose a plan"}</h2>
          <IntervalSwitch value={interval} onChange={setPeriod} freeMonths={12 - data.yearly_months} />
        </div>
        {!data.payment_provider && (
          <p className="billingNote">
            <CreditCard size={15} /> Online payment isn't set up on this server yet.
          </p>
        )}
        {data.payment_provider === "test" && (
          <p className="billingNote">
            <CreditCard size={15} /> Payments are in test mode: no real card is charged.
          </p>
        )}
        <PlanCards pricing={data} interval={interval} onChoose={(plan) => data.payment_provider && !busy && choose(plan)} cta={label} />
      </section>

      <section className="billingCard">
        <h2>
          <Receipt size={17} /> Payments
        </h2>
        {payments.length ? (
          <table className="paymentTable">
            <thead>
              <tr>
                <th>Date</th>
                <th>Plan</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment: any) => (
                <tr key={payment.reference}>
                  <td>{formatDate(payment.paid_at)}</td>
                  <td>
                    {payment.plan_name} · {payment.interval === "year" ? "yearly" : "monthly"}
                  </td>
                  <td>{money(payment.amount_cents, payment.currency)}</td>
                  <td>
                    <span className="paidPill">Paid{payment.provider === "test" ? " (test)" : ""}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No payments yet.</p>
        )}
      </section>
    </main>
  );
}

/** A reminder on the boss dashboard while on a free trial, or once it has ended. */
export function PlanBanner({ onOpenBilling }: { onOpenBilling: () => void }) {
  const [subscription, setSubscription] = useState<any>(null);
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
            <b>Your free trial has ended.</b> Choose a plan to keep adding jobs and inviting people.
          </>
        ) : (
          <>
            <b>Free trial:</b> {statusLine(subscription)}
          </>
        )}
      </span>
      <button className="primary" onClick={onOpenBilling}>
        Choose a plan
      </button>
    </div>
  );
}
