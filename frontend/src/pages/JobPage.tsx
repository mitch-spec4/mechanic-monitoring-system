import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Coins,
  Camera,
  Download,
  Film,
  FileText,
  History,
  MapPin,
  Navigation,
  Package,
  Pause,
  Play,
  PenLine,
  Plus,
  Share2,
  Trash2,
  Truck,
  Wrench,
} from "lucide-react";
import { jobDetail, apiUrl, downloadReport, saveCosting } from "../services/api";
import {
  queueCheck,
  queueEntry,
  queueEntryUpdate,
  queueMediaRemoval,
  queueNote,
  queueOnTheWay,
  queuePart,
  queuePartRemoval,
  queueRecord,
} from "../offline/changes";
import { Waiting } from "../components/Offline";
import { toast } from "../components/Feedback";
import SignatureModal, { type SignOff } from "../components/SignatureModal";
import { uploadMedia } from "../lib/media";
import { changeJobStatus } from "../components/Shift";
import { mapLink } from "../lib/location";
import { directionsLink } from "../lib/directions";
import { asDate, currencyName, errorMessage, formatDate, formatDay as dayOf, formatDistance, formatMinutes, formatMoney, formatTime as timeOf, formatVisit, fromZoneInput } from "../lib/format";
import { usePolling } from "../lib/usePolling";
import type { User } from "../services/api";
import type { ChecklistItem, Costing, JobDetail, JobEvent, JobFile, LocationPoint, Part, Payload, WorkEntry } from "../services/types";
import { mark, t } from "../i18n";
import { Trans } from "../i18n/Trans";
import "./JobPage.css";
import { Loading } from "../components/States";
import Field from "../components/Field";
import { SkillTags } from "../components/ServiceCatalog";
import JobFormsCard from "../components/JobFormsCard";

type Props = { jobId: number; user: User; onBack: () => void; onOpenMachine?: (id: number) => void };

// Times are shown on the company's clock.
const stamp = (value: string | null | undefined) => (value ? `${dayOf(value)}, ${timeOf(value)}` : "");

function duration(hours: number) {
  const minutes = Math.round(hours * 60);
  return minutes < 60
    ? t("{minutes} min", { minutes })
    : t("{hours} h {minutes} min", { hours: Math.floor(minutes / 60), minutes: String(minutes % 60).padStart(2, "0") });
}

function clock(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// The server keeps each event's note in English ("Assigned to Ann", "Changed title, due date");
// the names and part details inside are pulled out and the sentence is written in the reader's language.
const EDITED_FIELDS: Record<string, string> = {
  title: mark("title"),
  description: mark("description"),
  priority: mark("priority"),
  "job type": mark("job type"),
  location: mark("site"),
  "due date": mark("due date"),
  machine: mark("equipment"),
  "estimated minutes": mark("estimated time"),
};
const FILE_KINDS: Record<string, string> = {
  "before photo": mark("a before photo"),
  "after photo": mark("an after photo"),
  photo: mark("a photo"),
  video: mark("a video"),
  "form photo": mark("a photo for a form"),
};
const after = (note: string, prefix: RegExp) => note.replace(prefix, "").trim();
// A booked visit the technician can still set off for.
const NOT_STARTED = ["Pending", "Assigned", "Accepted"];

function historyText(event: JobEvent): string {
  const note: string = event.note || "";
  switch (event.action) {
    case "created":
      // Booked by the customer (or a manager for them) at a time they picked.
      return note === "booked" ? t("booked the visit") : t("created the job");
    case "rescheduled":
      return note ? t("moved the visit to {time}", { time: formatVisit(note) }) : t("moved the visit");
    case "on_the_way":
      return t("set off for the visit");
    case "assigned":
      return note ? t("assigned it to {name}", { name: after(note, /^Assigned to/) }) : t("assigned the job");
    case "unassigned":
      return t("removed the technician");
    case "status":
      return t("moved it from {from} to {to}", { from: t(event.from_status || ""), to: t(event.to_status || "") });
    case "updated": {
      const fields = after(note, /^Changed/)
        .split(", ")
        .filter(Boolean)
        .map((field) => (EDITED_FIELDS[field] ? t(EDITED_FIELDS[field]) : field));
      return fields.length ? t("changed {fields}", { fields: fields.join(", ") }) : t("edited the job");
    }
    case "time_added":
      return t("added time ({time})", { time: after(note, /^Added/) });
    case "time_corrected":
      return t("corrected a time entry");
    case "part_added":
      return t("added part {part}", { part: note });
    case "part_removed":
      return t("removed part {part}", { part: note });
    case "checked":
      return t("ticked \"{item}\"", { item: note });
    case "unchecked":
      return t("unticked \"{item}\"", { item: note });
    case "note":
      return t("added a note");
    case "file_added": {
      const kind = FILE_KINDS[after(note, /^Added an? /)];
      return kind ? t("added {file}", { file: t(kind) }) : t("added a file");
    }
    case "file_removed": {
      const kind = FILE_KINDS[after(note, /^Removed an? /)];
      return kind ? t("removed {file}", { file: t(kind) }) : t("removed a file");
    }
    case "signed":
      return t("recorded the customer's signature ({name})", { name: after(note, /^Signed by/) });
    case "not_signed":
      return t("completed without a signature: {reason}", { reason: note });
    case "form_completed":
      return t("completed the form {name}", { name: note });
    case "change_not_applied":
      return t("made a change offline that wasn't applied: a newer change was kept");
    case "replaced":
      return t("replaced an earlier version with a change made offline");
    default:
      return event.action;
  }
}

// A version of a worksheet item kept in the history (a change not applied, or one replaced), as
// the server stores it: {"item": "summary" | "entry" | "checklist", "label": ..., "values": {...}}.
const FIELD_TEXT: Record<string, string> = {
  service_type: mark("Service type"),
  problem: mark("Problem"),
  solution: mark("Solution"),
  advice: mark("Advice"),
  work_done: mark("Work done"),
  site: mark("Site"),
  started_at: mark("Start"),
  ended_at: mark("End"),
  done: mark("Ticked"),
  note: mark("Note"),
};

function VersionNote({ note }: { note: string | null }) {
  let version: { item?: string; label?: string | null; values?: Record<string, unknown> };
  try {
    version = JSON.parse(note || "{}");
  } catch {
    return note ? <blockquote>{note}</blockquote> : null;
  }
  const show = (field: string, value: unknown) =>
    field === "done" ? (value ? t("Yes") : t("No")) : field.endsWith("_at") ? stamp(String(value)) : String(value ?? "—");
  const title =
    version.item === "summary"
      ? t("Service summary")
      : version.item === "entry"
        ? t("Time entry started {time}", { time: stamp(version.label) })
        : version.item === "checklist"
          ? `“${version.label ?? ""}”`
          : version.item === "form"
            ? t("The form {name}", { name: version.label ?? "" })
            : "";
  return (
    <blockquote className="versionNote">
      {title && <strong>{title}</strong>}
      {Object.entries(version.values ?? {}).map(([field, value]) => (
        <span key={field}>
          {FIELD_TEXT[field] ? t(FIELD_TEXT[field]) : field}: {show(field, value)}
        </span>
      ))}
    </blockquote>
  );
}

export default function JobPage({ jobId, user, onBack, onOpenMachine }: Props) {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [signing, setSigning] = useState(false);

  const load = () =>
    jobDetail(jobId)
      .then((data) => setJob(data.job))
      .catch((e) => setError(errorMessage(e)));
  // Reloaded after every change: a technician's waiting changes show on the copy at once.
  usePolling(load, 30000, true);

  useEffect(() => {
    if (!job?.timer_running) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, [job?.timer_running]);

  // Every change returns the fresh worksheet; failures show at the top instead of disappearing.
  const run = async (change: () => Promise<unknown>) => {
    setError("");
    setBusy(true);
    try {
      // Online it's on the server when this returns; offline it waits on the phone. Either way the
      // copy loaded next shows it.
      await change();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!job) {
    return (
      <main className="jobPage">
        <BackButton onBack={onBack} />
        {error ? <div className="error">{error}</div> : <Loading label={t("Loading job…")} />}
      </main>
    );
  }

  const isMechanic = user.role === "mechanic";
  const canEdit = Boolean(job.can_edit);
  const isCustomer = user.role === "customer";
  const blockers = job.completion_blockers ?? [];
  const entries = job.entries ?? [];
  const doneCount = job.checklist.filter((item) => item.done).length;
  const running = entries.find((entry) => entry.running);
  const closedSeconds = entries
    .filter((entry) => !entry.running)
    .reduce((sum, entry) => sum + entry.hours * 3600, 0);
  const liveSeconds = closedSeconds + (running ? Math.max(0, (now - asDate(running.started_at).getTime()) / 1000) : 0);
  const setStatus = (status: string) => run(() => changeJobStatus(job, status, user.role));
  // Completing asks for the customer's sign-off first; it is sent with the completion.
  const complete = (signOff: SignOff) => changeJobStatus(job, "Completed", user.role, signOff);
  const photoCount = (job.files || []).filter((file) => file.kind !== "video").length;
  const partCount = job.parts.length;
  const signFacts = [
    job.customer?.name,
    job.machine?.name,
    photoCount ? (photoCount === 1 ? t("1 photo") : t("{count} photos", { count: photoCount })) : null,
    job.checklist.length ? t("Checklist {done}/{total}", { done: doneCount, total: job.checklist.length }) : null,
    partCount ? (partCount === 1 ? t("1 part used") : t("{count} parts used", { count: partCount })) : null,
  ].filter(Boolean) as string[];

  return (
    <main className={`jobPage status-${job.status.replace(/ /g, "").toLowerCase()}`}>
      <BackButton onBack={onBack} />

      <section className="jobHero" aria-label={t("Job summary")}>
        <div className="jobHeroTop">
          <span className="eyebrow">
            {[job.job_type || t("General job"), t("{priority} priority", { priority: t(job.priority) })].join(" · ")}
          </span>
          <span className={`jobStatusPill ${job.status.replace(/ /g, "").toLowerCase()}`}>{t(job.status)}</span>
          {job.pending_status && <Waiting />}
        </div>
        <h1>{job.title}</h1>
        <p className="jobDescription">{job.description}</p>
        <dl className="jobMeta">
          {job.customer && <Meta label={t("Customer")} value={job.customer.name} />}
          {job.machine && (
            <div>
              <dt>{t("Equipment")}</dt>
              <dd>
                {onOpenMachine ? (
                  <button className="titleLink" onClick={() => onOpenMachine(job.machine!.id)}>
                    {job.machine.name}
                  </button>
                ) : (
                  job.machine.name
                )}{" "}
                · {job.machine.serial_no}
              </dd>
            </div>
          )}
          <div>
            <dt>{t("Site")}</dt>
            <dd>
              <MapPin size={13} />
              {job.location || t("Not set")}
              {job.position && !isCustomer && (
                <a className="listAction jobDirections" href={directionsLink(job.position)} target="_blank" rel="noreferrer">
                  <Navigation size={12} /> {t("Directions")}
                </a>
              )}
            </dd>
          </div>
          {job.scheduled_start ? (
            <Meta label={t("Booked visit")} value={formatVisit(job.scheduled_start, job.scheduled_end)} icon={<CalendarClock size={13} />} />
          ) : (
            <Meta label={t("Due")} value={formatDate(job.due_date) || t("Not set")} />
          )}
          {!isMechanic && <Meta label={t("Technician")} value={job.mechanic?.name || t("Not assigned")} />}
          {job.estimated_minutes ? <Meta label={t("Estimated time")} value={formatMinutes(job.estimated_minutes)} icon={<Clock size={13} />} /> : null}
          {job.service && !isCustomer && (
            <div>
              <dt>{t("Service")}</dt>
              <dd className="jobService">
                {job.service.name}
                <SkillTags skills={job.service.skills} />
              </dd>
            </div>
          )}
        </dl>

        {!isCustomer && (
          <div className="jobTimer" aria-live="polite">
            <Clock size={18} />
            <div>
              <strong data-testid="total-time">{clock(liveSeconds)}</strong>
              <span>{running ? t("Timer running") : t("Total time on this job")}</span>
            </div>
            {running && <i className="pulseDot" aria-hidden="true" />}
          </div>
        )}

        {job.on_the_way_at && NOT_STARTED.includes(job.status) && (
          <p className="jobOnTheWay" role="status">
            <Truck size={15} /> {t("On the way since {time}", { time: timeOf(job.on_the_way_at) })}
          </p>
        )}

        {isMechanic && canEdit && (
          <div className="jobActions">
            {job.visit && !job.on_the_way_at && NOT_STARTED.includes(job.status) && (
              <button className="secondary" disabled={busy} onClick={() => run(() => queueOnTheWay(job))}>
                <Truck size={16} /> {t("On my way")}
              </button>
            )}
            {job.status === "Assigned" && (
              <>
                <button className="primary" disabled={busy} onClick={() => setStatus("In Progress")}>
                  <Play size={16} /> {t("Start work")}
                </button>
                <button className="secondary" disabled={busy} onClick={() => setStatus("Accepted")}>
                  {t("Accept for later")}
                </button>
              </>
            )}
            {job.status === "Accepted" && (
              <button className="primary" disabled={busy} onClick={() => setStatus("In Progress")}>
                <Play size={16} /> {t("Start work")}
              </button>
            )}
            {job.status === "Paused" && (
              <button className="primary" disabled={busy} onClick={() => setStatus("In Progress")}>
                <Play size={16} /> {t("Resume")}
              </button>
            )}
            {job.status === "In Progress" && (
              <>
                <button
                  className="primary"
                  disabled={busy || blockers.length > 0}
                  onClick={() => setSigning(true)}
                >
                  <CheckCircle2 size={16} /> {t("Complete job")}
                </button>
                <button className="secondary" disabled={busy} onClick={() => setStatus("Paused")}>
                  <Pause size={16} /> {t("Pause")}
                </button>
              </>
            )}
          </div>
        )}
        {job.report_url && <ReportActions job={job} url={job.report_url} onError={setError} />}
      </section>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {isMechanic && job.status === "In Progress" && blockers.length > 0 && (
        <div className="jobBlockers" role="status">
          <strong>{t("Before you can complete this job")}</strong>
          <ul>
            {blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="jobGrid">
        {isCustomer ? (
          <Card title={t("Work done")} icon={<Wrench size={16} />}>
            {job.work_done.length ? (
              <ul className="workDoneList">
                {job.work_done.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            ) : (
              <Empty text={t("Work notes will appear here once the technician starts.")} />
            )}
          </Card>
        ) : (
          <Card
            title={t("Time & work")}
            icon={<Clock size={16} />}
            badge={entries.length === 1 ? t("1 entry") : t("{count} entries", { count: entries.length })}
          >
            {entries.length === 0 && <Empty text={canEdit ? t("Press Start work to begin timing this job.") : t("No time recorded yet.")} />}
            <ol className="entryList">
              {entries.map((entry) => (
                <EntryRow key={entry.id} entry={entry} canEdit={canEdit} onSave={(data) => run(() => queueEntryUpdate(job, entry.id, data))} />
              ))}
            </ol>
            {canEdit && <ManualEntry busy={busy} location={job.location} onAdd={(data) => run(() => queueEntry(job, data))} />}
          </Card>
        )}

        <Card
          title={t("Checklist")}
          icon={<ClipboardCheck size={16} />}
          badge={job.checklist.length ? `${doneCount}/${job.checklist.length}` : undefined}
        >
          {job.checklist.length === 0 ? (
            <Empty text={job.job_type ? t("The checklist appears when work starts.") : t("This job has no job type, so it has no checklist.")} />
          ) : (
            <>
              <div className="checkProgress" aria-hidden="true">
                <i style={{ width: `${(doneCount / job.checklist.length) * 100}%` }} />
              </div>
              <ul className="checklist">
                {job.checklist.map((item: ChecklistItem) => (
                  <li key={item.id} className={item.done ? "done" : ""}>
                    <label>
                      <input
                        type="checkbox"
                        checked={item.done}
                        disabled={!canEdit || busy}
                        onChange={(event) => run(() => queueCheck(job, item, { done: event.target.checked }))}
                      />
                      <span className="checkBox" aria-hidden="true">
                        <CheckCircle2 size={14} />
                      </span>
                      <span className="checkLabel">
                        {item.label}
                        {item.required && <em>{t("Required")}</em>}
                        {item.done && item.done_by && !isCustomer && (
                          <small>
                            {item.done_by} · {stamp(item.done_at)}
                          </small>
                        )}
                        {item.pending && <Waiting />}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        <Card title={t("Parts used")} icon={<Package size={16} />} badge={job.parts.length ? String(job.parts.length) : undefined}>
          {job.parts.length === 0 && <Empty text={t("No parts recorded.")} />}
          <ul className="partList">
            {job.parts.map((part: Part) => (
              <li key={part.id}>
                <span className="partQty">×{part.label}</span>
                <span className="partName">
                  {part.name} {part.pending && <Waiting />}
                </span>
                {canEdit && (
                  <button
                    className="iconButton partRemove"
                    title={t("Remove part")}
                    aria-label={t("Remove {name}", { name: part.name })}
                    disabled={busy}
                    onClick={() => run(() => queuePartRemoval(job, part))}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {canEdit && <PartForm busy={busy} onAdd={(data) => run(() => queuePart(job, data))} />}
        </Card>

        <Card title={t("Service summary")} icon={<FileText size={16} />}>
          {!job.machine ? (
            <Empty text={t("This job has no equipment, so there is no service record for the customer.")} />
          ) : canEdit ? (
            <RecordForm record={job.record} pending={Boolean(job.record_pending)} busy={busy} onSave={(data) => run(() => queueRecord(job, data))} />
          ) : job.record ? (
            <dl className="recordView">
              <Meta label={t("Service")} value={job.record.service_type} />
              <Meta label={t("Problem")} value={job.record.problem || "—"} />
              <Meta label={t("Solution")} value={job.record.solution || "—"} />
              <Meta label={t("Advice")} value={job.record.advice || "—"} />
            </dl>
          ) : (
            <Empty text={t("The summary for the customer is written when the job is completed.")} />
          )}
        </Card>

        <JobFormsCard job={job} user={user} reload={load} />

        <MediaCard job={job} busy={busy} run={run} />

        {job.costing && <CostingCard job={job} costing={job.costing} onSaved={load} />}

        {job.signature && (
          <Card title={t("Customer sign-off")} icon={<PenLine size={16} />}>
            {"not_signed_reason" in job.signature ? (
              <p className="signOffNote">{t("Not signed: {reason}", { reason: job.signature.not_signed_reason })}</p>
            ) : (
              <div className="signOffView">
                {job.signature.url && <img src={apiUrl(job.signature.url)} alt={t("Signature of {name}", { name: job.signature.name })} />}
                <span>
                  <Trans text="Signed by {name}" values={{ name: <b>{job.signature.name}</b> }} /> · {stamp(job.signature.signed_at)}
                </span>
              </div>
            )}
          </Card>
        )}

        {!isCustomer && job.locations && job.locations.length > 0 && (
          <Card title={t("Locations")} icon={<MapPin size={16} />} wide>
            <ul className="stampList">
              {job.locations.map((point, index) => (
                <li key={index}>
                  <strong>{STAMP_TEXT[point.kind] ? t(STAMP_TEXT[point.kind]) : point.kind}</strong>
                  <span>{stamp(point.recorded_at)}</span>
                  {point.latitude != null && point.longitude != null ? (
                    <a href={mapLink(point.latitude, point.longitude)} target="_blank" rel="noreferrer">
                      <MapPin size={12} /> {t("View on map")}
                      {point.accuracy_m ? ` (±${formatDistance(point.accuracy_m)})` : ""}
                    </a>
                  ) : (
                    <em>{t("Location not shared ({reason})", { reason: t(MISSING_TEXT[point.missing_reason ?? "none"] || MISSING_TEXT.none) })}</em>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {!isCustomer && (
          <Card title={t("History")} icon={<History size={16} />} wide>
            <ol className="timeline">
              {(job.history || []).map((event: JobEvent) => (
                <li key={event.id} className={`timeline-${event.action}`}>
                  <span className="timelineDot" aria-hidden="true" />
                  <div>
                    <p>
                      <strong>{event.user || t("System")}</strong> {historyText(event)} {event.pending && <Waiting />}
                    </p>
                    {event.action === "note" && <blockquote>{event.note}</blockquote>}
                    {(event.action === "change_not_applied" || event.action === "replaced") && <VersionNote note={event.note} />}
                    <small>
                      {event.synced_at
                        ? t("Done offline at {time}, synced at {synced}", { time: stamp(event.created_at), synced: stamp(event.synced_at) })
                        : stamp(event.created_at)}
                    </small>
                  </div>
                </li>
              ))}
            </ol>
            <NoteForm busy={busy} onAdd={(note) => run(() => queueNote(job, note))} />
          </Card>
        )}
      </div>
      {signing && (
        <SignatureModal
          jobTitle={job.title}
          facts={signFacts}
          onSubmit={complete}
          onDone={() => {
            setSigning(false);
            load();
          }}
          onClose={() => setSigning(false)}
        />
      )}
    </main>
  );
}

const STAMP_TEXT: Record<string, string> = { job_start: mark("Started or resumed work"), job_complete: mark("Completed the job") };
const MISSING_TEXT: Record<string, string> = {
  denied: mark("location blocked"),
  unavailable: mark("no GPS"),
  timeout: mark("timed out"),
  unsupported: mark("not supported"),
  not_sent: mark("not sent"),
  none: mark("no position"),
};

// The tag on each photo, and the button that adds one.
const KIND_LABEL: Record<string, string> = { before: mark("Before"), after: mark("After"), other: mark("Photo"), video: mark("Video") };
const PICK_LABEL: Record<string, string> = { before: mark("Before photo"), after: mark("After photo"), other: mark("Other photo") };

type Run = (change: () => Promise<unknown>) => Promise<void>;

function MediaCard({ job, busy, run }: { job: JobDetail; busy: boolean; run: Run }) {
  const [uploading, setUploading] = useState("");
  const [problem, setProblem] = useState("");
  const photos: JobFile[] = job.files.filter((file) => file.kind !== "video");
  const videos: JobFile[] = job.files.filter((file) => file.kind === "video");
  const limits = job.media_limits;
  const canUpload = Boolean(job.can_upload && limits);
  if (!canUpload && job.files.length === 0) {
    const finished = job.status === "Completed" || job.status === "Cancelled";
    return (
      <Card title={t("Photos & videos")} icon={<Camera size={16} />}>
        <Empty text={finished ? t("No photos or videos were added.") : t("Photos and videos can be added once work starts.")} />
      </Card>
    );
  }
  const pick = async (kind: string, input: HTMLInputElement) => {
    const files = Array.from(input.files || []);
    input.value = "";
    if (!files.length || !limits) return;
    setProblem("");
    for (const [index, file] of files.entries()) {
      setUploading(files.length > 1 ? t("Uploading {number} of {count}…", { number: index + 1, count: files.length }) : t("Uploading…"));
      try {
        const sent = await uploadMedia(job, kind, file, limits);
        // Not uploaded yet (offline, or a slow connection): it's kept on the phone and goes later.
        if (!sent) toast(t("Saved on this phone. It uploads when you have a good connection."), "info");
        await run(async () => undefined);
      } catch (e) {
        setProblem(errorMessage(e));
        break;
      }
    }
    setUploading("");
  };
  const remove = (file: JobFile) => run(() => queueMediaRemoval(job, file.id));
  return (
    <Card title={t("Photos & videos")} icon={<Camera size={16} />} badge={job.files.length ? String(job.files.length) : undefined} wide>
      {problem && <div className="error">{problem}</div>}
      {photos.length > 0 && (
        <ul className="mediaGrid">
          {photos.map((file) => (
            <li key={file.id}>
              <a href={apiUrl(file.url)} target="_blank" rel="noreferrer">
                <img src={apiUrl(file.url)} alt={t(PICK_LABEL[file.kind] ?? "Photo")} loading="lazy" />
              </a>
              <span className={`mediaTag ${file.kind}`}>{t(KIND_LABEL[file.kind] ?? "Photo")}</span>
              {file.pending && <Waiting />}
              {canUpload && (
                <button className="iconButton mediaRemove" title={t("Remove photo")} aria-label={t("Remove photo")} disabled={busy} onClick={() => remove(file)}>
                  <Trash2 size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {videos.length > 0 && (
        <ul className="mediaVideos">
          {videos.map((file) => (
            <li key={file.id}>
              <video src={apiUrl(file.url)} controls preload="metadata" playsInline />
              {file.pending && <Waiting />}
              {canUpload && (
                <button className="iconButton mediaRemove" title={t("Remove video")} aria-label={t("Remove video")} disabled={busy} onClick={() => remove(file)}>
                  <Trash2 size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canUpload && limits && (
        <div className="mediaActions">
          {uploading ? (
            <span className="mediaUploading" role="status">
              {uploading}
            </span>
          ) : (
            <div className="mediaButtons">
              {(["before", "after", "other"] as const).map((kind) => (
                <label key={kind} className="secondary mediaPick">
                  <Camera size={15} /> {t(PICK_LABEL[kind])}
                  <input type="file" accept="image/*" multiple onChange={(e) => pick(kind, e.currentTarget)} />
                </label>
              ))}
              <label className="secondary mediaPick">
                <Film size={15} /> {t("Video")}
                <input type="file" accept="video/*" onChange={(e) => pick("video", e.currentTarget)} />
              </label>
            </div>
          )}
          <small className="muted">
            {t("Photos are shrunk on your phone before they upload. Videos: up to {seconds} seconds and {size} MB.", {
              seconds: limits.video_seconds,
              size: limits.video_mb,
            })}
          </small>
        </div>
      )}
    </Card>
  );
}

function ReportActions({ job, url: reportUrl, onError }: { job: JobDetail; url: string; onError: (message: string) => void }) {
  const [working, setWorking] = useState(false);
  const fileName = `job-${job.id}-report.pdf`;
  // The phone's share sheet (WhatsApp, email...) when it can share files; otherwise a download.
  const share = async () => {
    setWorking(true);
    try {
      const file = new File([await downloadReport(reportUrl)], fileName, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: t("{title} service report", { title: job.title }) }).catch(() => {});
      } else {
        const url = URL.createObjectURL(file);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setWorking(false);
    }
  };
  return (
    <div className="jobActions reportActions">
      <button className="primary" disabled={working} onClick={share}>
        <Share2 size={16} /> {working ? t("Preparing…") : t("Share report")}
      </button>
      <a className="secondary" href={apiUrl(`${reportUrl}?download=1`)} download={fileName}>
        <Download size={16} /> {t("Download PDF")}
      </a>
    </div>
  );
}

// Amounts typed in the company's currency ("1500" or "1500.50"); the server keeps cents.
const asTyped = (cents: number | null) => (cents == null ? "" : String(cents / 100));
const amount = (cents: number | null) => (cents == null ? "—" : formatMoney(cents));

/** Managers: what the job cost (time × pay rate, parts × unit cost), what the customer was charged,
 *  and the margin. Gaps (no pay rate, no part cost) are listed, not counted as free. */
function CostingCard({ job, costing, onSaved }: { job: JobDetail; costing: Costing; onSaved: () => Promise<unknown> }) {
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const typed = (name: string) => String(form.get(name) ?? "").trim() || null;
    setProblem("");
    setSaving(true);
    try {
      await saveCosting(job.id, { charged: typed("charged"), parts: costing.parts.map((part) => ({ id: part.id, unit_cost: typed(`part-${part.id}`) })) });
      toast(t("Costs saved"));
      await onSaved();
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  const margin = costing.margin_cents;
  // A fresh form when the saved amounts change, so it shows them.
  const saved = [costing.charged_cents, ...costing.parts.map((part) => part.unit_cost_cents)].join();
  return (
    <Card title={t("Costs and margin")} icon={<Coins size={16} />} badge={margin == null ? undefined : formatMoney(margin)} wide>
      <form className="costing" onSubmit={submit} key={saved}>
        {problem && <div className="error">{problem}</div>}
        <table className="costingTable">
          <thead>
            <tr>
              <th scope="col">{t("Cost")}</th>
              <th scope="col">{t("Amount")}</th>
              <th scope="col">{t("Rate or unit cost ({currency})", { currency: currencyName() })}</th>
              <th scope="col">{t("Total")}</th>
            </tr>
          </thead>
          <tbody>
            {costing.labour.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  {t("No time recorded yet.")}
                </td>
              </tr>
            )}
            {costing.labour.map((row) => (
              <tr key={`labour-${row.mechanic_id}`}>
                <th scope="row">{t("Labour: {name}", { name: row.name ?? t("Former technician") })}</th>
                <td>{duration(row.hours)}</td>
                <td>{row.rate_cents == null ? <em className="costingGap">{t("No pay rate")}</em> : t("{amount} an hour", { amount: formatMoney(row.rate_cents) })}</td>
                <td>{amount(row.cost_cents)}</td>
              </tr>
            ))}
            {costing.parts.map((part) => (
              <tr key={`part-${part.id}`}>
                <th scope="row">{part.name}</th>
                <td>×{part.quantity}</td>
                <td>
                  <input
                    name={`part-${part.id}`}
                    inputMode="decimal"
                    defaultValue={asTyped(part.unit_cost_cents)}
                    placeholder={t("Unit cost")}
                    aria-label={t("Unit cost of {name} ({currency})", { name: part.name, currency: currencyName() })}
                  />
                </td>
                <td>{amount(part.cost_cents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={3}>
                {t("Total cost")}
              </th>
              <td>{formatMoney(costing.cost_cents)}</td>
            </tr>
          </tfoot>
        </table>
        <div className="costingResult">
          <Field label={t("Charged to the customer ({currency})", { currency: currencyName() })} optional>
            <input id={`charged-${job.id}`} name="charged" inputMode="decimal" defaultValue={asTyped(costing.charged_cents)} />
          </Field>
          <div className={`costingMargin ${margin == null ? "unknown" : margin < 0 ? "loss" : ""}`} role="status">
            <span>{t("Margin")}</span>
            <strong>{margin == null ? "—" : formatMoney(margin)}</strong>
            <small>
              {margin == null
                ? t("Add what you charged to see the margin.")
                : costing.margin_percent == null
                  ? ""
                  : t("{percent}% of what you charged", { percent: costing.margin_percent })}
            </small>
          </div>
        </div>
        {(costing.missing_rates.length > 0 || costing.missing_costs.length > 0) && (
          <ul className="costingGaps">
            {costing.missing_rates.length > 0 && (
              <li>
                {t("Not counted, no pay rate yet: time by {names}. Set pay rates on the Technicians page.", {
                  names: costing.missing_rates.map((name) => name ?? t("Former technician")).join(", "),
                })}
              </li>
            )}
            {costing.missing_costs.length > 0 && <li>{t("Not counted, no unit cost yet: {parts}.", { parts: costing.missing_costs.join(", ") })}</li>}
          </ul>
        )}
        <button className="primary costingSave" disabled={saving}>
          {saving ? t("Saving…") : t("Save costs")}
        </button>
      </form>
    </Card>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button className="link jobBack" onClick={onBack}>
      <ArrowLeft size={15} /> {t("Back")}
    </button>
  );
}

function Meta({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {icon}
        {value}
      </dd>
    </div>
  );
}

function Card({ title, icon, badge, wide, children }: { title: string; icon: ReactNode; badge?: string; wide?: boolean; children: ReactNode }) {
  return (
    <section className={`jobCard ${wide ? "wide" : ""}`}>
      <div className="jobCardHead">
        <h2>
          {icon}
          {title}
        </h2>
        {badge && <span className="jobBadge">{badge}</span>}
      </div>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="muted jobEmpty">{text}</p>;
}

type Save = (data: Payload) => Promise<unknown> | void;

function EntryRow({ entry, canEdit, onSave }: { entry: WorkEntry; canEdit: boolean; onSave: Save }) {
  const [work, setWork] = useState(entry.work_done || "");
  useEffect(() => setWork(entry.work_done || ""), [entry.work_done]);
  const changed = work.trim() !== (entry.work_done || "").trim();
  return (
    <li className={entry.running ? "running" : ""}>
      <div className="entryTop">
        <strong>{dayOf(entry.started_at)}</strong>
        <span>
          {timeOf(entry.started_at)} – {entry.running ? t("now") : timeOf(entry.ended_at)}
        </span>
        <em>{entry.running ? t("Running") : duration(entry.hours)}</em>
        {entry.pending && <Waiting />}
      </div>
      {entry.site && (
        <small className="entrySite">
          <MapPin size={11} /> {entry.site}
        </small>
      )}
      {canEdit ? (
        <div className="entryWork">
          <Field wrap label={t("Work done")}>
            <textarea id={`work-${entry.id}`} value={work} placeholder={t("What did you do on this visit?")} onChange={(event) => setWork(event.target.value)} />
          </Field>
          {changed && (
            <button className="secondary" onClick={() => onSave({ work_done: work })}>
              {t("Save notes")}
            </button>
          )}
        </div>
      ) : (
        <p className="entryNotes">{entry.work_done || <span className="muted">{t("No notes for this visit.")}</span>}</p>
      )}
    </li>
  );
}

// datetime-local fields are read on the company's clock, like every time shown; the API wants an exact moment.
const toIso = (local: string) => (local ? fromZoneInput(local).toISOString() : "");

function ManualEntry({ onAdd, busy, location }: { onAdd: Save; busy: boolean; location?: string | null }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button className="link addLink" onClick={() => setOpen(true)}>
        <Plus size={14} /> {t("Add time manually")}
      </button>
    );
  }
  return (
    <form
      className="inlineForm"
      onSubmit={async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
        await onAdd({ ...form, started_at: toIso(form.started_at), ended_at: toIso(form.ended_at) });
        setOpen(false);
      }}
    >
      <div className="inlineRow">
        <Field wrap label={t("Start")}>
          <input name="started_at" type="datetime-local" required />
        </Field>
        <Field wrap label={t("End")}>
          <input name="ended_at" type="datetime-local" required />
        </Field>
      </div>
      <Field wrap label={t("Site")}>
        <input name="site" defaultValue={location || ""} />
      </Field>
      <Field wrap label={t("Work done")}>
        <textarea name="work_done" placeholder={t("What did you do?")} />
      </Field>
      <div className="inlineRow">
        <button className="primary" disabled={busy}>
          {t("Add time")}
        </button>
        <button type="button" className="secondary" onClick={() => setOpen(false)}>
          {t("Cancel")}
        </button>
      </div>
    </form>
  );
}

function PartForm({ onAdd, busy }: { onAdd: Save; busy: boolean }) {
  return (
    <form
      className="inlineForm partForm"
      onSubmit={async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const formElement = event.currentTarget;
        await onAdd(Object.fromEntries(new FormData(formElement)));
        formElement.reset();
      }}
    >
      <Field wrap className="grow" label={t("Part")}>
        <input name="name" placeholder={t("e.g. {example}", { example: t("Oil filter") })} required />
      </Field>
      <Field wrap className="qty" label={t("Qty")}>
        <input name="quantity" type="number" min="0.01" step="any" defaultValue="1" required />
      </Field>
      <button className="primary" disabled={busy}>
        <Plus size={15} /> {t("Add")}
      </button>
    </form>
  );
}

function RecordForm({ record, pending, onSave, busy }: { record: JobDetail["record"]; pending: boolean; onSave: Save; busy: boolean }) {
  return (
    <form
      className="inlineForm"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSave(Object.fromEntries(new FormData(event.currentTarget)));
      }}
    >
      <p className="muted">{t("Shown to the customer in their service history. Work done and parts are added automatically.")}</p>
      <Field wrap label={t("Problem found")}>
        <textarea name="problem" defaultValue={record?.problem || ""} />
      </Field>
      <Field wrap label={t("Solution")}>
        <textarea name="solution" defaultValue={record?.solution || ""} />
      </Field>
      <Field wrap label={t("Advice for the customer")}>
        <textarea name="advice" defaultValue={record?.advice || ""} />
      </Field>
      <div className="inlineRow">
        <button className="secondary" disabled={busy}>
          {t("Save summary")}
        </button>
        {pending && <Waiting />}
      </div>
    </form>
  );
}

function NoteForm({ onAdd, busy }: { onAdd: (note: string) => Promise<unknown>; busy: boolean }) {
  return (
    <form
      className="inlineForm noteForm"
      onSubmit={async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const formElement = event.currentTarget;
        const note = String(new FormData(formElement).get("note") || "").trim();
        if (!note) return;
        await onAdd(note);
        formElement.reset();
      }}
    >
      <Field wrap className="grow" label={t("Add a note to the history")}>
        <input name="note" placeholder={t("e.g. {example}", { example: t("Customer asked us to call before arriving") })} />
      </Field>
      <button className="secondary" disabled={busy}>
        {t("Add note")}
      </button>
    </form>
  );
}
