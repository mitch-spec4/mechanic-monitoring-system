import { useState } from "react";
import { saveSession, signup } from "../services/api";
import { go, money } from "../lib/route";
import { usePricing, type Interval } from "../components/Plans";
import { PeriodToggle, SiteNav } from "./Home";
import { errorMessage } from "../lib/format";
import "./Home.css";

type Props = { query: URLSearchParams; onSignedIn: (user: any, checkoutUrl?: string) => void };

/** A new company and its owner. Every plan starts as a free trial; paying now skips it. */
export default function Signup({ query, onSignedIn }: Props) {
  const [pricing, failed] = usePricing();
  const [plan, setPlan] = useState(query.get("plan") || "professional");
  const [interval, setPeriod] = useState<Interval>(query.get("interval") === "year" ? "year" : "month");
  const [form, setForm] = useState({ company_name: "", name: "", email: "", password: "" });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  // A link to a plan that doesn't exist (or no longer does) falls back to Professional.
  const chosen = pricing?.plans.find((item) => item.key === plan) || pricing?.plans.find((item) => item.key === "professional") || pricing?.plans[0];
  const trialDays = pricing?.trial_days ?? 14;
  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value }),
  });

  const submit = async (payNow: boolean) => {
    if (!chosen) return;
    setError("");
    setBusy(payNow ? "Preparing checkout…" : "Creating your account…");
    try {
      const data = await signup({ ...form, plan: chosen.key, interval, pay_now: payNow });
      saveSession(data.user);
      onSignedIn(data.user, data.checkout_url);
    } catch (problem) {
      setError(errorMessage(problem));
      setBusy("");
    }
  };

  return (
    <div className="site signupPage">
      <SiteNav>
        <div className="navActions">
          <button className="btn outline" onClick={() => go("/signin")}>
            Log in
          </button>
        </div>
      </SiteNav>
      <main className="container signupLayout">
        <form
          className="formCard"
          onSubmit={(event) => {
            event.preventDefault();
            submit(false);
          }}
        >
          <div className="badge">● {trialDays}-day free trial · no card needed</div>
          <h1>Create your account</h1>
          <p className="lead">Set up your company in a minute. You'll be its manager, and you can invite your team afterwards.</p>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {failed && <div className="error">Plans couldn't be loaded. Refresh the page to try again.</div>}
          <label>
            Company name
            <input {...field("company_name")} required maxLength={150} placeholder="e.g. Rift Valley Power Services" />
          </label>
          <label>
            Your name
            <input {...field("name")} required maxLength={120} autoComplete="name" />
          </label>
          <label>
            Work email
            <input {...field("email")} type="email" required autoComplete="email" />
          </label>
          <label>
            Password
            <input {...field("password")} type="password" required minLength={8} autoComplete="new-password" placeholder="At least 8 characters" />
          </label>
          {pricing && (
            <>
              <fieldset className="planPicker">
                <legend>Plan</legend>
                {pricing.plans.map((item) => (
                  <label key={item.key} className={chosen?.key === item.key ? "chosen" : ""}>
                    <input type="radio" name="plan" value={item.key} checked={chosen?.key === item.key} onChange={() => setPlan(item.key)} />
                    <strong>{item.name}</strong>
                    <span>Up to {item.mechanics} mechanics</span>
                    <em>
                      {money(item.prices[interval], pricing.currency)} / {interval}
                    </em>
                  </label>
                ))}
              </fieldset>
              <PeriodToggle value={interval} onChange={setPeriod} freeMonths={12 - pricing.yearly_months} />
            </>
          )}
          <button className="btn primary wide" disabled={!!busy || !chosen}>
            {busy && busy.startsWith("Creating") ? busy : `Start ${trialDays}-day free trial →`}
          </button>
          {pricing?.payment_provider && (
            <button type="button" className="btn outline wide" disabled={!!busy} onClick={(event) => event.currentTarget.form?.reportValidity() && submit(true)}>
              {busy && busy.startsWith("Preparing") ? busy : "Pay now and skip the trial"}
            </button>
          )}
          <p className="formSmall">
            Already have an account?{" "}
            <button type="button" className="textLink" onClick={() => go("/signin")}>
              Log in
            </button>
          </p>
        </form>

        {pricing && chosen && (
          <aside className="signupSummary">
            <span className="summaryLabel">Your plan</span>
            <h2>{chosen.name}</h2>
            <p className="summaryPrice">
              {money(chosen.prices[interval], pricing.currency)} <small>/ {interval}</small>
            </p>
            <p className="summaryNote">
              {interval === "year"
                ? `${12 - pricing.yearly_months} months free compared with paying monthly.`
                : `Switch to yearly billing for ${12 - pricing.yearly_months} months free.`}
            </p>
            <ul>
              <li>{pricing.trial_days}-day free trial, no card needed</li>
              <li>Up to {chosen.mechanics} mechanics</li>
              <li>{chosen.storage_gb} GB for photos, videos and signatures</li>
              <li>Unlimited customers, machines and jobs</li>
            </ul>
            <p className="summaryPrivacy">Your company's data is only visible to the people you invite.</p>
          </aside>
        )}
      </main>
    </div>
  );
}
