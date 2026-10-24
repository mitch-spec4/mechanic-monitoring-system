import { useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, Download, History, Trash2 } from "lucide-react";
import { activity, cancelCompanyDeletion, company, deleteCompany, exportData, SESSION_EXPIRED_EVENT, type User } from "../services/api";
import { errorMessage, formatDate, formatDateTime } from "../lib/format";
import { confirmAction, toast } from "./Feedback";
import { EmptyState, Loading } from "./States";
import { saveFile } from "./TwoFactor";
import { mark, t } from "../i18n";
import Field from "./Field";

// The server logs short codes; each reader sees them in their own language.
const ACTIONS: Record<string, string> = {
  sign_in: mark("Signed in"),
  sign_in_failed: mark("Wrong password or code"),
  account_locked: mark("Account locked after too many wrong tries"),
  password_changed: mark("Changed their password"),
  password_reset: mark("Reset their password"),
  two_factor_enabled: mark("Set up two-step sign-in"),
  two_factor_reset: mark("Reset two-step sign-in"),
  backup_codes_renewed: mark("Made new backup codes"),
  invitation_sent: mark("Sent an invitation"),
  member_joined: mark("Joined the company"),
  member_removed: mark("Removed someone"),
  job_deleted: mark("Deleted a job"),
  customer_deleted: mark("Deleted a customer"),
  machine_deleted: mark("Deleted equipment"),
  plan_paid: mark("Plan paid"),
  plan_cancelled: mark("Plan renewal cancelled"),
  plan_renewal_on: mark("Plan renewal turned back on"),
  plan_changed: mark("Plan changed by the payment provider"),
  data_exported: mark("Exported the company's data"),
  report_exported: mark("Downloaded insights"),
  deletion_requested: mark("Asked to delete the company"),
  deletion_cancelled: mark("Cancelled deleting the company"),
};
// Worth a second look when reading the log.
const WARNINGS = new Set(["sign_in_failed", "account_locked", "two_factor_reset", "member_removed", "data_exported", "deletion_requested"]);

type LogEntry = { id: number; action: string; user: string | null; detail: string | null; ip: string | null; created_at: string };

/** The activity log (managers): sign-ins, security changes, deletions and exports, newest first. */
export function ActivityLog() {
  const [events, setEvents] = useState<LogEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async (before?: number) => {
    setBusy(true);
    try {
      const data = await activity(before);
      setEvents((current) => [...(before ? current || [] : []), ...data.events]);
      setMore(data.more);
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  if (error) return <EmptyState icon={<AlertTriangle size={26} />} title={t("Unable to load data")} text={error} />;
  if (!events) return <Loading />;
  if (!events.length) return <EmptyState icon={<History size={26} />} title={t("Nothing here yet")} text={t("Sign-ins and changes to your company will appear here.")} />;
  return (
    <>
      <ol className="activityLog">
        {events.map((event) => (
          <li key={event.id} className={WARNINGS.has(event.action) ? "warning" : ""} data-action={event.action}>
            <div>
              <strong>{t(ACTIONS[event.action] ?? event.action)}</strong>
              <small>
                {[event.user || "MechanicPro", event.detail, event.ip && t("from {address}", { address: event.ip })].filter(Boolean).join(" · ")}
              </small>
            </div>
            <time dateTime={event.created_at}>{formatDateTime(event.created_at)}</time>
          </li>
        ))}
      </ol>
      {more && (
        <button type="button" className="secondary loadMore" disabled={busy} onClick={() => load(events[events.length - 1].id)}>
          {busy ? t("Loading…") : t("Show older activity")}
        </button>
      )}
    </>
  );
}

/** "Your company's data" in Settings (managers): download everything, or delete the company. */
export function CompanyDataSettings({ user, onUserChanged }: { user: User; onUserChanged: (user: User) => void }) {
  return (
    <>
      <ExportData />
      {/* Demo companies delete themselves. */}
      {!user.demo_until && <DeleteCompany user={user} onUserChanged={onUserChanged} />}
    </>
  );
}

function ExportData() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { blob, name } = await exportData(password);
      saveFile(name, blob);
      setPassword("");
      toast(t("Your data is downloading."));
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="form form-upgraded settingsSection" onSubmit={submit} aria-labelledby="settings-export">
      <h3 id="settings-export">
        <Download size={16} /> {t("Export your data")}
      </h3>
      <p className="muted">
        {t(
          "A ZIP file with a spreadsheet (CSV) for each kind of record, and all of it as JSON. Photos, videos and signatures are listed with download links that work for 7 days.",
        )}
      </p>
      {error && <div className="error">{error}</div>}
      <Field label={t("Current password")}>
        <input id="field-export-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
      </Field>
      <button className="primary" disabled={busy}>
        <Download size={15} /> {busy ? t("Preparing your file…") : t("Download my data")}
      </button>
    </form>
  );
}

function DeleteCompany({ user, onUserChanged }: { user: User; onUserChanged: (user: User) => void }) {
  const [companyName, setCompanyName] = useState("");
  const [typed, setTyped] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    company()
      .then((data) => setCompanyName(data.company.name))
      .catch((problem) => setError(errorMessage(problem)));
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const ok = await confirmAction({
      title: t("Delete {company}?", { company: companyName }),
      message: t("Everyone is signed out now. In 30 days the company and everything in it is deleted for good, unless a manager signs in and cancels."),
      confirmLabel: t("Delete my company"),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const data = await deleteCompany(typed, password);
      toast(t("{company} will be deleted on {date}. Sign in before then to cancel.", { company: companyName, date: formatDate(data.deletion_due) }), "info");
      // Everyone was signed out, this browser too.
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    } catch (problem) {
      setError(errorMessage(problem));
      setBusy(false);
    }
  };

  if (user.deletion_due) {
    return (
      <section className="settingsSection dangerZone" aria-labelledby="settings-delete">
        <h3 id="settings-delete">
          <Trash2 size={16} /> {t("Delete your company")}
        </h3>
        <p>{t("This company will be deleted on {date}.", { date: formatDate(user.deletion_due) })}</p>
        <CancelDeletion user={user} onUserChanged={onUserChanged} />
      </section>
    );
  }
  return (
    <form className="form form-upgraded settingsSection dangerZone" onSubmit={submit} aria-labelledby="settings-delete">
      <h3 id="settings-delete">
        <Trash2 size={16} /> {t("Delete your company")}
      </h3>
      <p className="muted">
        {t(
          "Deletes the company and everything in it: people, customers, equipment, jobs, photos, videos and signatures. Everyone is signed out at once, and you have 30 days to change your mind. Export your data first if you want a copy.",
        )}
      </p>
      {error && <div className="error">{error}</div>}
      <Field label={t("Type {company} to confirm", { company: companyName })}>
        <input id="field-delete-name" value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" required />
      </Field>
      <Field label={t("Current password")}>
        <input id="field-delete-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
      </Field>
      <button className="dangerButton" disabled={busy || !companyName || typed.trim().toLowerCase() !== companyName.trim().toLowerCase()}>
        <Trash2 size={15} /> {t("Delete my company")}
      </button>
    </form>
  );
}

function CancelDeletion({ user, onUserChanged }: { user: User; onUserChanged: (user: User) => void }) {
  const [busy, setBusy] = useState(false);
  if (user.role !== "boss") return null;
  return (
    <button
      type="button"
      className="primary"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await cancelCompanyDeletion();
          onUserChanged({ ...user, deletion_due: null });
          toast(t("Your company won't be deleted."));
        } catch (problem) {
          toast(errorMessage(problem), "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      {t("Cancel the deletion")}
    </button>
  );
}

/** Across the top of every page while the company waits to be deleted. */
export function DeletionBanner({ user, onUserChanged }: { user: User; onUserChanged: (user: User) => void }) {
  if (!user.deletion_due) return null;
  return (
    <div className="deletionBanner" role="alert">
      <AlertTriangle size={18} aria-hidden="true" />
      <span>
        {user.role === "boss"
          ? t("Your company and everything in it will be deleted on {date}.", { date: formatDate(user.deletion_due) })
          : t("This company's account will be deleted on {date}. Ask a manager if this is a mistake.", { date: formatDate(user.deletion_due) })}
      </span>
      <CancelDeletion user={user} onUserChanged={onUserChanged} />
    </div>
  );
}
