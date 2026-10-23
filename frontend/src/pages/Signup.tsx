import { useState } from "react";
import { ArrowRight, Check, CreditCard, ShieldCheck } from "lucide-react";
import { saveSession, signup } from "../services/api";
import { go, money } from "../lib/route";
import { IntervalSwitch, SiteHeader, usePricing } from "./Home";
import { errorMessage } from "../lib/format";
import "./Home.css";

type Props = { query: URLSearchParams; onSignedIn: (user: any, checkoutUrl?: string) => void };

/** A new company and its owner. Every plan starts as a free trial; paying now skips it. */
export default function Signup({ query, onSignedIn }: Props) {
  const pricing = usePricing();
  const [plan, setPlan] = useState(query.get("plan") || "team");
  const [interval, setPeriod] = useState<"month" | "year">(query.get("interval") === "year" ? "year" : "month");
  const [form, setForm] = useState({ company_name: "", name: "", email: "", password: "" });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const chosen = pricing?.plans.find((item) => item.key === plan) || pricing?.plans[1];
  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value }),
  });

  const submit = async (payNow: boolean) => {
    setError("");
    setBusy(payNow ? "Preparing checkout…" : "Creating your account…");
    try {
      const data = await signup({ ...form, plan, interval, pay_now: payNow });
      saveSession(data.user);
      onSignedIn(data.user, data.checkout_url);
    } catch (problem) {
      setError(errorMessage(problem));
      setBusy("");
    }
  };

  return (
    <div className="site signupPage">
      <SiteHeader />
      <main className="signupLayout">
        <form
          className="signupCard"
          onSubmit={(event) => {
            event.preventDefault();
            submit(false);
          }}
        >
          <h1>Start your free trial</h1>
          <p className="muted">Set up your company in a minute. You'll be its manager, and you can invite your team afterwards.</p>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
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
          <fieldset className="planPicker">
            <legend>Plan</legend>
            {pricing?.plans.map((item) => (
              <label key={item.key} className={plan === item.key ? "chosen" : ""}>
                <input type="radio" name="plan" value={item.key} checked={plan === item.key} onChange={() => setPlan(item.key)} />
                <strong>{item.name}</strong>
                <span>Up to {item.mechanics} mechanics</span>
                <em>{money(item.prices.month, pricing.currency)}/mo</em>
              </label>
            ))}
          </fieldset>
          {pricing && <IntervalSwitch value={interval} onChange={setPeriod} freeMonths={12 - pricing.yearly_months} />}
          <button className="primary" disabled={!!busy}>
            {busy && busy.startsWith("Creating") ? busy : `Start ${pricing?.trial_days ?? 14}-day free trial`} <ArrowRight size={16} />
          </button>
          {pricing?.payment_provider && (
            <button type="button" className="secondary" disabled={!!busy} onClick={(event) => event.currentTarget.form?.reportValidity() && submit(true)}>
              <CreditCard size={16} /> {busy && busy.startsWith("Preparing") ? busy : "Pay now and skip the trial"}
            </button>
          )}
          <p className="signupSmall">
            Already have an account?{" "}
            <button type="button" className="siteLink" onClick={() => go("/signin")}>
              Sign in
            </button>
          </p>
        </form>

        {pricing && chosen && (
          <aside className="signupSummary">
            <span className="summaryLabel">Your plan</span>
            <h2>{chosen.name}</h2>
            <p className="summaryPrice">
              {money(chosen.prices[interval], pricing.currency)} <span>/ {interval === "year" ? "year" : "month"}</span>
            </p>
            <p className="muted">
              {interval === "year"
                ? `${12 - pricing.yearly_months} months free compared with paying monthly.`
                : "Switch to yearly billing for two months free."}
            </p>
            <ul>
              <li>
                <Check size={15} /> {pricing.trial_days}-day free trial, no card needed
              </li>
              <li>
                <Check size={15} /> Up to {chosen.mechanics} mechanics
              </li>
              <li>
                <Check size={15} /> {chosen.storage_gb} GB for photos and videos
              </li>
              <li>
                <Check size={15} /> Unlimited customers, machines and jobs
              </li>
            </ul>
            <p className="summaryNote">
              <ShieldCheck size={15} /> Your company's data is only visible to the people you invite.
            </p>
          </aside>
        )}
      </main>
    </div>
  );
}
