import type { ErrorBody, Job, JobDetail } from "../services/types";
import { deleteItem, getBlob, listItems, putItem, readCache, readTemps, saveTemp, writeCache, type OfflineDB } from "./db";
import { resolvePath, type QueueItem } from "./types";

/**
 * Sends a technician's queued changes to the server, one at a time, oldest first. Shared by the
 * app and the service worker, so it uses nothing but fetch and the phone's database.
 */
export type SendEnv = {
  /** The API's address ("/api"). */
  base: string;
  /** The CSRF token the server expects with every change. */
  csrf: () => Promise<string>;
  /** Renew the session when it has run out; false if it can't be. */
  refresh: () => Promise<boolean>;
  /** Whether photos and videos should upload now (online, not 2G, data saver off). */
  goodConnection: () => boolean;
};

export type Outcome =
  | { type: "sent"; item: QueueItem; data: unknown }
  | { type: "refused"; item: QueueItem; status: number; data: ErrorBody; code?: "depends" | "missing" }
  | { type: "wait"; item: QueueItem; reason: Waiting };

/** Why sending stopped: no connection, the server struggling, or nobody signed in. */
export type Waiting = "offline" | "server" | "signed-out";

export type Hooks = {
  /** A screen is waiting for this change's answer: a refusal goes to it instead of the list. */
  attached?: (id: string) => boolean;
  changed?: () => void;
  progress?: (done: number, total: number) => void;
  outcome?: (outcome: Outcome) => void;
};

/** Photos wait longer and longer after each failed try, up to 15 minutes. */
export const backoff = (attempts: number) => Math.min(15 * 60_000, 15_000 * 2 ** Math.max(0, attempts - 1));

/** Send everything that can go now. Resolves to why it stopped, or "done". */
export async function flushOutbox(db: OfflineDB, userId: number, env: SendEnv, hooks: Hooks = {}): Promise<"done" | "busy" | Waiting> {
  const run = async (): Promise<"done" | Waiting> => {
    // Read the queue again after each change: changes queued meanwhile join this round.
    const tried = new Set<number>();
    let done = 0;
    try {
      for (;;) {
        const left = (await listItems(db)).filter((item) => item.seq !== undefined && !tried.has(item.seq) && item.state !== "failed");
        const item = left.find((candidate) => candidate.kind !== "media" || (env.goodConnection() && (candidate.nextTry ?? 0) <= Date.now()));
        if (!item || item.seq === undefined) return "done";
        tried.add(item.seq);
        hooks.progress?.(done + 1, done + left.length);
        await putItem(db, { ...item, state: "sending" });
        hooks.changed?.();
        const outcome = await sendOne(db, env, item);
        hooks.outcome?.(outcome);
        if (outcome.type === "sent") {
          await deleteItem(db, item);
          done++;
        } else if (outcome.type === "refused") {
          if (hooks.attached?.(item.id)) await deleteItem(db, item);
          else await putItem(db, { ...item, state: "failed", error: outcome.data.error || outcome.data.message, errorData: outcome.data, errorCode: outcome.code });
        } else {
          const attempts = item.attempts + 1;
          await putItem(db, { ...item, state: "waiting", attempts, nextTry: item.kind === "media" ? Date.now() + backoff(attempts) : undefined });
          hooks.changed?.();
          // A photo the server couldn't take right now waits its turn; anything else stops the round.
          if (!(item.kind === "media" && outcome.reason === "server")) return outcome.reason;
        }
        hooks.changed?.();
      }
    } finally {
      hooks.progress?.(0, 0);
    }
  };
  return (await whileQueueIsFree(userId, run)) ?? "busy";
}

/**
 * Run `task` unless the queue is being sent (in another tab, or by the service worker): one sender
 * at a time. Resolves to undefined when it's busy.
 */
export async function whileQueueIsFree<T>(userId: number, task: () => Promise<T>): Promise<T | undefined> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) return task();
  return locks.request(`mechanicpro-outbox-${userId}`, { ifAvailable: true }, (lock) => (lock ? task() : undefined));
}

type Reply = Response | "offline";

async function call(env: SendEnv, item: QueueItem, method: string, path: string, body?: unknown, key = item.id): Promise<Reply> {
  const send = async () =>
    fetch(`${env.base}${path}`, {
      method,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-TOKEN": await env.csrf(),
        "Idempotency-Key": key,
        "X-Client-Time": item.at,
        "Accept-Language": item.lang,
        "X-Language": item.lang,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    const response = await send();
    if (response.status === 401 && (await env.refresh())) return await send();
    return response;
  } catch {
    return "offline";
  }
}

async function get<T>(env: SendEnv, path: string): Promise<T | null> {
  try {
    const response = await fetch(`${env.base}${path}`, { credentials: "include" });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

/** What a reply that didn't save the change means: wait and send again, or refused for good. */
async function verdict(item: QueueItem, reply: Reply): Promise<Outcome | null> {
  if (reply === "offline") return { type: "wait", item, reason: "offline" };
  if (reply.status === 401) return { type: "wait", item, reason: "signed-out" };
  if (reply.status >= 500 || reply.status === 429 || reply.status === 408) return { type: "wait", item, reason: "server" };
  if (reply.ok) return null;
  const data: ErrorBody = await reply.json().catch(() => ({}));
  return { type: "refused", item, status: reply.status, data };
}

async function sendOne(db: OfflineDB, env: SendEnv, item: QueueItem): Promise<Outcome> {
  if (item.kind === "media") return sendMedia(db, env, item);
  const temps = await readTemps(db);
  const path = resolvePath(item.path, temps);
  // It belongs to something an earlier change made, which the server refused.
  if (path === null) return { type: "refused", item, status: 409, data: {}, code: "depends" };
  const reply = await call(env, item, item.method, path, item.body);
  const problem = await verdict(item, reply);
  if (problem) return problem;
  const data: unknown = await (reply as Response).json().catch(() => ({}));
  await keep(db, env, item, data);
  return { type: "sent", item, data };
}

/** Store what the server sent back, so the phone's copy is current, and learn the IDs of things made offline. */
async function keep(db: OfflineDB, env: SendEnv, item: QueueItem, data: unknown) {
  const reply = (data ?? {}) as { job?: JobDetail | Job };
  if (item.kind === "consent" || item.kind === "clock_in" || item.kind === "clock_out") {
    const { paused_jobs: _paused, ...status } = data as Record<string, unknown>;
    await writeCache(db, "/shifts/current", status);
    return;
  }
  if (!item.jobId) return;
  let detail = reply.job && "parts" in reply.job ? reply.job : null;
  if (item.kind === "status") {
    // The reply is the job as the list shows it: update the list, and fetch the worksheet.
    const list = await readCache(db, "/jobs");
    const listed = list?.data as { jobs: Job[] } | undefined;
    if (listed && reply.job) {
      await writeCache(db, "/jobs", { jobs: listed.jobs.map((job) => (job.id === item.jobId ? { ...job, ...(reply.job as Job) } : job)) });
    }
    detail = (await get<{ job: JobDetail }>(env, `/jobs/${item.jobId}`))?.job ?? null;
  }
  if (!detail) return;
  await writeCache(db, `/jobs/${item.jobId}`, { job: detail });
  if (item.temp === undefined) return;
  const made =
    item.kind === "status"
      ? detail.entries?.find((entry) => entry.running)?.id
      : item.kind === "entry_add"
        ? detail.entries?.find((entry) => sameMoment(entry.started_at, item.body?.started_at))?.id
        : item.kind === "part_add"
          ? detail.parts.filter((part) => part.name === item.body?.name).reduce((last, part) => Math.max(last, part.id), 0) || undefined
          : undefined;
  if (made) await saveTemp(db, item.temp, made);
}

const sameMoment = (a: unknown, b: unknown) => typeof a === "string" && typeof b === "string" && Date.parse(stamped(a)) === Date.parse(stamped(b));
// The API's times are UTC without a zone.
const stamped = (value: string) => (/Z$|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);

/** A photo or video: reserve it, upload the file, confirm. Each step is safe to repeat. */
async function sendMedia(db: OfflineDB, env: SendEnv, item: QueueItem): Promise<Outcome> {
  const blob = await getBlob(db, item.id);
  if (!blob || !item.media || !item.jobId) return { type: "refused", item, status: 410, data: {}, code: "missing" };
  const { kind, contentType, size, name } = item.media;
  const reserve = await call(env, item, "POST", `/jobs/${item.jobId}/files`, { kind, content_type: contentType, size, name });
  const refused = await verdict(item, reserve);
  if (refused) return refused;
  const reserved = (await (reserve as Response).json()) as { file_id: number; ready?: boolean; upload?: { method: string; url: string; headers: Record<string, string> } };
  if (!reserved.ready && reserved.upload) {
    const url = reserved.upload.url.startsWith("/api/") ? `${env.base}${reserved.upload.url.slice(4)}` : reserved.upload.url;
    let upload: Response;
    try {
      upload = await fetch(url, { method: reserved.upload.method, headers: reserved.upload.headers, body: blob });
    } catch {
      return { type: "wait", item, reason: "offline" };
    }
    if (upload.status === 413 || upload.status === 415) {
      return { type: "refused", item, status: upload.status, data: await upload.json().catch(() => ({})) };
    }
    if (!upload.ok) return { type: "wait", item, reason: "server" };
  }
  const confirm = await call(env, item, "POST", `/files/${reserved.file_id}/confirm`, {}, `${item.id}-confirm`);
  // "The upload didn't arrive": send it again next time.
  if (confirm !== "offline" && confirm.status === 409) return { type: "wait", item, reason: "server" };
  const problem = await verdict(item, confirm);
  if (problem) return problem;
  const data: unknown = await (confirm as Response).json().catch(() => ({}));
  await keep(db, env, item, data);
  return { type: "sent", item, data };
}

/** Photos and videos upload on a good connection: online, not 2G, data saver off (iPhones can't tell, so: online). */
export function goodConnection(nav: { onLine: boolean; connection?: { effectiveType?: string; saveData?: boolean } }) {
  if (!nav.onLine) return false;
  const connection = nav.connection;
  if (!connection) return true;
  return !connection.saveData && !["slow-2g", "2g"].includes(connection.effectiveType ?? "");
}

