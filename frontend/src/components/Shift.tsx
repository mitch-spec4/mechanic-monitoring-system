import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Clock, LogIn, LogOut, MapPin, ShieldCheck } from "lucide-react";
import Modal from "./Modal";
import { jobs, sendLiveLocation, shiftStatus } from "../services/api";
import { queueClockIn, queueClockOut, queueConsent, queueStatus } from "../offline/changes";
import { distanceMetres, errorCode, Fix, getPosition, hasFix, locationHelp, toFix } from "../lib/location";
import { errorMessage, formatTime } from "../lib/format";
import { confirmAction } from "./Feedback";
import { t } from "../i18n";
import { Trans } from "../i18n/Trans";
import { usePolling } from "../lib/usePolling";
import type { Job, ShiftStatus } from "../services/types";
import "./Shift.css";

// Live positions while a job is in progress: at most one every 2 minutes, sooner after moving 100 m.
const LIVE_EVERY_MS = 120000;
const LIVE_MIN_MS = 60000;
const LIVE_MOVE_M = 100;

type ShiftState = {
  status: ShiftStatus | null;
  busy: string;
  problem: string;
  permission: PermissionState | "unknown";
  activeJob: Job | null;
  startClockIn: () => void;
  startClockOut: () => void;
  withdrawConsent: () => Promise<void>;
  dismissProblem: () => void;
};

const ShiftContext = createContext<ShiftState | null>(null);
export const useShift = () => useContext(ShiftContext);

/** Clock-in state and location sharing for a signed-in mechanic. Other roles get no provider. */
export function ShiftProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ShiftStatus | null>(null);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState("");
  const [asking, setAsking] = useState(false);
  const [permission, setPermission] = useState<PermissionState | "unknown">("unknown");
  const clockedIn = !!status?.shift;

  const load = () =>
    Promise.all([shiftStatus(), jobs()])
      .then(([shiftData, jobData]) => {
        setStatus(shiftData);
        setActiveJob(jobData.jobs.find((job) => job.status === "In Progress") ?? null);
      })
      .catch(() => {});
  usePolling(load, 60000, true);

  // Follow the browser's location permission so the indicator can warn when it gets blocked.
  useEffect(() => {
    let watched: PermissionStatus | null = null;
    navigator.permissions
      ?.query({ name: "geolocation" as PermissionName })
      .then((result) => {
        watched = result;
        setPermission(result.state);
        result.onchange = () => setPermission(result.state);
      })
      .catch(() => {});
    return () => {
      if (watched) watched.onchange = null;
    };
  }, []);

  // Live location: only while clocked in, a job is in progress, and this page is open.
  const lastSent = useRef<{ at: number; fix: Fix } | null>(null);
  useEffect(() => {
    if (!clockedIn || !status?.consent || !activeJob || !("geolocation" in navigator) || !window.isSecureContext) return;
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const fix = toFix(position);
        const now = Date.now();
        const last = lastSent.current;
        const due = !last || now - last.at >= LIVE_EVERY_MS || (now - last.at >= LIVE_MIN_MS && distanceMetres(last.fix, fix) >= LIVE_MOVE_M);
        if (!due) return;
        lastSent.current = { at: now, fix };
        sendLiveLocation(activeJob.id, fix).catch(() => {});
      },
      (error) => {
        if (errorCode(error) === "denied") setPermission("denied");
      },
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 30000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [clockedIn, status?.consent, activeJob?.id]);

  const finishClockIn = async () => {
    setProblem("");
    setBusy(t("Finding your location…"));
    try {
      const position = await getPosition();
      if (!hasFix(position)) {
        if (position.location_error === "denied") setPermission("denied");
        setProblem(`${t("You can't clock in without sharing your location.")} ${locationHelp(position.location_error)}`);
        return;
      }
      // With no signal it waits on the phone (with the time it happened) and shows as clocked in.
      const result = await queueClockIn(position);
      if (result) setStatus(result);
      else await load();
      setPermission((state) => (state === "denied" ? "granted" : state));
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setBusy("");
    }
  };

  const startClockIn = () => {
    if (!status?.consent) setAsking(true);
    else finishClockIn();
  };

  const agree = async () => {
    setAsking(false);
    try {
      const result = await queueConsent(true);
      if (result) setStatus(result);
      await finishClockIn();
    } catch (error) {
      setProblem(errorMessage(error));
    }
  };

  const startClockOut = async () => {
    if (
      activeJob &&
      !(await confirmAction({
        title: t("Clock out?"),
        message: t("Clocking out pauses \u201c{title}\u201d and stops its timer.", { title: activeJob.title }),
        confirmLabel: t("Clock out"),
      }))
    )
      return;
    setProblem("");
    setBusy(t("Clocking out…"));
    try {
      // Clocking out never waits long on GPS or fails without it.
      const result = await queueClockOut(await getPosition(8000));
      if (result) setStatus(result);
      lastSent.current = null;
      await load();
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setBusy("");
    }
  };

  const withdrawConsent = async () => {
    const result = await queueConsent(false);
    if (result) setStatus(result);
    else await load();
  };

  const value: ShiftState = {
    status,
    busy,
    problem,
    permission,
    activeJob,
    startClockIn,
    startClockOut,
    withdrawConsent,
    dismissProblem: () => setProblem(""),
  };
  return (
    <ShiftContext.Provider value={value}>
      {children}
      {asking && <ConsentModal onAgree={agree} onClose={() => setAsking(false)} />}
    </ShiftContext.Provider>
  );
}

/** Change a job's status; a mechanic's Start, Resume and Complete carry their position (GPS works offline). */
export async function changeJobStatus(job: Pick<Job, "id" | "title" | "status">, status: string, role: string, extra: Record<string, unknown> = {}) {
  if (role === "mechanic" && (status === "In Progress" || status === "Completed")) {
    return queueStatus(job, status, { ...extra, ...(await getPosition(10000)) });
  }
  return queueStatus(job, status, extra);
}

function ConsentModal({ onAgree, onClose }: { onAgree: () => void; onClose: () => void }) {
  return (
    <Modal title={t("Share your location while you work")} icon={<MapPin size={20} />} onClose={onClose}>
      <div className="consent">
        <p>{t("To clock in, MechanicPro needs your location. This is exactly what it records:")}</p>
        <ul>
          <li>
            <Trans text="{when}, and when you start, resume and complete a job." values={{ when: <b>{t("When you clock in and out")}</b> }} />
          </li>
          <li>
            <Trans text="{when}, about every 2 minutes." values={{ when: <b>{t("While a job is in progress and this app is open")}</b> }} />
          </li>
          <li>
            <b>{t("Never while you are clocked out.")}</b> {t("A \u201cLocation on\u201d sign shows whenever it is being shared.")}
          </li>
        </ul>
        <p className="muted">
          {t(
            "Only your manager can see your location; customers never can. Positions taken during a job are deleted after 30 days. Clock-in, clock-out and job stamps stay with your shift and job records. You can withdraw in Settings whenever you are clocked out.",
          )}
        </p>
        <div className="consentActions">
          <button className="secondary" onClick={onClose}>
            {t("Not now")}
          </button>
          <button className="primary" onClick={onAgree}>
            <ShieldCheck size={15} /> {t("I agree, clock me in")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Always-visible sign while location is being shared (mechanics only). */
export function LocationIndicator() {
  const shift = useShift();
  if (!shift?.status?.shift) return null;
  const blocked = shift.permission === "denied";
  return (
    <div
      className={`locationPill ${blocked ? "blocked" : ""}`}
      role="status"
      title={blocked ? t("Your browser is blocking location") : t("Your location is shared while you are clocked in")}
    >
      {blocked ? <AlertTriangle size={13} /> : <span className="locationDot" />}
      {blocked ? t("Location blocked") : t("Location on")}
    </div>
  );
}

function since(value: string, now: number) {
  const started = new Date(value.endsWith("Z") ? value : `${value}Z`);
  const minutes = Math.max(0, Math.floor((now - started.getTime()) / 60000));
  return { time: formatTime(value), length: `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m` };
}

/** The mechanic's clock in/out control on the dashboard. */
export function ClockCard() {
  const shift = useShift();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  if (!shift?.status) return null;
  const open = shift.status.shift;
  const elapsed = open ? since(open.clocked_in_at, now) : null;
  return (
    <section className={`clockCard ${open ? "on" : ""}`} aria-label={t("Clock in and out")}>
      <span className="clockIcon">
        <Clock size={20} />
      </span>
      <div className="clockText">
        {open ? (
          <>
            <strong>{t("Clocked in since {time}", { time: elapsed!.time })}</strong>
            <span>
              {t("{length} on shift", { length: elapsed!.length })}
              {shift.activeJob ? ` · ${t("Working on {title}", { title: shift.activeJob.title })}` : ""}
            </span>
          </>
        ) : (
          <>
            <strong>{t("You're clocked out")}</strong>
            <span>{t("Clock in to start or resume work. Your location is shared only while you're clocked in.")}</span>
          </>
        )}
      </div>
      {open ? (
        <button className="secondary clockButton" onClick={shift.startClockOut} disabled={!!shift.busy}>
          <LogOut size={15} /> {shift.busy || t("Clock out")}
        </button>
      ) : (
        <button className="primary clockButton" onClick={shift.startClockIn} disabled={!!shift.busy}>
          <LogIn size={15} /> {shift.busy || t("Clock in")}
        </button>
      )}
      {shift.problem && (
        <div className="clockProblem" role="alert">
          <AlertTriangle size={15} />
          <span>{shift.problem}</span>
          <button className="link" onClick={shift.dismissProblem}>
            {t("Dismiss")}
          </button>
        </div>
      )}
    </section>
  );
}

/** Location sharing section of a mechanic's Settings. */
export function LocationSettings() {
  const shift = useShift();
  const [error, setError] = useState("");
  if (!shift?.status) return null;
  const { consent, shift: open } = shift.status;
  const withdraw = async () => {
    setError("");
    try {
      await shift.withdrawConsent();
    } catch (problem) {
      setError(errorMessage(problem));
    }
  };
  return (
    <div className="locationSettings">
      <h3>
        <MapPin size={15} /> {t("Location sharing")}
      </h3>
      {error && <div className="error">{error}</div>}
      <p>
        {consent
          ? t("You have agreed to share your location while clocked in. Your manager sees it; customers never do.")
          : t("You haven't agreed to location sharing. You'll be asked the next time you clock in.")}
      </p>
      {consent && (
        <button className="secondary" onClick={withdraw} disabled={!!open} title={open ? t("Clock out first") : undefined}>
          {t("Withdraw consent")}
        </button>
      )}
      {consent && open && <small className="muted">{t("Clock out first to withdraw. Without consent you can't clock in.")}</small>}
    </div>
  );
}
