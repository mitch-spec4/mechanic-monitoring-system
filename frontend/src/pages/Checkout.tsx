import { useEffect, useState } from "react";
import { checkoutDetail, payTestCheckout } from "../services/api";
import { go, money } from "../lib/route";
import { errorMessage, formatDate } from "../lib/format";
import { SiteNav } from "./Home";
import "./Home.css";

type Props = { reference: string; user: any; onDone: () => void };

/** The test payment provider's card page. No real card is charged in test mode. */
export default function Checkout({ reference, user, onDone }: Props) {
  const [detail, setDetail] = useState<any>(null);
  const [subscription, setSubscription] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    checkoutDetail(reference)
      .then(setDetail)
      .catch((problem) => setError(errorMessage(problem)));
  }, [reference, user?.id]);

  const pay = async (outcome: "success" | "declined") => {
    setError("");
    setBusy(true);
    try {
      const result = await payTestCheckout(reference, outcome);
      setDetail({ ...detail, payment: result.payment });
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
            <h1>Log in to finish paying</h1>
            <p className="lead">This checkout belongs to a company account.</p>
            <button className="btn primary wide" onClick={() => go(`/signin?next=${encodeURIComponent(`/checkout/${reference}`)}`)}>
              Log in
            </button>
          </section>
        ) : !payment ? (
          <section className="formCard checkoutCard">{error ? <div className="error">{error}</div> : <p className="lead">Loading checkout…</p>}</section>
        ) : paid ? (
          <section className="formCard checkoutCard done" role="status">
            <div className="doneMark" aria-hidden="true">
              ✓
            </div>
            <h1>Payment received</h1>
            <p className="lead">
              Your <b>{payment.plan_name}</b> plan is active
              {subscription?.current_period_end ? ` until ${formatDate(subscription.current_period_end)}` : ""}.
            </p>
            <button className="btn primary wide" onClick={onDone}>
              Go to your dashboard
            </button>
          </section>
        ) : (
          <section className="formCard checkoutCard">
            <div className="testBanner">Test mode: no real card is charged.</div>
            <h1>Checkout</h1>
            <dl className="orderSummary">
              <div>
                <dt>Company</dt>
                <dd>{detail.company}</dd>
              </div>
              <div>
                <dt>Plan</dt>
                <dd>
                  {payment.plan_name} · {payment.interval === "year" ? "Yearly" : "Monthly"}
                </dd>
              </div>
              <div>
                <dt>Receipt to</dt>
                <dd>{detail.email}</dd>
              </div>
              <div className="orderTotal">
                <dt>Total today</dt>
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
              <label>
                Card number
                <input defaultValue="4242 4242 4242 4242" inputMode="numeric" autoComplete="off" />
              </label>
              <div className="cardRow">
                <label>
                  Expiry
                  <input defaultValue="12 / 34" autoComplete="off" />
                </label>
                <label>
                  CVC
                  <input defaultValue="123" autoComplete="off" />
                </label>
              </div>
              <button className="btn primary wide" disabled={busy}>
                <span aria-hidden="true">🔒</span> {busy ? "Processing…" : `Pay ${money(payment.amount_cents, payment.currency)}`}
              </button>
              <button type="button" className="textLink declineLink" disabled={busy} onClick={() => pay("declined")}>
                Try a declined card
              </button>
            </form>
          </section>
        )}
      </main>
    </div>
  );
}
