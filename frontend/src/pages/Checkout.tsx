import { useEffect, useState } from "react";
import { checkoutDetail, payTestCheckout, type User } from "../services/api";
import type { Payment, Subscription } from "../services/types";
import { go, money } from "../lib/route";
import { errorMessage, formatDay } from "../lib/format";
import { Trans } from "../i18n/Trans";
import { t } from "../i18n";
import { SiteNav } from "./Home";
import "./Home.css";
import Field from "../components/Field";

type Props = { reference: string; user: User | null; onDone: () => void };

/** The test payment provider's card page. No real card is charged in test mode. */
export default function Checkout({ reference, user, onDone }: Props) {
  const [detail, setDetail] = useState<{ payment: Payment; company: string; email: string } | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    checkoutDetail(reference)
      .then(setDetail)
      .catch((problem) => setError(errorMessage(problem)));
  }, [reference, user?.id]);

  const pay = async (outcome: "success" | "declined" | "declines_later") => {
    setError("");
    setBusy(true);
    try {
      const result = await payTestCheckout(reference, outcome);
      setDetail((current) => current && { ...current, payment: result.payment });
      setSubscription(result.subscription);
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  };

  const payment = detail?.payment;
  const paid = payment?.status === "paid";
  return (
    <div className="site checkoutPage">
      <SiteNav />
      <main className="container checkoutLayout">
        {!user ? (
          <section className="formCard checkoutCard">
            <h1>{t("Log in to finish paying")}</h1>
            <p className="lead">{t("This checkout belongs to a company account.")}</p>
            <button className="btn primary wide" onClick={() => go(`/signin?next=${encodeURIComponent(`/checkout/${reference}`)}`)}>
              {t("Log in")}
            </button>
          </section>
        ) : !payment ? (
          <section className="formCard checkoutCard">{error ? <div className="error">{error}</div> : <p className="lead">{t("Loading checkout…")}</p>}</section>
        ) : paid ? (
          <section className="formCard checkoutCard done" role="status">
            <div className="doneMark" aria-hidden="true">
              ✓
            </div>
            <h1>{t("Payment received")}</h1>
            <p className="lead">
              {subscription?.current_period_end ? (
                <Trans text="Your {plan} plan is active until {date}." values={{ plan: <b>{t(payment.plan_name)}</b>, date: formatDay(subscription.current_period_end) }} />
              ) : (
                <Trans text="Your {plan} plan is active." values={{ plan: <b>{t(payment.plan_name)}</b> }} />
              )}
            </p>
            <button className="btn primary wide" onClick={onDone}>
              {t("Go to your dashboard")}
            </button>
          </section>
        ) : (
          <section className="formCard checkoutCard">
            <div className="testBanner">{t("Test mode: no real card is charged.")}</div>
            <h1>{t("Checkout")}</h1>
            <dl className="orderSummary">
              <div>
                <dt>{t("Company")}</dt>
                <dd>{detail.company}</dd>
              </div>
              <div>
                <dt>{t("Plan")}</dt>
                <dd>
                  {t(payment.plan_name)} · {payment.interval === "year" ? t("Yearly") : t("Monthly")}
                </dd>
              </div>
              {payment.extra_mechanics > 0 && (
                <div>
                  <dt>{t("Extra technicians")}</dt>
                  <dd>{payment.extra_mechanics}</dd>
                </div>
              )}
              <div>
                <dt>{t("Receipt to")}</dt>
                <dd>{detail.email}</dd>
              </div>
              <div className="orderTotal">
                <dt>{t("Total today")}</dt>
                <dd>{money(payment.amount_cents, payment.currency)}</dd>
              </div>
            </dl>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <form
              className="cardForm"
              onSubmit={(event) => {
                event.preventDefault();
                pay("success");
              }}
            >
              <Field wrap label={t("Card number")}>
                <input defaultValue="4242 4242 4242 4242" inputMode="numeric" autoComplete="off" />
              </Field>
              <div className="cardRow">
                <Field wrap label={t("Expiry")}>
                  <input defaultValue="12 / 34" autoComplete="off" />
                </Field>
                <Field wrap label="CVC">
                  <input defaultValue="123" autoComplete="off" />
                </Field>
              </div>
              <button className="btn primary wide" disabled={busy}>
                <span aria-hidden="true">🔒</span> {busy ? t("Processing…") : t("Pay {amount}", { amount: money(payment.amount_cents, payment.currency) })}
              </button>
              <button type="button" className="textLink declineLink" disabled={busy} onClick={() => pay("declined")}>
                {t("Try a declined card")}
              </button>
              <button type="button" className="textLink declineLink" disabled={busy} onClick={() => pay("declines_later")}>
                {t("Pay with a card that will decline at renewal")}
              </button>
            </form>
          </section>
        )}
      </main>
    </div>
  );
}
