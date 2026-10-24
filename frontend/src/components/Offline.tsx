import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CloudOff, Download, HardDrive, RefreshCw, Smartphone, Trash2, UploadCloud, WifiOff, X } from "lucide-react";
import Modal from "./Modal";
import { discard, flush, queuedFile, useOffline } from "../offline";
import { install, installed, onIphone, reloadForUpdate, usePwa } from "../offline/pwa";
import type { QueueItem } from "../offline/types";
import { formatDay, formatTime } from "../lib/format";
import { mark, t } from "../i18n";
import "./Offline.css";

const stamp = (value: string) => `${formatDay(value)}, ${formatTime(value)}`;

/** The technician's sync status: tap it for the changes still on the phone. */
export function SyncPill() {
  const offline = useOffline();
  const [open, setOpen] = useState(false);
  if (!offline.active) return null;
  const failed = offline.items.filter((item) => item.state === "failed").length;
  const waiting = offline.items.length - failed;
  let label: string;
  let tone: string;
  let icon = <CheckCircle2 size={13} />;
  if (failed) {
    label = failed === 1 ? t("1 needs attention") : t("{count} need attention", { count: failed });
    tone = "attention";
    icon = <AlertTriangle size={13} />;
  } else if (offline.progress && offline.online) {
    label = t("Syncing {number} of {count}…", { number: offline.progress.done, count: offline.progress.total });
    tone = "syncing";
    icon = <RefreshCw size={13} className="spin" />;
  } else if (!offline.online) {
    label = waiting ? t("Offline · {count} waiting", { count: waiting }) : t("Offline");
    tone = "offline";
    icon = <CloudOff size={13} />;
  } else if (waiting) {
    label = waiting === 1 ? t("1 waiting") : t("{count} waiting", { count: waiting });
    tone = "offline";
    icon = <UploadCloud size={13} />;
  } else {
    label = t("All synced");
    tone = "synced";
  }
  return (
    <>
      <button className={`syncPill ${tone}`} onClick={() => setOpen(true)} aria-haspopup="dialog" data-testid="sync-pill">
        {icon}
        {label}
      </button>
      {open && <SyncPanel onClose={() => setOpen(false)} />}
    </>
  );
}

const STATUS_TEXT: Record<string, string> = {
  "In Progress": mark("Start work"),
  Paused: mark("Pause"),
  Completed: mark("Complete the job"),
  Accepted: mark("Accept"),
};

/** One queued change, in words. */
export function describe(item: QueueItem) {
  const detail = item.detail ?? "";
  switch (item.kind) {
    case "status": {
      const status = String(item.body?.status ?? "");
      if (status === "In Progress" && item.from === "Paused") return t("Resume");
      return STATUS_TEXT[status] ? t(STATUS_TEXT[status]) : status;
    }
    case "part_add":
      return t("Add part: {name}", { name: detail });
    case "part_remove":
      return t("Remove part: {name}", { name: detail });
    case "check":
      return item.body?.done === false ? t("Untick: {item}", { item: detail }) : t("Tick: {item}", { item: detail });
    case "entry_add":
      return t("Add time");
    case "entry_update":
      return t("Work notes");
    case "record":
      return t("Service summary");
    case "note":
      return t("Note: {text}", { text: detail });
    case "media":
      return item.media?.kind === "video" ? t("Video") : t("Photo");
    case "media_remove":
      return t("Remove a photo or video");
    case "consent":
      return t("Agree to location sharing");
    case "clock_in":
      return t("Clock in");
    case "clock_out":
      return t("Clock out");
  }
}

const CODE_TEXT: Record<string, string> = {
  depends: mark("It belonged to an earlier change that wasn't saved."),
  missing: mark("Its file is no longer on this phone."),
};

function SyncPanel({ onClose }: { onClose: () => void }) {
  const offline = useOffline();
  const save = async (item: QueueItem) => {
    const blob = await queuedFile(item);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = item.media?.name || "photo.jpg";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  return (
    <Modal title={t("Changes on this phone")} icon={<UploadCloud size={20} />} onClose={onClose}>
      <div className="syncPanel">
        {offline.items.length === 0 ? (
          <p className="syncEmpty">
            <CheckCircle2 size={18} /> {t("Everything is on the server.")}
          </p>
        ) : (
          <>
            <p className="muted">
              {offline.online
                ? t("They are sent one at a time, oldest first. Photos and videos wait for a good connection.")
                : t("You're offline. They are saved on this phone and sent when you're back online.")}
            </p>
            <ol className="syncList">
              {offline.items.map((item) => (
                <li key={item.id} className={item.state}>
                  <div className="syncItemTop">
                    <strong>{describe(item)}</strong>
                    <span className="syncState">
                      {item.state === "failed" ? t("Not saved") : item.state === "sending" ? t("Sending…") : t("Waiting")}
                    </span>
                  </div>
                  <small>
                    {item.title ? `${item.title} · ` : ""}
                    {t("made {time}", { time: stamp(item.at) })}
                  </small>
                  {item.state === "failed" && (
                    <div className="syncProblem" role="alert">
                      <p>{item.errorCode ? t(CODE_TEXT[item.errorCode]) : item.error || t("The server refused this change.")}</p>
                      {item.errorData?.blockers && item.errorData.blockers.length > 0 && (
                        <ul>
                          {item.errorData.blockers.map((blocker) => (
                            <li key={blocker}>{blocker}</li>
                          ))}
                        </ul>
                      )}
                      <div className="syncActions">
                        {item.kind === "media" && (
                          <button className="secondary" onClick={() => save(item)}>
                            <Download size={14} /> {item.media?.kind === "video" ? t("Save video to phone") : t("Save photo to phone")}
                          </button>
                        )}
                        <button className="secondary dangerText" onClick={() => discard(item)}>
                          <Trash2 size={14} /> {t("Discard")}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
        {offline.storageLow && (
          <p className="syncWarning">
            <HardDrive size={15} /> {t("This phone is nearly out of space. Connect to the internet so your photos and videos can upload.")}
          </p>
        )}
        {offline.online && offline.items.some((item) => item.state === "waiting") && (
          <button className="primary" onClick={() => void flush()}>
            <RefreshCw size={15} /> {t("Sync now")}
          </button>
        )}
      </div>
    </Modal>
  );
}

/** "You're offline": technicians keep working from the copy on the phone; everyone else waits
 * (a technician too, on a browser that can't keep data). */
export function OfflineNotice() {
  const offline = useOffline();
  const browserOffline = useBrowserOffline();
  if (offline.active) {
    if (offline.online) return null;
    return (
      <div className="offlineNotice" role="status">
        <WifiOff size={15} />
        <span>
          {offline.savedAt
            ? t("Offline · last updated {time}", { time: formatTime(new Date(offline.savedAt).toISOString()) })
            : t("Offline")}
          {" · "}
          {t("Your changes are saved on this phone and sent when you're back online.")}
        </span>
      </div>
    );
  }
  if (!browserOffline) return null;
  return (
    <div className="offlineNotice" role="status">
      <WifiOff size={15} />
      <span>{t("You're offline. Reconnect to see and change your data.")}</span>
    </div>
  );
}

function useBrowserOffline() {
  const [offline, setOffline] = useState(!navigator.onLine);
  useEffect(() => {
    const online = () => setOffline(false);
    const gone = () => setOffline(true);
    window.addEventListener("online", online);
    window.addEventListener("offline", gone);
    // Some browsers don't always say when the connection changes.
    const timer = window.setInterval(() => setOffline(!navigator.onLine), 5000);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", gone);
      window.clearInterval(timer);
    };
  }, []);
  return offline;
}

/** "Update ready": the new version loads when the person taps Reload, never mid-worksheet. */
export function UpdateBanner() {
  const { updateReady } = usePwa();
  if (!updateReady) return null;
  return (
    <div className="updateBanner" role="status">
      <RefreshCw size={15} />
      <span>{t("A new version of MechanicPro is ready.")}</span>
      <button className="primary" onClick={() => void reloadForUpdate()}>
        {t("Reload")}
      </button>
    </div>
  );
}

const DISMISSED = "mechanicpro:install-dismissed";

/** Installing the app on a technician's phone: a button on Android, the steps on iPhone. */
export function InstallCard() {
  const { canInstall } = usePwa();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED) === "1";
    } catch {
      return false;
    }
  });
  const iphone = onIphone();
  if (dismissed || installed() || (!canInstall && !iphone)) return null;
  const close = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {
      // Private browsing: shown again next visit.
    }
  };
  return (
    <section className="installCard" aria-label={t("Install the app")}>
      <span className="installIcon">
        <Smartphone size={20} />
      </span>
      <div>
        <strong>{t("Install MechanicPro on this phone")}</strong>
        {iphone ? (
          <p>{t("Tap Share, then Add to Home Screen. Installed, your offline work stays on the phone: iPhones clear sites that haven't been opened for 7 days.")}</p>
        ) : (
          <p>{t("It opens like an app, works with no signal, and sends your changes when you're back online.")}</p>
        )}
      </div>
      <div className="installActions">
        {canInstall && (
          <button className="primary" onClick={() => void install()}>
            {t("Install app")}
          </button>
        )}
        <button className="iconButton" onClick={close} aria-label={t("Not now")}>
          <X size={16} />
        </button>
      </div>
    </section>
  );
}

/** The mark on something made on this phone that the server doesn't have yet. */
export function Waiting() {
  return (
    <span className="waitingTag" title={t("Saved on this phone, waiting to sync")}>
      <UploadCloud size={11} /> {t("Waiting to sync")}
    </span>
  );
}
