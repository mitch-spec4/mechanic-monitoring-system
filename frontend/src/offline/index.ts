import { useSyncExternalStore } from "react";
import { api, ApiError, BASE, csrfToken, DATA_CHANGED_EVENT, refreshSession, setReader, type User } from "../services/api";
import type { Job, JobDetail, ShiftStatus } from "../services/types";
import { language, t } from "../i18n";
import { serverNow } from "./clock";
import { addItem, clearCache, deleteItem, getBlob, listItems, openOffline, putItem, readCache, readTemps, wipeOffline, writeCache, type OfflineDB } from "./db";
import { overlayJob, overlayJobs, overlayShift } from "./overlay";
import { flushOutbox, goodConnection, whileQueueIsFree, type Hooks, type Outcome, type SendEnv } from "./send";
import { SYNC_TAG, tempPath, type NewChange, type QueueItem } from "./types";

/**
 * Offline mode for technicians. Their changes go into a queue on the phone and are sent one at a
 * time, oldest first (at once when online). Screens read the server's copy, kept on the phone for
 * when there is no signal, with the waiting changes applied on top. Managers and customers are
 * online only.
 *
 *   submit(change, direct)   queue a change; online, resolves with the server's answer (or rejects
 *                            with its refusal, like a direct call); offline, resolves at once
 *   useOffline()             the queue and connection, for the sync pill and the offline notice
 */
export type OfflineState = {
  active: boolean;
  items: QueueItem[];
  online: boolean;
  progress: { done: number; total: number } | null;
  /** While offline: when the copy on screen was last updated from the server (ms). */
  savedAt: number | null;
  storageLow: boolean;
};

const FINISHED = ["Completed", "Cancelled"];
// Every assigned job's worksheet is kept on the phone, refreshed when older than this.
const PREFETCH_AFTER_MS = 2 * 60_000;
const RETRY_EVERY_MS = 30_000;
// Less free space than this for offline photos and videos: warn.
const LOW_SPACE_BYTES = 100 * 1024 * 1024;

let state: OfflineState = { active: false, items: [], online: navigator.onLine, progress: null, savedAt: null, storageLow: false };
const listeners = new Set<() => void>();

function setState(patch: Partial<OfflineState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useOffline = () => useSyncExternalStore(subscribe, () => state);
export const offlineState = () => state;

let db: OfflineDB | null = null;
let me: User | null = null;
let temps: Record<string, number> = {};
let stopListening: (() => void) | null = null;
let askedToKeep = false;
const previews = new Map<string, string>();
const watchers = new Map<string, { resolve: (data: unknown) => void; reject: (error: unknown) => void }>();

type NavigatorWithConnection = Navigator & { connection?: { effectiveType?: string; saveData?: boolean } };

const env: SendEnv = {
  base: BASE,
  csrf: async () => csrfToken(),
  refresh: refreshSession,
  goodConnection: () => goodConnection(navigator as NavigatorWithConnection),
};

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;

// Starting and stopping take turns (React may start twice in a row), so the database is opened once.
let turn: Promise<void> = Promise.resolve();
const inTurn = (step: () => Promise<void>) => (turn = turn.then(step, step));

/** Turn offline mode on for a signed-in technician (anyone else: nothing happens). */
export const startOffline = (user: User) => inTurn(() => start(user));

/**
 * Turn it off. Signing out deletes everything on the phone (`wipe`); a session that ran out keeps
 * the queue, sent when the same person signs in again (never under someone else).
 */
export const stopOffline = (options: { wipe: boolean }) => inTurn(() => stop(options));

async function start(user: User) {
  if (user.role !== "mechanic" || me?.id === user.id) return;
  await stop({ wipe: false });
  let opened: OfflineDB;
  try {
    opened = await openOffline(user.id);
  } catch {
    // No database here (some private windows): everything still works online.
    return;
  }
  db = opened;
  me = user;
  for (const item of await listItems(opened)) {
    // Left "sending" when the app was closed: sent again (the server answers a repeat once).
    if (item.state === "sending") await putItem(opened, { ...item, state: "waiting" });
    if (item.kind === "media") {
      const blob = await getBlob(opened, item.id);
      if (blob) previews.set(item.id, URL.createObjectURL(blob));
    }
  }
  setReader(read);
  stopListening = listen();
  await refreshItems();
  setState({ active: true, online: navigator.onLine });
  // Screens that loaded before this load again, through the phone's copy, so it has them all.
  changed();
  void checkStorage();
  void flush();
}

async function stop({ wipe }: { wipe: boolean }) {
  const closing = db;
  const userId = me?.id;
  stopListening?.();
  stopListening = null;
  setReader(null);
  db = null;
  me = null;
  temps = {};
  previews.forEach((url) => URL.revokeObjectURL(url));
  previews.clear();
  watchers.forEach((watcher) => watcher.resolve(undefined));
  watchers.clear();
  setState({ active: false, items: [], progress: null, savedAt: null });
  if (!closing || userId === undefined) return;
  if (wipe) {
    closing.close();
    await wipeOffline(userId).catch(() => {});
  } else {
    await clearCache(closing).catch(() => {});
    closing.close();
  }
}

/** Changes on the phone that the server doesn't have yet (waiting, or refused and not discarded). */
export const unsynced = () => state.items.length;

function listen() {
  const online = () => {
    setState({ online: true, savedAt: null });
    void flush();
  };
  const offline = () => setState({ online: false });
  const visible = () => {
    if (document.visibilityState === "visible") void flush();
  };
  // The service worker sent the queue with the app in the background.
  const fromWorker = (event: MessageEvent<{ type?: string }>) => {
    if (event.data?.type !== "synced") return;
    void refreshItems().then(() => window.dispatchEvent(new Event(DATA_CHANGED_EVENT)));
  };
  const timer = window.setInterval(() => {
    if (state.items.some((item) => item.state !== "failed")) void flush();
  }, RETRY_EVERY_MS);
  window.addEventListener("online", online);
  window.addEventListener("offline", offline);
  document.addEventListener("visibilitychange", visible);
  navigator.serviceWorker?.addEventListener("message", fromWorker);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener("online", online);
    window.removeEventListener("offline", offline);
    document.removeEventListener("visibilitychange", visible);
    navigator.serviceWorker?.removeEventListener("message", fromWorker);
  };
}

async function refreshItems() {
  const database = db;
  if (!database) return;
  const [items, known] = await Promise.all([listItems(database), readTemps(database)]).catch(() => [state.items, temps] as const);
  if (database !== db) return;
  temps = known;
  setState({ items });
}

const changed = () => window.dispatchEvent(new Event(DATA_CHANGED_EVENT));

/**
 * Queue a technician's change. `direct` makes the same change without the queue: used when offline
 * mode is off (managers, customers, a browser without a database).
 */
export async function submit<T>(change: NewChange, direct: () => Promise<T>, blob?: Blob): Promise<T | undefined> {
  const database = db;
  if (!database || !me) return direct();
  const item: QueueItem = { ...change, id: newId(), userId: me.id, at: serverNow().toISOString(), lang: language(), state: "waiting", attempts: 0 };
  try {
    await addItem(database, item, blob);
  } catch {
    // The phone couldn't keep it (out of space, say): online it goes straight to the server.
    if (navigator.onLine) return direct();
    throw new Error(t("This phone couldn't keep the change. Free up some space, or connect to the internet and try again."));
  }
  if (blob) previews.set(item.id, URL.createObjectURL(blob));
  const online = navigator.onLine;
  const answer = online
    ? new Promise<T | undefined>((resolve, reject) => watchers.set(item.id, { resolve: (data) => resolve(data as T | undefined), reject }))
    : Promise.resolve(undefined);
  await refreshItems();
  changed();
  askBackgroundSync();
  if (!askedToKeep) {
    askedToKeep = true;
    // So the browser doesn't clear the queue to free space.
    void navigator.storage?.persist?.().catch(() => false);
  }
  if (online) void flush();
  else setState({ online: false });
  return answer;
}

/**
 * Take back something made on this phone that hasn't reached the server (a part, a photo): its
 * change leaves the queue. False when the queue is being sent right now, or it already went: then
 * queue its removal, which follows it to the server.
 */
export async function withdraw(temp: number) {
  const database = db;
  const user = me;
  if (!database || !user) return false;
  const taken = await whileQueueIsFree(user.id, async () => {
    const items = await listItems(database);
    const maker = items.find((item) => item.temp === temp);
    if (!maker) return false;
    for (const item of items) {
      if (item === maker || item.path.includes(tempPath(temp))) await deleteItem(database, item);
    }
    const preview = previews.get(maker.id);
    if (preview) URL.revokeObjectURL(preview);
    previews.delete(maker.id);
    return true;
  });
  if (!taken) return false;
  await refreshItems();
  changed();
  return true;
}

/** Drop a refused change from the list. */
export async function discard(item: QueueItem) {
  if (!db) return;
  await deleteItem(db, item);
  const preview = previews.get(item.id);
  if (preview) URL.revokeObjectURL(preview);
  previews.delete(item.id);
  await refreshItems();
  changed();
}

/** A queued photo or video, to save on the phone before discarding it. */
export const queuedFile = (item: QueueItem) => (db ? getBlob(db, item.id) : Promise.resolve(undefined));

function askBackgroundSync() {
  type WithSync = ServiceWorkerRegistration & { sync?: { register: (tag: string) => Promise<void> } };
  navigator.serviceWorker?.ready.then((registration) => (registration as WithSync).sync?.register(SYNC_TAG)).catch(() => {});
}

async function checkStorage() {
  const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
  if (!estimate?.quota) return;
  setState({ storageLow: estimate.quota - (estimate.usage ?? 0) < LOW_SPACE_BYTES });
}

let flushing: Promise<void> | null = null;

/** Send what's waiting now (one round at a time; changes queued meanwhile join the round). */
export function flush(): Promise<void> {
  const database = db;
  const user = me;
  if (!database || !user) return Promise.resolve();
  flushing ??= (async () => {
    let dirty = false;
    const settle = (outcome: Outcome) => {
      const watcher = watchers.get(outcome.item.id);
      if (outcome.type !== "wait") dirty = true;
      if (outcome.type === "sent") setState({ online: true, savedAt: null });
      if (!watcher) return;
      watchers.delete(outcome.item.id);
      if (outcome.type === "refused") {
        watcher.reject(new ApiError(outcome.data.error || outcome.data.message || t("This change was refused."), outcome.status, outcome.data));
      } else if (outcome.type === "sent") {
        // The change has left the queue: the list the screens overlay is read again before the
        // server's copy reaches the screen, so the change isn't shown on top of it a second time.
        void refreshItems().then(() => watcher.resolve(outcome.data));
      } else {
        watcher.resolve(undefined);
      }
    };
    const hooks: Hooks = {
      attached: (id) => watchers.has(id),
      progress: (done, total) => setState({ progress: total ? { done, total } : null }),
      outcome: settle,
      changed: () =>
        void refreshItems().then(() => {
          if (!dirty) return;
          dirty = false;
          changed();
        }),
    };
    try {
      const result = await flushOutbox(database, user.id, env, hooks);
      if (result === "offline") setState({ online: false });
      // The session ran out: asking who's signed in starts the usual "sign in again".
      if (result === "signed-out") void api("/users/me").catch(() => {});
    } catch {
      // The database went away (signed out meanwhile): nothing more to send.
    } finally {
      flushing = null;
      // Changes that couldn't go now stay in the queue: their screens see them as waiting.
      watchers.forEach((watcher) => watcher.resolve(undefined));
      watchers.clear();
      await refreshItems();
      if (dirty) changed();
      void checkStorage();
    }
  })();
  return flushing;
}

let lastFallback = 0;

/** A read (GET) for a technician: from the server, kept on the phone; offline, the kept copy. */
async function read<T>(path: string, load: () => Promise<T>): Promise<T> {
  const database = db;
  if (!database) return load();
  const started = Date.now();
  let data: T;
  try {
    data = await load();
  } catch (error) {
    // fetch fails with a TypeError when there's no connection; anything else is the server's answer.
    if (!(error instanceof TypeError)) throw error;
    const saved = await readCache(database, path).catch(() => undefined);
    // Several reads make up a screen: it shows the oldest of their times.
    const recent = Date.now() - lastFallback < 5000 && state.savedAt !== null;
    lastFallback = Date.now();
    if (saved) setState({ online: false, savedAt: recent ? Math.min(state.savedAt!, saved.savedAt) : saved.savedAt });
    else setState({ online: false });
    if (!saved) throw new ApiError(t("You're offline, and this hasn't been saved on this phone yet."), 0, {});
    return withChanges(path, saved.data as T);
  }
  if (!state.online) {
    setState({ online: true, savedAt: null });
    void flush();
  }
  const saved = await readCache(database, path).catch(() => undefined);
  // The queue stored a newer copy (with a change in it) while this read was on its way.
  if (saved && saved.savedAt > started) data = saved.data as T;
  else await writeCache(database, path, data).catch(() => {});
  if (path === "/jobs") void prefetch(data as { jobs?: Job[] });
  return withChanges(path, data);
}

/** The screens' data with the waiting changes applied. */
function withChanges<T>(path: string, data: T): T {
  if (!me || !state.items.length) return data;
  const context = { me: me.name, temps, previews };
  if (path === "/jobs") {
    const list = data as { jobs: Job[] };
    return { ...list, jobs: overlayJobs(list.jobs, state.items) } as T;
  }
  if (/^\/jobs\/\d+$/.test(path)) {
    const detail = data as { job: JobDetail };
    return { ...detail, job: overlayJob(detail.job, state.items, context) } as T;
  }
  if (path === "/shifts/current") return overlayShift(data as ShiftStatus, state.items, me.id) as T;
  return data;
}

let prefetching = false;

/** Keep every assigned, unfinished job's worksheet on the phone, for when there's no signal. */
async function prefetch(data: { jobs?: Job[] }) {
  if (prefetching) return;
  prefetching = true;
  try {
    for (const job of data.jobs ?? []) {
      const database = db;
      if (!database) return;
      if (FINISHED.includes(job.status)) continue;
      const saved = await readCache(database, `/jobs/${job.id}`).catch(() => undefined);
      if (saved && Date.now() - saved.savedAt < PREFETCH_AFTER_MS) continue;
      await api(`/jobs/${job.id}`).catch(() => {});
    }
  } finally {
    prefetching = false;
  }
}
