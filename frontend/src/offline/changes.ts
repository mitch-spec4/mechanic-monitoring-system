import {
  addEntry,
  addNote,
  addPart,
  clockIn,
  clockOut,
  deleteFile,
  onTheWay,
  removePart,
  saveFormAnswers,
  saveRecord,
  setLocationConsent,
  updateChecklistItem,
  updateEntry,
  updateJob,
  type FormAnswers,
} from "../services/api";
import type { Job, JobDetail, Payload, ShiftStatus } from "../services/types";
import type { PositionResult } from "../lib/location";
import { submit, withdraw } from ".";
import { newTempId, tempPath, type MediaInfo } from "./types";

/**
 * Every change a technician makes, through the queue (see offline/index.ts). Each also says how to
 * make it directly, for everyone else. Online they resolve with the server's answer, or reject with
 * its refusal; offline they resolve at once with nothing, and the screen shows the change waiting.
 */
type JobRef = Pick<Job, "id" | "title" | "status">;
type WithJob = { job: JobDetail };

// Something made on this phone is known by a temporary ID until the server's arrives.
const ref = (id: number) => (id < 0 ? tempPath(id) : String(id));

export function queueStatus(job: JobRef, status: string, extra: Record<string, unknown> = {}) {
  const body = { status, ...extra };
  return submit(
    { kind: "status", method: "PATCH", path: `/jobs/${job.id}`, body, jobId: job.id, title: job.title, from: job.status, temp: status === "In Progress" ? newTempId() : undefined },
    () => updateJob(job.id, body as Payload),
  );
}

export const queuePart = (job: JobRef, data: Payload) =>
  submit<WithJob>(
    { kind: "part_add", method: "POST", path: `/jobs/${job.id}/parts`, body: data, jobId: job.id, title: job.title, detail: String(data.name ?? ""), temp: newTempId() },
    () => addPart(job.id, data),
  );

export async function queuePartRemoval(job: JobRef, part: { id: number; name: string }) {
  // Added on this phone and not sent yet: it just leaves the queue.
  if (part.id < 0 && (await withdraw(part.id))) return undefined;
  return submit<WithJob>(
    { kind: "part_remove", method: "DELETE", path: `/jobs/${job.id}/parts/${ref(part.id)}`, jobId: job.id, title: job.title, detail: part.name },
    () => removePart(job.id, part.id),
  );
}

export const queueCheck = (job: JobRef, item: { id: number; label: string }, data: Payload) =>
  submit<WithJob>(
    { kind: "check", method: "PATCH", path: `/jobs/${job.id}/checklist/${item.id}`, body: data, jobId: job.id, title: job.title, detail: item.label },
    () => updateChecklistItem(job.id, item.id, data),
  );

export const queueEntry = (job: JobRef, data: Payload) =>
  submit<WithJob>(
    { kind: "entry_add", method: "POST", path: `/jobs/${job.id}/entries`, body: data, jobId: job.id, title: job.title, temp: newTempId() },
    () => addEntry(job.id, data),
  );

export const queueEntryUpdate = (job: JobRef, entryId: number, data: Payload) =>
  submit<WithJob>(
    { kind: "entry_update", method: "PATCH", path: `/jobs/${job.id}/entries/${ref(entryId)}`, body: data, jobId: job.id, title: job.title },
    () => updateEntry(job.id, entryId, data),
  );

export const queueRecord = (job: JobRef, data: Payload) =>
  submit<WithJob>({ kind: "record", method: "PUT", path: `/jobs/${job.id}/record`, body: data, jobId: job.id, title: job.title }, () => saveRecord(job.id, data));

/** The technician sets off for a booked visit: the customer hears they're on the way. */
export const queueOnTheWay = (job: JobRef) =>
  submit<{ job: Job }>({ kind: "on_the_way", method: "POST", path: `/jobs/${job.id}/on-the-way`, jobId: job.id, title: job.title }, () => onTheWay(job.id));

export const queueNote = (job: JobRef, note: string) =>
  submit<WithJob>(
    { kind: "note", method: "POST", path: `/jobs/${job.id}/notes`, body: { note }, jobId: job.id, title: job.title, detail: note },
    () => addNote(job.id, note),
  );

/** A photo or video, already prepared (shrunk) on the phone. */
export const queueMedia = (job: JobRef, media: MediaInfo, file: Blob, direct: () => Promise<WithJob>) =>
  submit<WithJob>({ kind: "media", method: "POST", path: `/jobs/${job.id}/files`, jobId: job.id, title: job.title, media, temp: newTempId() }, direct, file);

export async function queueMediaRemoval(job: JobRef, fileId: number) {
  if (fileId < 0 && (await withdraw(fileId))) return undefined;
  return submit<WithJob>({ kind: "media_remove", method: "DELETE", path: `/files/${ref(fileId)}`, jobId: job.id, title: job.title }, () => deleteFile(fileId));
}

/** A form's answers on a job (a draft, or `complete: true`), with any new signature as a PNG. */
export const queueForm = (job: JobRef, form: { form_id: number; name: string }, data: FormAnswers) =>
  submit<WithJob>(
    { kind: "form", method: "PUT", path: `/jobs/${job.id}/forms/${form.form_id}`, body: data, jobId: job.id, title: job.title, detail: form.name },
    () => saveFormAnswers(job.id, form.form_id, data),
  );

export const queueConsent = (consent: boolean) =>
  submit<ShiftStatus>({ kind: "consent", method: "POST", path: "/shifts/consent", body: { consent } }, () => setLocationConsent(consent));

export const queueClockIn = (position: PositionResult) =>
  submit<ShiftStatus>({ kind: "clock_in", method: "POST", path: "/shifts/clock-in", body: { ...position } }, () => clockIn(position));

export const queueClockOut = (position: PositionResult) =>
  submit<ShiftStatus>({ kind: "clock_out", method: "POST", path: "/shifts/clock-out", body: { ...position } }, () => clockOut(position));
