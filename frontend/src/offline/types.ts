import type { ErrorBody } from "../services/types";

/** What a queued change does, so screens can show it before the server has it. */
export type ChangeKind =
  | "status"
  | "part_add"
  | "part_remove"
  | "check"
  | "entry_add"
  | "entry_update"
  | "record"
  | "note"
  | "media"
  | "media_remove"
  | "consent"
  | "clock_in"
  | "clock_out"
  | "on_the_way"
  | "form";

/** A photo or video waiting to upload; a form's photo says which question it answers ("<form id>:<question id>"). */
export type MediaInfo = { kind: string; contentType: string; size: number; name: string; formField?: string };

/**
 * A change a technician made, kept on the phone until the server has it. Sent one at a time,
 * oldest first, with its own ID (the server's Idempotency-Key) and the time it was made.
 */
export type QueueItem = {
  /** The change's own ID: sent as Idempotency-Key, so a repeat is never saved twice. */
  id: string;
  /** Its place in the queue (set by the database). */
  seq?: number;
  userId: number;
  kind: ChangeKind;
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  /** May hold a temporary ID, "{tmp:-17}", for something an earlier change makes. */
  path: string;
  body?: Record<string, unknown>;
  jobId?: number;
  /** Shown in the list of changes: the job's title, and what was changed (a part's name, an item's label). */
  title?: string;
  detail?: string;
  /** The job's status before a status change, to tell Start from Resume. */
  from?: string;
  /** When it was made, on the server's clock (ISO). */
  at: string;
  /** The language the technician uses: the server answers a refusal in it. */
  lang: string;
  state: "waiting" | "sending" | "failed";
  attempts: number;
  /** Photos and videos: not before this time (ms since 1970), after a failed try. */
  nextTry?: number;
  /** A temporary ID for what this change makes (a time entry, a part, a photo) until the server's is known. */
  temp?: number;
  media?: MediaInfo;
  /** Why the server refused it. */
  error?: string;
  errorData?: ErrorBody;
  /** Refused on the phone: it belonged to a change that was refused, or its photo is gone. */
  errorCode?: "depends" | "missing";
};

/** A change about to be queued: the queue fills in the rest. */
export type NewChange = Pick<QueueItem, "kind" | "method" | "path" | "body" | "jobId" | "title" | "detail" | "from" | "temp" | "media">;

export const SYNC_TAG = "mechanicpro-outbox";
const TEMP = /\{tmp:(-\d+)\}/g;

export const tempPath = (id: number) => `{tmp:${id}}`;

/** A temporary ID for something made offline: negative, so it never matches the server's. */
export function newTempId() {
  return -(Date.now() * 100 + Math.floor(Math.random() * 100));
}

/** The path with temporary IDs swapped for the server's, or null while one isn't known. */
export function resolvePath(path: string, temps: Record<string, number>) {
  let missing = false;
  const resolved = path.replace(TEMP, (_, id: string) => {
    const real = temps[id];
    if (real === undefined) missing = true;
    return String(real);
  });
  return missing ? null : resolved;
}

/** The ID a path segment stands for: a real one, or a temporary one swapped for the server's when known. */
export function idIn(segment: string | undefined, temps: Record<string, number>) {
  const temp = /^\{tmp:(-\d+)\}$/.exec(segment ?? "");
  if (temp) return temps[temp[1]] ?? Number(temp[1]);
  return Number(segment);
}
