import { useState } from "react";
import { saveSession, signup, type User } from "../services/api";
import { go, money } from "../lib/route";
import { usePricing, type Interval } from "../components/Plans";
import { PeriodToggle, SiteNav } from "./Home";
import { errorMessage } from "../lib/format";
import LanguagePicker from "../components/LanguagePicker";
import LanguageSuggestion from "../components/LanguageSuggestion";
import { TermsAgreement } from "../components/Legal";
import { t } from "../i18n";
import "./Home.css";
import Field from "../components/Field";
import { ForwardArrow } from "../components/Arrows";

type Props = { query: URLSearchParams; onSignedIn: (user: User, checkoutUrl?: string) => void };
type Busy = "" | "creating" | "checkout";

/** A new company and its owner. Every plan starts as a free trial; paying now skips it. */
export default function Signup({ query, onSignedIn }: Props) {
  const [pricing, failed] = usePricing();
  const [plan, setPlan] = useState(query.get("plan") || "professional");
  const [interval, setPeriod] = useState<Interval>(query.get("interval") === "year" ? "year" : "month");
  const [form, setForm] = useState({ company_name: "", name: "", email: "", password: "" });
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState<Busy>("");
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
    setBusy(payNow ? "checkout" : "creating");
    try {
      const data = await signup({ ...form, plan: chosen.key, interval, pay_now: payNow, accept_terms: agreed });
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
            {t("Log in")}
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
          <div className="badge">● {t("{days}-day free trial · no card needed", { days: trialDays })}</div>
          <h1>{t("Create your account")}</h1>
          <p className="lead">{t("Set up your company in a minute. You'll be its manager, and you can invite your team afterwards.")}</p>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {failed && <div className="error">{t("Plans couldn't be loaded. Refresh the page to try again.")}</div>}
          <Field wrap label={t("Company name")}>
            <input {...field("company_name")} required maxLength={150} placeholder={t("e.g. {example}", { example: "Rift Valley Power Services" })} />
          </Field>
          <Field wrap label={t("Your name")}>
            <input {...field("name")} required maxLength={120} autoComplete="name" />
          </Field>
          <Field wrap label={t("Work email")}>
            <input {...field("email")} type="email" required autoComplete="email" />
          </Field>
          <Field wrap label={t("Password")}>
            <input {...field("password")} type="password" required minLength={8} autoComplete="new-password" placeholder={t("At least 8 characters")} />
          </Field>
          {pricing && (
            <>
              <fieldset className="planPicker">
                <legend>{t("Plan")}</legend>
                {pricing.plans.map((item) => (
                  <label key={item.key} className={chosen?.key === item.key ? "chosen" : ""}>
                    <input type="radio" name="plan" value={item.key} checked={chosen?.key === item.key} onChange={() => setPlan(item.key)} />
                    <strong>{t(item.name)}</strong>
                    <span>{t("Up to {count} technicians", { count: item.mechanics })}</span>
                    <em>
                      {money(item.prices[interval], pricing.currency)} {interval === "year" ? t("/ year") : t("/ month")}
                    </em>
                  </label>
                ))}
              </fieldset>
              <PeriodToggle value={interval} onChange={setPeriod} freeMonths={12 - pricing.yearly_months} />
            </>
          )}
          <TermsAgreement checked={agreed} onChange={setAgreed} />
          <button className="btn primary wide" disabled={!!busy || !chosen}>
            {busy === "creating" ? (
              t("Creating your account…")
            ) : (
              <>
                {t("Start {days}-day free trial", { days: trialDays })} <ForwardArrow />
              </>
            )}
          </button>
          {pricing?.payment_provider && (
            <button type="button" className="btn outline wide" disabled={!!busy} onClick={(event) => event.currentTarget.form?.reportValidity() && submit(true)}>
              {busy === "checkout" ? t("Preparing checkout…") : t("Pay now and skip the trial")}
            </button>
          )}
          <p className="formSmall">
            {t("Already have an account?")}{" "}
            <button type="button" className="textLink" onClick={() => go("/signin")}>
              {t("Log in")}
            </button>
          </p>
          <LanguagePicker className="loginLanguage" />
        </form>

        {pricing && chosen && (
          <aside className="signupSummary">
            <span className="summaryLabel">{t("Your plan")}</span>
            <h2>{t(chosen.name)}</h2>
            <p className="summaryPrice">
              {money(chosen.prices[interval], pricing.currency)} <small>{interval === "year" ? t("/ year") : t("/ month")}</small>
            </p>
            <p className="summaryNote">
              {interval === "year"
                ? t("{count} months free compared with paying monthly.", { count: 12 - pricing.yearly_months })
                : t("Switch to yearly billing for {count} months free.", { count: 12 - pricing.yearly_months })}
            </p>
            <ul>
              <li>{t("{days}-day free trial, no card needed", { days: pricing.trial_days })}</li>
              <li>{t("Up to {count} technicians", { count: chosen.mechanics })}</li>
              <li>{t("{size} GB for photos, videos and signatures", { size: chosen.storage_gb })}</li>
              <li>{t("Unlimited customers, equipment and jobs")}</li>
            </ul>
            <p className="summaryPrivacy">{t("Your company's data is only visible to the people you invite.")}</p>
          </aside>
        )}
      </main>
      <LanguageSuggestion />
    </div>
  );
}
