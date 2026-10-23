import { useEffect, useState } from "react";
import { Check, ListChecks, X } from "lucide-react";
import { DATA_CHANGED_EVENT, dismissSetup, setupGuide } from "../services/api";
import { mark, t } from "../i18n";
import "./Onboarding.css";

export type SetupStep = "verify" | "customer" | "machine" | "mechanic" | "job";
type Step = { key: SetupStep; done: boolean; waiting?: boolean };

// The email step has no button: the banner above the guide resends the link.
const COPY: Record<SetupStep, [string, string, string]> = {
  verify: [mark("Confirm your email"), mark("Open the link we emailed you, so you can invite people."), ""],
  customer: [mark("Invite your first customer"), mark("They get a portal with their equipment and service history."), mark("Invite a customer")],
  machine: [mark("Add equipment"), mark("Record the equipment you service for a customer."), mark("Add equipment")],
  mechanic: [mark("Invite a technician"), mark("Technicians get their jobs and worksheets on their phone."), mark("Invite a technician")],
  job: [mark("Create your first job"), mark("Assign it to a technician and follow it as it happens."), mark("Create a job")],
};

/** The "Get set up" card on a new company's dashboard. Steps tick themselves off from real data,
 * and the card goes away once everything is done or the boss closes it. */
export default function SetupGuide({ onAction }: { onAction: (step: SetupStep) => void }) {
  const [guide, setGuide] = useState<{ dismissed: boolean; steps: Step[] } | null>(null);

  useEffect(() => {
    const load = () => setupGuide().then(setGuide).catch(() => {});
    load();
    window.addEventListener(DATA_CHANGED_EVENT, load);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, load);
  }, []);

  if (!guide || guide.dismissed || guide.steps.every((step) => step.done)) return null;
  const doneCount = guide.steps.filter((step) => step.done).length;

  return (
    <section className="setupGuide" aria-labelledby="setup-guide-title">
      <div className="setupHead">
        <span className="setupIcon" aria-hidden="true">
          <ListChecks size={20} />
        </span>
        <div>
          <h2 id="setup-guide-title">{t("Get set up")}</h2>
          <p>{t("{done} of {total} done", { done: doneCount, total: guide.steps.length })}</p>
        </div>
        <button
          className="iconButton setupClose"
          aria-label={t("Hide the setup guide")}
          title={t("Hide the setup guide")}
          onClick={() => dismissSetup().then(() => setGuide({ ...guide, dismissed: true }), () => setGuide({ ...guide, dismissed: true }))}
        >
          <X size={16} />
        </button>
      </div>
      <div className="setupProgress" aria-hidden="true">
        <i style={{ width: `${(doneCount / guide.steps.length) * 100}%` }} />
      </div>
      <ol className="setupSteps">
        {guide.steps.map((step) => {
          const [title, text, action] = COPY[step.key];
          return (
            <li key={step.key} className={step.done ? "done" : ""}>
              <span className="setupMark" aria-hidden="true">
                {step.done ? <Check size={14} /> : null}
              </span>
              <div>
                <b>
                  {t(title)}
                  {step.done && <span className="visuallyHidden"> {t("(done)")}</span>}
                </b>
                <span>{step.waiting && !step.done ? t("Equipment belongs to a customer, so this opens once a customer accepts their invitation.") : t(text)}</span>
              </div>
              {!step.done && action && (
                <button className="secondary" disabled={step.waiting} onClick={() => onAction(step.key)}>
                  {t(action)}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
