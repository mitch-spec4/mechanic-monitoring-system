import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { switchDemo, type User } from "../services/api";
import { errorMessage } from "../lib/format";
import { mark, t } from "../i18n";
import "./Onboarding.css";

type Props = { user: User; onSwitched: (user: User) => void; onLeave: () => void };

export const DEMO_ROLES = [
  ["boss", mark("Boss")],
  ["mechanic", mark("Technician")],
  ["customer", mark("Customer")],
] as const;

/** Shown across the top of a "Try the demo" company: how long it lasts, and whose eyes to see it through. */
export default function DemoBar({ user, onSwitched, onLeave }: Props) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const hoursLeft = Math.max(1, Math.ceil((Date.parse(user.demo_until + "Z") - Date.now()) / 3_600_000));
  const switchTo = async (role: string) => {
    setError("");
    setBusy(role);
    try {
      onSwitched((await switchDemo(role)).user);
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setBusy("");
    }
  };
  return (
    <section className="demoBar" aria-label={t("Demo company")}>
      <FlaskConical size={17} aria-hidden="true" />
      <p>
        <b>{t("Demo company.")}</b>{" "}
        <span className="demoWide">
          {hoursLeft === 1
            ? t("Your private copy with sample data, deleted in 1 hour.")
            : t("Your private copy with sample data, deleted in {count} hours.", { count: hoursLeft })}
        </span>
        <span className="demoNarrow">{hoursLeft === 1 ? t("Deleted in 1 hour.") : t("Deleted in {count} hours.", { count: hoursLeft })}</span>
      </p>
      <div className="demoRoles" role="group" aria-label={t("View the demo as")}>
        {DEMO_ROLES.map(([role, label]) => (
          <button key={role} aria-pressed={user.role === role} disabled={!!busy} onClick={() => user.role !== role && switchTo(role)}>
            {busy === role ? t("Opening…") : t(label)}
          </button>
        ))}
      </div>
      <button className="demoSignup" onClick={onLeave}>
        <span className="demoWide">{t("Start your free trial")}</span>
        <span className="demoNarrow">{t("Sign up")}</span>
      </button>
      {error && (
        <span className="demoError" role="alert">
          {error}
        </span>
      )}
    </section>
  );
}
