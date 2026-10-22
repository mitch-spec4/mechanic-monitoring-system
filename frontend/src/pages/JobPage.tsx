import { useEffect, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Camera,
  Download,
  Film,
  FileText,
  History,
  MapPin,
  Package,
  Pause,
  Play,
  PenLine,
  Plus,
  Share2,
  Trash2,
  Wrench,
} from "lucide-react";
import {
  addEntry,
  addNote,
  addPart,
  jobDetail,
  removePart,
  saveRecord,
  updateChecklistItem,
  updateEntry,
  apiUrl,
  deleteFile,
  downloadReport,
} from "../services/api";
import SignatureModal, { SignOff } from "../components/SignatureModal";
import { uploadMedia } from "../lib/media";
import { changeJobStatus } from "../components/Shift";
import { mapLink } from "../lib/location";
import { errorMessage, formatDate } from "../lib/format";
import { usePolling } from "../lib/usePolling";
import "./JobPage.css";

type Props = { jobId: number; user: any; onBack: () => void };

// The API sends UTC timestamps without a zone; mark them as UTC before showing local times.
const asDate = (value: string) => new Date(value.endsWith("Z") ? value : `${value}Z`);
const timeOf = (value: string) => asDate(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const dayOf = (value: string) => formatDate(asDate(value).toISOString());
const stamp = (value: string) => `${dayOf(value)}, ${timeOf(value)}`;

function duration(hours: number) {
  const minutes = Math.round(hours * 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

function clock(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const HISTORY_TEXT: Record<string, (event: any) => string> = {
  created: () => "created the job",
  assigned: (e) => e.note?.replace(/^Assigned to/, "assigned it to") ?? "assigned the job",
  unassigned: () => "removed the mechanic",
  status: (e) => `moved it from ${e.from_status} to ${e.to_status}`,
  updated: (e) => e.note?.replace(/^Changed/, "changed") ?? "edited the job",
  time_added: (e) => `added time (${e.note?.replace(/^Added /, "")})`,
  time_corrected: () => "corrected a time entry",
  part_added: (e) => `added part ${e.note}`,
  part_removed: (e) => `removed part ${e.note}`,
  checked: (e) => `ticked "${e.note}"`,
  unchecked: (e) => `unticked "${e.note}"`,
  note: () => "added a note",
  file_added: (e) => (e.note || "added a file").replace(/^Added/, "added"),
  file_removed: (e) => (e.note || "removed a file").replace(/^Removed/, "removed"),
  signed: (e) => `recorded the customer's signature (${(e.note || "").replace(/^Signed by /, "")})`,
  not_signed: (e) => `completed without a signature: ${e.note}`,
};

export default function JobPage({ jobId, user, onBack }: Props) {
  const [job, setJob] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState("");

  const load = () =>
    jobDetail(jobId)
      .then((data) => setJob(data.job))
      .catch((e) => setError(errorMessage(e)));
  usePolling(load, 30000);

  useEffect(() => {
    if (!job?.timer_running) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, [job?.timer_running]);

  // Every change returns the fresh worksheet; failures show at the top instead of disappearing.
  const run = async (change: () => Promise<any>) => {
    setError("");
    setBusy(true);
    try {
      const data = await change();
      if (data?.job?.entries !== undefined || data?.job?.parts !== undefined) setJob(data.job);
      else await load();
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
        {error ? <div className="error">{error}</div> : <p className="muted">Loading job…</p>}
      </main>
    );
  }

  const isMechanic = user.role === "mechanic";
  const canEdit = Boolean(job.can_edit);
  const isCustomer = user.role === "customer";
  const doneCount = job.checklist.filter((item: any) => item.done).length;
  const running = (job.entries || []).find((entry: any) => entry.running);
  const closedSeconds = (job.entries || [])
    .filter((entry: any) => !entry.running)
    .reduce((sum: number, entry: any) => sum + entry.hours * 3600, 0);
  const liveSeconds = closedSeconds + (running ? Math.max(0, (now - asDate(running.started_at).getTime()) / 1000) : 0);
  const setStatus = (status: string) => run(() => changeJobStatus(job.id, status, user.role));
  // Completing asks for the customer's sign-off first; it is sent with the completion.
  const complete = async (signOff: SignOff) => {
    setSignError("");
    setBusy(true);
    try {
      await changeJobStatus(job.id, "Completed", user.role, signOff);
      setSigning(false);
      await load();
    } catch (e) {
      setSignError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={`jobPage status-${job.status.replace(/ /g, "").toLowerCase()}`}>
      <BackButton onBack={onBack} />

      <section className="jobHero" aria-label="Job summary">
        <div className="jobHeroTop">
          <span className="eyebrow">
            {[job.job_type || "General job", `${job.priority} priority`].join(" · ")}
          </span>
          <span className={`jobStatusPill ${job.status.replace(/ /g, "").toLowerCase()}`}>{job.status}</span>
        </div>
        <h1>{job.title}</h1>
        <p className="jobDescription">{job.description}</p>
        <dl className="jobMeta">
          {job.customer && <Meta label="Customer" value={job.customer.name} />}
          {job.machine && <Meta label="Machine" value={`${job.machine.name} · ${job.machine.serial_no}`} />}
          <Meta label="Site" value={job.location || "Not set"} icon={<MapPin size={13} />} />
          <Meta label="Due" value={formatDate(job.due_date) || "Not set"} />
          {!isMechanic && <Meta label="Mechanic" value={job.mechanic?.name || "Not assigned"} />}
        </dl>

        {!isCustomer && (
          <div className="jobTimer" aria-live="polite">
            <Clock size={18} />
            <div>
              <strong data-testid="total-time">{clock(liveSeconds)}</strong>
              <span>{running ? "Timer running" : "Total time on this job"}</span>
            </div>
            {running && <i className="pulseDot" aria-hidden="true" />}
          </div>
        )}

        {isMechanic && canEdit && (
          <div className="jobActions">
            {job.status === "Assigned" && (
              <>
                <button className="primary" disabled={busy} onClick={() => setStatus("In Progress")}>
                  <Play size={16} /> Start work
                </button>
                <button className="secondary" disabled={busy} onClick={() => setStatus("Accepted")}>
                  Accept for later
                </button>
              </>
            )}
            {job.status === "Accepted" && (
              <button className="primary" disabled={busy} onClick={() => setStatus("In Progress")}>
                <Play size={16} /> Start work
              </button>
            )}
            {job.status === "Paused" && (
              <button className="primary" disabled={busy} onClick={() => setStatus("In Progress")}>
                <Play size={16} /> Resume
              </button>
            )}
            {job.status === "In Progress" && (
              <>
                <button
                  className="primary"
                  disabled={busy || job.completion_blockers.length > 0}
                  onClick={() => {
                    setSignError("");
                    setSigning(true);
                  }}
                >
                  <CheckCircle2 size={16} /> Complete job
                </button>
                <button className="secondary" disabled={busy} onClick={() => setStatus("Paused")}>
                  <Pause size={16} /> Pause
                </button>
              </>
            )}
          </div>
        )}
        {job.report_url && <ReportActions job={job} onError={setError} />}
      </section>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {isMechanic && job.status === "In Progress" && job.completion_blockers.length > 0 && (
        <div className="jobBlockers" role="status">
          <strong>Before you can complete this job</strong>
          <ul>
            {job.completion_blockers.map((blocker: string) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="jobGrid">
        {isCustomer ? (
          <Card title="Work done" icon={<Wrench size={16} />}>
            {job.work_done.length ? (
              <ul className="workDoneList">
                {job.work_done.map((line: string, index: number) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            ) : (
              <Empty text="Work notes will appear here once the mechanic starts." />
            )}
          </Card>
        ) : (
          <Card title="Time & work" icon={<Clock size={16} />} badge={`${job.entries.length} ${job.entries.length === 1 ? "entry" : "entries"}`}>
            {job.entries.length === 0 && (
              <Empty text={canEdit ? "Press Start work to begin timing this job." : "No time recorded yet."} />
            )}
            <ol className="entryList">
              {job.entries.map((entry: any) => (
                <EntryRow key={entry.id} entry={entry} canEdit={canEdit} onSave={(data: any) => run(() => updateEntry(job.id, entry.id, data))} />
              ))}
            </ol>
            {canEdit && <ManualEntry busy={busy} location={job.location} onAdd={(data: any) => run(() => addEntry(job.id, data))} />}
          </Card>
        )}

        <Card
          title="Checklist"
          icon={<ClipboardCheck size={16} />}
          badge={job.checklist.length ? `${doneCount}/${job.checklist.length}` : undefined}
        >
          {job.checklist.length === 0 ? (
            <Empty
              text={
                job.job_type
                  ? "The checklist appears when work starts."
                  : "This job has no job type, so it has no checklist."
              }
            />
          ) : (
            <>
              <div className="checkProgress" aria-hidden="true">
                <i style={{ width: `${(doneCount / job.checklist.length) * 100}%` }} />
              </div>
              <ul className="checklist">
                {job.checklist.map((item: any) => (
                  <li key={item.id} className={item.done ? "done" : ""}>
                    <label>
                      <input
                        type="checkbox"
                        checked={item.done}
                        disabled={!canEdit || busy}
                        onChange={(event) => run(() => updateChecklistItem(job.id, item.id, { done: event.target.checked }))}
                      />
                      <span className="checkBox" aria-hidden="true">
                        <CheckCircle2 size={14} />
                      </span>
                      <span className="checkLabel">
                        {item.label}
                        {item.required && <em>Required</em>}
                        {item.done && item.done_by && !isCustomer && (
                          <small>
                            {item.done_by} · {stamp(item.done_at)}
                          </small>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        <Card title="Parts used" icon={<Package size={16} />} badge={job.parts.length ? String(job.parts.length) : undefined}>
          {job.parts.length === 0 && <Empty text="No parts recorded." />}
          <ul className="partList">
            {job.parts.map((part: any) => (
              <li key={part.id}>
                <span className="partQty">×{part.label}</span>
                <span className="partName">{part.name}</span>
                {canEdit && (
                  <button
                    className="iconButton partRemove"
                    title="Remove part"
                    aria-label={`Remove ${part.name}`}
                    disabled={busy}
                    onClick={() => run(() => removePart(job.id, part.id))}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {canEdit && <PartForm busy={busy} onAdd={(data: any) => run(() => addPart(job.id, data))} />}
        </Card>

        <Card title="Service summary" icon={<FileText size={16} />}>
          {!job.machine ? (
            <Empty text="This job has no machine, so there is no service record for the customer." />
          ) : canEdit ? (
            <RecordForm record={job.record} busy={busy} onSave={(data: any) => run(() => saveRecord(job.id, data))} />
          ) : job.record ? (
            <dl className="recordView">
              <Meta label="Service" value={job.record.service_type} />
              <Meta label="Problem" value={job.record.problem || "—"} />
              <Meta label="Solution" value={job.record.solution || "—"} />
              <Meta label="Advice" value={job.record.advice || "—"} />
            </dl>
          ) : (
            <Empty text="The summary for the customer is written when the job is completed." />
          )}
        </Card>

        <MediaCard job={job} busy={busy} run={run} />

        {job.signature && (
          <Card title="Customer sign-off" icon={<PenLine size={16} />}>
            {job.signature.not_signed_reason ? (
              <p className="signOffNote">Not signed: {job.signature.not_signed_reason}</p>
            ) : (
              <div className="signOffView">
                {job.signature.url && <img src={apiUrl(job.signature.url)} alt={`Signature of ${job.signature.name}`} />}
                <span>
                  Signed by <b>{job.signature.name}</b> · {stamp(job.signature.signed_at)}
                </span>
              </div>
            )}
          </Card>
        )}

        {!isCustomer && job.locations?.length > 0 && (
          <Card title="Locations" icon={<MapPin size={16} />} wide>
            <ul className="stampList">
              {job.locations.map((point: any, index: number) => (
                <li key={index}>
                  <strong>{STAMP_TEXT[point.kind] || point.kind}</strong>
                  <span>{stamp(point.recorded_at)}</span>
                  {point.latitude != null ? (
                    <a href={mapLink(point.latitude, point.longitude)} target="_blank" rel="noreferrer">
                      <MapPin size={12} /> View on map{point.accuracy_m ? ` (±${point.accuracy_m} m)` : ""}
                    </a>
                  ) : (
                    <em>Location not shared ({MISSING_TEXT[point.missing_reason] || "no position"})</em>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {!isCustomer && (
          <Card title="History" icon={<History size={16} />} wide>
            <ol className="timeline">
              {job.history.map((event: any) => (
                <li key={event.id} className={`timeline-${event.action}`}>
                  <span className="timelineDot" aria-hidden="true" />
                  <div>
                    <p>
                      <strong>{event.user || "System"}</strong> {(HISTORY_TEXT[event.action] || (() => event.action))(event)}
                    </p>
                    {event.action === "note" && <blockquote>{event.note}</blockquote>}
                    <small>{stamp(event.created_at)}</small>
                  </div>
                </li>
              ))}
            </ol>
            <NoteForm busy={busy} onAdd={(note: string) => run(() => addNote(job.id, note))} />
          </Card>
        )}
      </div>
      {signing && (
        <SignatureModal jobTitle={job.title} busy={busy} error={signError} onSubmit={complete} onClose={() => setSigning(false)} />
      )}
    </main>
  );
}

const STAMP_TEXT: Record<string, string> = { job_start: "Started or resumed work", job_complete: "Completed the job" };
const MISSING_TEXT: Record<string, string> = {
  denied: "location blocked",
  unavailable: "no GPS",
  timeout: "timed out",
  unsupported: "not supported",
  not_sent: "not sent",
};

const KIND_LABEL: Record<string, string> = { before: "Before", after: "After", other: "Photo", video: "Video" };

function MediaCard({ job, busy, run }: any) {
  const [uploading, setUploading] = useState("");
  const [problem, setProblem] = useState("");
  const photos = job.files.filter((file: any) => file.kind !== "video");
  const videos = job.files.filter((file: any) => file.kind === "video");
  const canUpload = Boolean(job.can_upload);
  if (!canUpload && job.files.length === 0) {
    const finished = job.status === "Completed" || job.status === "Cancelled";
    return (
      <Card title="Photos & videos" icon={<Camera size={16} />}>
        <Empty text={finished ? "No photos or videos were added." : "Photos and videos can be added once work starts."} />
      </Card>
    );
  }
  const pick = async (kind: string, input: HTMLInputElement) => {
    const files = Array.from(input.files || []);
    input.value = "";
    if (!files.length) return;
    setProblem("");
    for (const [index, file] of files.entries()) {
      setUploading(files.length > 1 ? `Uploading ${index + 1} of ${files.length}…` : "Uploading…");
      try {
        const updated = await uploadMedia(job.id, kind, file, job.media_limits);
        await run(async () => ({ job: updated }));
      } catch (e) {
        setProblem(errorMessage(e));
        break;
      }
    }
    setUploading("");
  };
  const remove = (file: any) => run(() => deleteFile(file.id));
  return (
    <Card title="Photos & videos" icon={<Camera size={16} />} badge={job.files.length ? String(job.files.length) : undefined} wide>
      {problem && <div className="error">{problem}</div>}
      {photos.length > 0 && (
        <ul className="mediaGrid">
          {photos.map((file: any) => (
            <li key={file.id}>
              <a href={apiUrl(file.url)} target="_blank" rel="noreferrer">
                <img src={apiUrl(file.url)} alt={`${KIND_LABEL[file.kind]} photo`} loading="lazy" />
              </a>
              <span className={`mediaTag ${file.kind}`}>{KIND_LABEL[file.kind]}</span>
              {canUpload && (
                <button className="iconButton mediaRemove" title="Remove photo" aria-label="Remove photo" disabled={busy} onClick={() => remove(file)}>
                  <Trash2 size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {videos.length > 0 && (
        <ul className="mediaVideos">
          {videos.map((file: any) => (
            <li key={file.id}>
              <video src={apiUrl(file.url)} controls preload="metadata" playsInline />
              {canUpload && (
                <button className="iconButton mediaRemove" title="Remove video" aria-label="Remove video" disabled={busy} onClick={() => remove(file)}>
                  <Trash2 size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canUpload && (
        <div className="mediaActions">
          {uploading ? (
            <span className="mediaUploading" role="status">
              {uploading}
            </span>
          ) : (
            <div className="mediaButtons">
              {(["before", "after", "other"] as const).map((kind) => (
                <label key={kind} className="secondary mediaPick">
                  <Camera size={15} /> {kind === "other" ? "Other photo" : `${KIND_LABEL[kind]} photo`}
                  <input type="file" accept="image/*" multiple onChange={(e) => pick(kind, e.currentTarget)} />
                </label>
              ))}
              <label className="secondary mediaPick">
                <Film size={15} /> Video
                <input type="file" accept="video/*" onChange={(e) => pick("video", e.currentTarget)} />
              </label>
            </div>
          )}
          <small className="muted">
            Photos are shrunk on your phone before they upload. Videos: up to {job.media_limits.video_seconds} seconds and{" "}
            {job.media_limits.video_mb} MB.
          </small>
        </div>
      )}
    </Card>
  );
}

function ReportActions({ job, onError }: { job: any; onError: (message: string) => void }) {
  const [working, setWorking] = useState(false);
  const fileName = `job-${job.id}-report.pdf`;
  // The phone's share sheet (WhatsApp, email...) when it can share files; otherwise a download.
  const share = async () => {
    setWorking(true);
    try {
      const file = new File([await downloadReport(job.report_url)], fileName, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `${job.title} service report` }).catch(() => {});
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
        <Share2 size={16} /> {working ? "Preparing…" : "Share report"}
      </button>
      <a className="secondary" href={apiUrl(`${job.report_url}?download=1`)} download={fileName}>
        <Download size={16} /> Download PDF
      </a>
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button className="link jobBack" onClick={onBack}>
      <ArrowLeft size={15} /> Back
    </button>
  );
}

function Meta({ label, value, icon }: { label: string; value: string; icon?: any }) {
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

function Card({ title, icon, badge, wide, children }: any) {
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

function EntryRow({ entry, canEdit, onSave }: any) {
  const [work, setWork] = useState(entry.work_done || "");
  useEffect(() => setWork(entry.work_done || ""), [entry.work_done]);
  const changed = work.trim() !== (entry.work_done || "").trim();
  return (
    <li className={entry.running ? "running" : ""}>
      <div className="entryTop">
        <strong>{dayOf(entry.started_at)}</strong>
        <span>
          {timeOf(entry.started_at)} – {entry.running ? "now" : timeOf(entry.ended_at)}
        </span>
        <em>{entry.running ? "Running" : duration(entry.hours)}</em>
      </div>
      {entry.site && (
        <small className="entrySite">
          <MapPin size={11} /> {entry.site}
        </small>
      )}
      {canEdit ? (
        <div className="entryWork">
          <label htmlFor={`work-${entry.id}`}>Work done</label>
          <textarea
            id={`work-${entry.id}`}
            value={work}
            placeholder="What did you do on this visit?"
            onChange={(event) => setWork(event.target.value)}
          />
          {changed && (
            <button className="secondary" onClick={() => onSave({ work_done: work })}>
              Save notes
            </button>
          )}
        </div>
      ) : (
        <p className="entryNotes">{entry.work_done || <span className="muted">No notes for this visit.</span>}</p>
      )}
    </li>
  );
}

// datetime-local gives local time; the API wants an exact moment.
const toIso = (local: string) => (local ? new Date(local).toISOString() : "");

function ManualEntry({ onAdd, busy, location }: any) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button className="link addLink" onClick={() => setOpen(true)}>
        <Plus size={14} /> Add time manually
      </button>
    );
  }
  return (
    <form
      className="inlineForm"
      onSubmit={async (event: any) => {
        event.preventDefault();
        const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
        await onAdd({ ...form, started_at: toIso(form.started_at), ended_at: toIso(form.ended_at) });
        setOpen(false);
      }}
    >
      <div className="inlineRow">
        <label>
          Start
          <input name="started_at" type="datetime-local" required />
        </label>
        <label>
          End
          <input name="ended_at" type="datetime-local" required />
        </label>
      </div>
      <label>
        Site
        <input name="site" defaultValue={location || ""} />
      </label>
      <label>
        Work done
        <textarea name="work_done" placeholder="What did you do?" />
      </label>
      <div className="inlineRow">
        <button className="primary" disabled={busy}>
          Add time
        </button>
        <button type="button" className="secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function PartForm({ onAdd, busy }: any) {
  return (
    <form
      className="inlineForm partForm"
      onSubmit={async (event: any) => {
        event.preventDefault();
        const formElement = event.currentTarget;
        await onAdd(Object.fromEntries(new FormData(formElement)));
        formElement.reset();
      }}
    >
      <label className="grow">
        Part
        <input name="name" placeholder="e.g. Oil filter" required />
      </label>
      <label className="qty">
        Qty
        <input name="quantity" type="number" min="0.01" step="any" defaultValue="1" required />
      </label>
      <button className="primary" disabled={busy}>
        <Plus size={15} /> Add
      </button>
    </form>
  );
}

function RecordForm({ record, onSave, busy }: any) {
  return (
    <form
      className="inlineForm"
      onSubmit={(event: any) => {
        event.preventDefault();
        onSave(Object.fromEntries(new FormData(event.currentTarget)));
      }}
    >
      <p className="muted">Shown to the customer in their service history. Work done and parts are added automatically.</p>
      <label>
        Problem found
        <textarea name="problem" defaultValue={record?.problem || ""} />
      </label>
      <label>
        Solution
        <textarea name="solution" defaultValue={record?.solution || ""} />
      </label>
      <label>
        Advice for the customer
        <textarea name="advice" defaultValue={record?.advice || ""} />
      </label>
      <button className="secondary" disabled={busy}>
        Save summary
      </button>
    </form>
  );
}

function NoteForm({ onAdd, busy }: any) {
  return (
    <form
      className="inlineForm noteForm"
      onSubmit={async (event: any) => {
        event.preventDefault();
        const formElement = event.currentTarget;
        const note = String(new FormData(formElement).get("note") || "").trim();
        if (!note) return;
        await onAdd(note);
        formElement.reset();
      }}
    >
      <label className="grow">
        Add a note to the history
        <input name="note" placeholder="e.g. Customer asked us to call before arriving" />
      </label>
      <button className="secondary" disabled={busy}>
        Add note
      </button>
    </form>
  );
}
