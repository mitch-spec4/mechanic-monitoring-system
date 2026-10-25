import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, CreditCard, HardDrive, Minus, Plus, Receipt, RefreshCw, Sparkles, Users } from "lucide-react";
import { billing, confirmPayment, me, setRenewal, startCheckout, testRenew, type Billing, type User } from "../services/api";
import type { Subscription } from "../services/types";
import { money, openCheckout } from "../lib/route";
import { errorMessage, formatBytes, formatDay } from "../lib/format";
import { IntervalSwitch, PlanCards, type Interval, type Plan } from "../components/Plans";
import { confirmAction, toast } from "../components/Feedback";
import { mark, t } from "../i18n";
import "./Billing.css";
import { Loading } from "../components/States";

const STATE_LABEL: Record<Subscription["state"], string> = { trialing: mark("Free trial"), active: mark("Active"), past_due: mark("Payment due"), expired: mark("Ended") };

function statusLine(subscription: Subscription) {
  const grace = subscription.grace_ends_at ? formatDay(subscription.grace_ends_at) : "";
  if (subscription.state === "trialing")
    return subscription.days_left === 1 ? t("1 day left in your free trial.") : t("{count} days left in your free trial.", { count: subscription.days_left ?? 0 });
  if (subscription.state === "expired")
    return subscription.trial_ends_at && !subscription.current_period_end
      ? t("Your free trial has ended. Choose a plan to keep adding jobs and inviting people.")
      : t("Your plan has run out. Pay to keep adding jobs and inviting people.");
  if (subscription.state === "past_due") return t("Your plan is due for payment. Everything keeps working until {date}.", { date: grace });
  if (!subscription.current_period_end) return t("No renewal date.");
  const until = formatDay(subscription.current_period_end);
  if (subscription.payment_problem) return t("Paid until {date}. The renewal payment didn't go through: pay by {grace} to keep everything working.", { date: until, grace });
  return subscription.auto_renew ? t("Paid until {date}, then renews automatically.", { date: until }) : t("Paid until {date}. It won't renew.", { date: until });
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

type Props = {
  /** Coming from the homepage: the plan chosen there, picked out. */
  focus?: { plan: string; interval: Interval };
  /** Back from the payment provider's page: the payment to confirm. */
  paid?: string;
  onUserChanged?: (user: User) => void;
};

/** The boss's plan, usage against its limits, choosing or renewing a plan (with extra technicians),
 * renewal on or off, and past payments. */
export default function BillingPage({ focus, paid, onUserChanged }: Props) {
  const [data, setData] = useState<Billing | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [interval, setPeriod] = useState<Interval>(focus?.interval || "month");
  const [extra, setExtra] = useState(0);

  // The banner across the app follows the plan, so the saved profile is refreshed with it.
  const load = () =>
    billing().then((result) => {
      setData(result);
      me()
        .then((fresh) => onUserChanged?.(fresh.user))
        .catch(() => {});
      return result;
    });
  useEffect(() => {
    (paid ? confirmPayment(paid).catch(() => null) : Promise.resolve(null))
      .then((confirmed) => {
        if (confirmed?.payment.status === "paid") toast(t("Payment received: your {plan} plan is active.", { plan: t(confirmed.payment.plan_name) }));
        if (confirmed?.payment.status === "failed") toast(t("The payment didn't go through: {reason}", { reason: confirmed.payment.failure_reason || "-" }), "error");
        return load();
      })
      .then((result) => {
        if (!focus && result.subscription?.interval === "year") setPeriod("year");
        setExtra(result.subscription?.extra_mechanics ?? 0);
      })
      .catch((problem) => setError(errorMessage(problem)));
  }, []);

  const run = async (key: string, action: () => Promise<unknown>) => {
    setError("");
    setBusy(key);
    try {
      await action();
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setBusy("");
    }
  };
  const choose = (plan: string) =>
    run(plan, async () => {
      const { checkout_url } = await startCheckout(plan, interval, extra);
      openCheckout(checkout_url);
    });
  const renewal = (on: boolean) =>
    run("renewal", async () => {
      if (
        !on &&
        !(await confirmAction({
          title: t("Cancel renewal?"),
          message: t("Your plan stays until the end of the paid period, then new jobs and invitations wait until you pay again. Nothing is deleted."),
          confirmLabel: t("Cancel renewal"),
          cancelLabel: t("Keep renewing"),
          danger: true,
        }))
      )
        return;
      await setRenewal(on);
      toast(on ? t("Your plan will renew automatically.") : t("Renewal cancelled. Your plan ends with its paid period."));
      await load();
    });
  const renewNow = () =>
    run("renew-now", async () => {
      const result = await testRenew();
      toast(result.payment.status === "paid" ? t("Renewed with the saved test card.") : t("The test card was declined: {reason}", { reason: result.payment.failure_reason || "-" }), result.payment.status === "paid" ? "success" : "error");
      await load();
    });

  if (!data) return <main className="billingPage">{error ? <div className="error">{error}</div> : <Loading label={t("Loading billing…")} />}</main>;
  const { subscription, usage, payments } = data;
  const paying = subscription && (subscription.state === "active" || subscription.state === "past_due") ? subscription : null;
  const label = (plan: string) => {
    const name = t(data.plans.find((item: Plan) => item.key === plan)?.name ?? plan);
    if (busy === plan) return t("Opening checkout…");
    if (paying && paying.plan === plan && paying.interval === interval) return paying.extra_mechanics === extra ? t("Renew") : t("Pay for {plan}", { plan: name });
    if (subscription?.plan === plan && !paying) return t("Pay for {plan}", { plan: name });
    return t("Switch to {plan}", { plan: name });
  };
  const extraPrice = data.extra_mechanic_cents * (interval === "year" ? data.yearly_months : 1);
  const per = interval === "year" ? t("/ year") : t("/ month");

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
        <section className={`planStatus ${subscription.state}${subscription.payment_problem ? " problem" : ""}`}>
          <span className="planStatusIcon">
            {subscription.state === "expired" || subscription.payment_problem ? <AlertTriangle size={22} /> : <Sparkles size={22} />}
          </span>
          <div>
            <h2>
              {t("{plan} plan", { plan: t(subscription.plan_name) })} <em className={`statePill ${subscription.state}`}>{t(STATE_LABEL[subscription.state])}</em>
            </h2>
            <p>{statusLine(subscription)}</p>
            {(subscription.extra_mechanics > 0 || subscription.payment_method) && (
              <p className="planFacts">
                {[
                  subscription.extra_mechanics > 0
                    ? subscription.extra_mechanics === 1
                      ? t("1 extra technician")
                      : t("{count} extra technicians", { count: subscription.extra_mechanics })
                    : null,
                  subscription.payment_method ? t("Renews with {method}", { method: subscription.payment_method }) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </div>
          {subscription.state === "active" && subscription.current_period_end && (
            <div className="planStatusActions">
              {data.payment_provider === "test" && subscription.payment_method && (
                <button className="secondary" disabled={!!busy} onClick={renewNow}>
                  <RefreshCw size={14} /> {busy === "renew-now" ? t("Renewing…") : t("Renew now (test)")}
                </button>
              )}
              <button className="secondary" disabled={!!busy} onClick={() => renewal(!subscription.auto_renew)}>
                {subscription.auto_renew ? t("Cancel renewal") : t("Turn renewal back on")}
              </button>
            </div>
          )}
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
          <h2>{paying ? t("Change or renew your plan") : t("Choose a plan")}</h2>
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
        {data.payment_provider === "paystack" && (
          <p className="billingNote">
            <CreditCard size={15} /> {t("Card or M-Pesa through Paystack, in test mode: no real money is taken.")}
          </p>
        )}
        <div className="extraMechanics">
          <div>
            <strong id="extra-label">{t("Extra technicians")}</strong>
            <p>{t("{price} each {per}, on top of the plan's own.", { price: money(extraPrice, data.currency), per })}</p>
          </div>
          <div className="stepper" role="group" aria-labelledby="extra-label">
            <button className="iconButton" aria-label={t("One fewer")} disabled={extra === 0} onClick={() => setExtra(extra - 1)}>
              <Minus size={14} />
            </button>
            <output aria-live="polite">{extra}</output>
            <button className="iconButton" aria-label={t("One more")} disabled={extra >= data.max_extra_mechanics} onClick={() => setExtra(extra + 1)}>
              <Plus size={14} />
            </button>
          </div>
          {extra > 0 && <p className="extraTotal">{t("Adds {amount} to the plan you choose.", { amount: `${money(extraPrice * extra, data.currency)} ${per}` })}</p>}
        </div>
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
                  <td>{formatDay(payment.paid_at ?? payment.failed_at)}</td>
                  <td>
                    {t(payment.plan_name)} · {payment.interval === "year" ? t("yearly") : t("monthly")}
                    {payment.extra_mechanics > 0 && ` · ${t("+{count} technicians", { count: payment.extra_mechanics })}`}
                    {payment.kind === "renewal" && <small className="paymentKind">{t("Renewal")}</small>}
                  </td>
                  <td>{money(payment.amount_cents, payment.currency)}</td>
                  <td>
                    {payment.status === "failed" ? (
                      <span className="failedPill" title={payment.failure_reason ?? undefined}>
                        {t("Failed")}
                        {payment.failure_reason && <small>{payment.failure_reason}</small>}
                      </span>
                    ) : (
                      <span className="paidPill">{payment.provider === "test" ? t("Paid (test)") : t("Paid")}</span>
                    )}
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
