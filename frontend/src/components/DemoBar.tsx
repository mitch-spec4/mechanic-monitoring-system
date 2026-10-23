import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { switchDemo } from "../services/api";
import { errorMessage } from "../lib/format";
import "./Onboarding.css";

type Props = { user: any; onSwitched: (user: any) => void; onLeave: () => void };

export const DEMO_ROLES = [
  ["boss", "Boss"],
  ["mechanic", "Mechanic"],
  ["customer", "Customer"],
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
    <section className="demoBar" aria-label="Demo company">
      <FlaskConical size={17} aria-hidden="true" />
      <p>
        <b>Demo company.</b> <span className="demoWide">Your private copy with sample data, deleted</span>
        <span className="demoNarrow">Deleted</span> in {hoursLeft} {hoursLeft === 1 ? "hour" : "hours"}.
      </p>
      <div className="demoRoles" role="group" aria-label="View the demo as">
        {DEMO_ROLES.map(([role, label]) => (
          <button key={role} aria-pressed={user.role === role} disabled={!!busy} onClick={() => user.role !== role && switchTo(role)}>
            {busy === role ? "Opening…" : label}
          </button>
        ))}
      </div>
      <button className="demoSignup" onClick={onLeave}>
        <span className="demoWide">Start your free trial</span>
        <span className="demoNarrow">Sign up</span>
      </button>
      {error && (
        <span className="demoError" role="alert">
          {error}
        </span>
      )}
    </section>
  );
}
