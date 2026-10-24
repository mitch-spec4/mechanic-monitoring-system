import type { ChecklistItem, Job, JobDetail, JobEvent, JobFile, Part, ShiftStatus, WorkEntry } from "../services/types";
import { t } from "../i18n";
import { idIn, type QueueItem } from "./types";

/**
 * The screens show the server's copy with the changes still on the phone applied on top, each
 * marked "waiting to sync". When a change reaches the server it leaves the queue and the
 * server's next copy has it, so nothing is shown twice.
 */
export type Context = { me: string; temps: Record<string, number>; previews: Map<string, string> };

const FINISHED = ["Completed", "Cancelled"];
const iso = (value: string) => new Date(value).toISOString();
const hoursBetween = (start: string, end: string) => Math.round(Math.max(0, Date.parse(stamped(end)) - Date.parse(stamped(start))) / 36_000) / 100;
// The API's times are UTC without a zone.
const stamped = (value: string) => (/Z$|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);
const quantityLabel = (value: number) => String(Number(value.toFixed(2)));
const live = (items: QueueItem[]) => items.filter((item) => item.state !== "failed");
const segment = (path: string, after: string) => path.split("/")[path.split("/").indexOf(after) + 1];

/** The same rules as the server's: what still stops this job from being completed. */
export function completionBlockers(job: JobDetail) {
  const blockers: string[] = [];
  const entries = job.entries ?? [];
  if (!entries.length) blockers.push(t("Start work so the worksheet has a time entry"));
  else if (!entries.some((entry) => (entry.work_done ?? "").trim())) blockers.push(t("Describe the work done on the worksheet"));
  const missing = job.checklist.filter((item) => item.required && !item.done).length;
  if (missing === 1) blockers.push(t("Tick 1 required checklist item"));
  else if (missing > 1) blockers.push(t("Tick {count} required checklist items", { count: missing }));
  return blockers;
}

function stopTimer(job: JobDetail, at: string) {
  for (const entry of job.entries ?? []) {
    if (!entry.running) continue;
    entry.ended_at = at;
    entry.running = false;
    entry.hours = hoursBetween(entry.started_at, at);
  }
}

function event(item: QueueItem, ctx: Context, fields: Partial<JobEvent>): JobEvent {
  return { id: -(item.seq ?? 0), action: "note", from_status: null, to_status: null, note: null, user: ctx.me, created_at: iso(item.at), pending: true, ...fields };
}

/** A job's worksheet with the phone's waiting changes applied. */
export function overlayJob(server: JobDetail, items: QueueItem[], ctx: Context): JobDetail {
  const mine = live(items).filter((item) => item.jobId === server.id || item.kind === "clock_out");
  if (!mine.length) return server;
  const job: JobDetail = structuredClone(server);
  job.entries ??= [];
  job.history ??= [];
  let changed = false;
  for (const item of mine) {
    const at = iso(item.at);
    const body = item.body ?? {};
    switch (item.kind) {
      case "status":
      case "clock_out": {
        // Clocking out pauses the job being worked on, as the server does.
        const status = item.kind === "clock_out" ? (job.status === "In Progress" ? "Paused" : null) : String(body.status);
        if (!status || status === job.status) break;
        if (status === "In Progress" && !job.entries.some((entry) => entry.running)) {
          job.entries.push({ id: item.temp ?? -1, mechanic: ctx.me, started_at: at, ended_at: null, running: true, hours: 0, site: job.location, work_done: null, pending: true });
        }
        if (status === "Paused" || status === "Completed") stopTimer(job, at);
        if (status === "Completed") {
          const signature = body.signature as { name: string; image: string } | undefined;
          job.signature = signature ? { name: signature.name, signed_at: at, url: signature.image } : { not_signed_reason: String(body.no_signature_reason ?? "") };
        }
        job.history.push(event(item, ctx, { action: "status", from_status: job.status, to_status: status }));
        job.status = status;
        job.pending_status = true;
        break;
      }
      case "part_add": {
        const quantity = Number(body.quantity ?? 1) || 1;
        const part: Part = { id: item.temp ?? -1, name: String(body.name), quantity, label: quantityLabel(quantity), added_by: ctx.me, pending: true };
        job.parts.push(part);
        job.history.push(event(item, ctx, { action: "part_added", note: `${part.name} ×${part.label}` }));
        break;
      }
      case "part_remove": {
        const id = idIn(segment(item.path, "parts"), ctx.temps);
        const part = job.parts.find((candidate) => candidate.id === id);
        job.parts = job.parts.filter((candidate) => candidate.id !== id);
        if (part) job.history.push(event(item, ctx, { action: "part_removed", note: `${part.name} ×${part.label}` }));
        break;
      }
      case "check": {
        const id = idIn(segment(item.path, "checklist"), ctx.temps);
        const check = job.checklist.find((candidate: ChecklistItem) => candidate.id === id);
        if (!check) break;
        if (typeof body.done === "boolean" && body.done !== check.done) {
          check.done = body.done;
          check.done_by = body.done ? ctx.me : null;
          check.done_at = body.done ? at : null;
          job.history.push(event(item, ctx, { action: body.done ? "checked" : "unchecked", note: check.label }));
        }
        if ("note" in body) check.note = (body.note as string | null) ?? null;
        check.pending = true;
        break;
      }
      case "entry_add": {
        const started = String(body.started_at);
        const ended = String(body.ended_at);
        job.entries.push({
          id: item.temp ?? -1,
          mechanic: ctx.me,
          started_at: started,
          ended_at: ended,
          running: false,
          hours: hoursBetween(started, ended),
          site: (body.site as string) || job.location,
          work_done: (body.work_done as string) || null,
          pending: true,
        });
        job.entries.sort((a, b) => Date.parse(stamped(a.started_at)) - Date.parse(stamped(b.started_at)));
        job.history.push(event(item, ctx, { action: "time_added", note: `Added ${hoursBetween(started, ended)} h` }));
        break;
      }
      case "entry_update": {
        const id = idIn(segment(item.path, "entries"), ctx.temps);
        const entry = job.entries.find((candidate: WorkEntry) => candidate.id === id);
        if (!entry) break;
        if ("work_done" in body) entry.work_done = (body.work_done as string) || null;
        if ("site" in body) entry.site = (body.site as string) || null;
        entry.pending = true;
        break;
      }
      case "record": {
        const record = job.record ?? { id: 0, service_type: job.job_type || "Service", problem: null, solution: null, advice: null, work_done: null, parts_replaced: null };
        job.record = { ...record, ...(body as Partial<NonNullable<JobDetail["record"]>>) };
        job.record_pending = true;
        break;
      }
      case "note":
        job.history.push(event(item, ctx, { action: "note", note: String(body.note ?? "") }));
        break;
      case "media": {
        const file: JobFile = {
          id: item.temp ?? -1,
          kind: item.media?.kind ?? "other",
          content_type: item.media?.contentType ?? "image/jpeg",
          size_bytes: item.media?.size ?? 0,
          url: ctx.previews.get(item.id) ?? "",
          created_at: at,
          uploaded_by: ctx.me,
          pending: true,
        };
        job.files.push(file);
        break;
      }
      case "media_remove": {
        const id = idIn(segment(item.path, "files"), ctx.temps);
        job.files = job.files.filter((file) => file.id !== id);
        break;
      }
      default:
        continue;
    }
    changed = true;
  }
  if (!changed) return server;
  job.history.sort((a, b) => Date.parse(stamped(a.created_at)) - Date.parse(stamped(b.created_at)));
  job.total_hours = Math.round(job.entries.reduce((sum, entry) => sum + entry.hours, 0) * 100) / 100;
  job.timer_running = job.entries.some((entry) => entry.running);
  job.can_edit = !FINISHED.includes(job.status);
  job.can_upload = job.status === "In Progress" || job.status === "Paused" || job.files.some((file) => file.pending);
  job.completion_blockers = job.can_edit ? completionBlockers(job) : [];
  return job;
}

/** The job list with waiting starts, pauses and completions applied. */
export function overlayJobs(jobs: Job[], items: QueueItem[]): Job[] {
  const changes = live(items).filter((item) => item.kind === "status" || item.kind === "clock_out");
  if (!changes.length) return jobs;
  return jobs.map((job) => {
    let status = job.status;
    for (const item of changes) {
      if (item.kind === "clock_out" && status === "In Progress") status = "Paused";
      if (item.kind === "status" && item.jobId === job.id) status = String(item.body?.status);
    }
    return status === job.status ? job : { ...job, status, pending_status: true };
  });
}

/** Clock in, clock out and location consent, as the phone has them. */
export function overlayShift(server: ShiftStatus, items: QueueItem[], userId: number): ShiftStatus {
  let status = server;
  for (const item of live(items)) {
    const at = iso(item.at);
    if (item.kind === "consent") status = { ...status, consent: Boolean(item.body?.consent), consent_at: item.body?.consent ? at : null };
    if (item.kind === "clock_in" && !status.shift) {
      status = {
        ...status,
        shift: {
          id: -1,
          user_id: userId,
          mechanic: null,
          clocked_in_at: at,
          clocked_out_at: null,
          open: true,
          hours: 0,
          long: false,
          edited: false,
          edited_by: null,
          original_clocked_out_at: null,
          clock_in_location: null,
          clock_out_location: null,
          pending: true,
        },
      };
    }
    if (item.kind === "clock_out") status = { ...status, shift: null };
  }
  return status;
}
