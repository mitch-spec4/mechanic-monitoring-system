import { createContext, useContext, useEffect, useRef, useState } from "react";
import { AlertTriangle, Clock, LogIn, LogOut, MapPin, ShieldCheck } from "lucide-react";
import Modal from "./Modal";
import { clockIn, clockOut, jobs, sendLiveLocation, setLocationConsent, shiftStatus, updateJob } from "../services/api";
import { distanceMetres, errorCode, Fix, getPosition, hasFix, locationHelp, toFix } from "../lib/location";
import { errorMessage } from "../lib/format";
import { usePolling } from "../lib/usePolling";
import "./Shift.css";

// Live positions while a job is in progress: at most one every 2 minutes, sooner after moving 100 m.
const LIVE_EVERY_MS = 120000;
const LIVE_MIN_MS = 60000;
const LIVE_MOVE_M = 100;

type Status = { consent: boolean; shift: any | null };
type ShiftState = {
  status: Status | null;
  busy: string;
  problem: string;
  permission: PermissionState | "unknown";
  activeJob: any | null;
  startClockIn: () => void;
  startClockOut: () => void;
  withdrawConsent: () => Promise<void>;
  dismissProblem: () => void;
};

const ShiftContext = createContext<ShiftState | null>(null);
export const useShift = () => useContext(ShiftContext);

/** Clock-in state and location sharing for a signed-in mechanic. Other roles get no provider. */
export function ShiftProvider({ children }: { children: any }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [activeJob, setActiveJob] = useState<any | null>(null);
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState("");
  const [asking, setAsking] = useState(false);
  const [permission, setPermission] = useState<PermissionState | "unknown">("unknown");
  const clockedIn = !!status?.shift;

  const load = () =>
    Promise.all([shiftStatus(), jobs()])
      .then(([shiftData, jobData]) => {
        setStatus(shiftData);
        setActiveJob((jobData.jobs || []).find((job: any) => job.status === "In Progress") || null);
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
    setBusy("Finding your location…");
    try {
      const position = await getPosition();
      if (!hasFix(position)) {
        if (position.location_error === "denied") setPermission("denied");
        setProblem(`You can't clock in without sharing your location. ${locationHelp(position.location_error)}`);
        return;
      }
      setStatus(await clockIn(position));
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
      setStatus(await setLocationConsent(true));
      await finishClockIn();
    } catch (error) {
      setProblem(errorMessage(error));
    }
  };

  const startClockOut = async () => {
    if (activeJob && !confirm(`Clocking out pauses "${activeJob.title}" and stops its timer. Clock out?`)) return;
    setProblem("");
    setBusy("Clocking out…");
    try {
      // Clocking out never waits long on GPS or fails without it.
      const result = await clockOut(await getPosition(8000));
      setStatus(result);
      lastSent.current = null;
      load();
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setBusy("");
    }
  };

  const withdrawConsent = async () => {
    setStatus(await setLocationConsent(false));
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

/** Change a job's status; a mechanic's Start, Resume and Complete carry their position. */
export async function changeJobStatus(jobId: number, status: string, role: string, extra: Record<string, unknown> = {}) {
  if (role === "mechanic" && (status === "In Progress" || status === "Completed")) {
    return updateJob(jobId, { status, ...extra, ...(await getPosition(10000)) });
  }
  return updateJob(jobId, { status, ...extra });
}

function ConsentModal({ onAgree, onClose }: { onAgree: () => void; onClose: () => void }) {
  return (
    <Modal title="Share your location while you work" icon={<MapPin size={20} />} onClose={onClose}>
      <div className="consent">
        <p>To clock in, MechanicPro needs your location. This is exactly what it records:</p>
        <ul>
          <li>
            <b>When you clock in and out</b>, and when you start, resume and complete a job.
          </li>
          <li>
            <b>While a job is in progress and this app is open</b>, about every 2 minutes.
          </li>
          <li>
            <b>Never while you are clocked out.</b> A "Location on" sign shows whenever it is being shared.
          </li>
        </ul>
        <p className="muted">
          Only your manager can see your location; customers never can. Positions taken during a job are deleted after
          30 days. Clock-in, clock-out and job stamps stay with your shift and job records. You can withdraw in Settings
          whenever you are clocked out.
        </p>
        <div className="consentActions">
          <button className="secondary" onClick={onClose}>
            Not now
          </button>
          <button className="primary" onClick={onAgree}>
            <ShieldCheck size={15} /> I agree, clock me in
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
    <div className={`locationPill ${blocked ? "blocked" : ""}`} role="status" title={blocked ? "Your browser is blocking location" : "Your location is shared while you are clocked in"}>
      {blocked ? <AlertTriangle size={13} /> : <span className="locationDot" />}
      {blocked ? "Location blocked" : "Location on"}
    </div>
  );
}

function since(value: string, now: number) {
  const started = new Date(value.endsWith("Z") ? value : `${value}Z`);
  const minutes = Math.max(0, Math.floor((now - started.getTime()) / 60000));
  const time = started.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return { time, length: `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m` };
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
    <section className={`clockCard ${open ? "on" : ""}`} aria-label="Clock in and out">
      <span className="clockIcon">
        <Clock size={20} />
      </span>
      <div className="clockText">
        {open ? (
          <>
            <strong>Clocked in since {elapsed!.time}</strong>
            <span>
              {elapsed!.length} on shift
              {shift.activeJob ? ` · Working on ${shift.activeJob.title}` : ""}
            </span>
          </>
        ) : (
          <>
            <strong>You're clocked out</strong>
            <span>Clock in to start or resume work. Your location is shared only while you're clocked in.</span>
          </>
        )}
      </div>
      {open ? (
        <button className="secondary clockButton" onClick={shift.startClockOut} disabled={!!shift.busy}>
          <LogOut size={15} /> {shift.busy || "Clock out"}
        </button>
      ) : (
        <button className="primary clockButton" onClick={shift.startClockIn} disabled={!!shift.busy}>
          <LogIn size={15} /> {shift.busy || "Clock in"}
        </button>
      )}
      {shift.problem && (
        <div className="clockProblem" role="alert">
          <AlertTriangle size={15} />
          <span>{shift.problem}</span>
          <button className="link" onClick={shift.dismissProblem}>
            Dismiss
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
        <MapPin size={15} /> Location sharing
      </h3>
      {error && <div className="error">{error}</div>}
      <p>
        {consent
          ? "You have agreed to share your location while clocked in. Your manager sees it; customers never do."
          : "You haven't agreed to location sharing. You'll be asked the next time you clock in."}
      </p>
      {consent && (
        <button className="secondary" onClick={withdraw} disabled={!!open} title={open ? "Clock out first" : undefined}>
          Withdraw consent
        </button>
      )}
      {consent && open && <small className="muted">Clock out first to withdraw. Without consent you can't clock in.</small>}
    </div>
  );
}
