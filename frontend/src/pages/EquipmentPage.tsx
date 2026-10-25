import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Award,
  CalendarCheck,
  CalendarClock,
  Camera,
  CheckCircle2,
  ClipboardList,
  Download,
  FileText,
  History,
  MapPin,
  Pencil,
  Plus,
  Repeat,
  Trash2,
  Upload,
  UserRound,
  Wrench,
} from "lucide-react";
import { apiUrl, catalog, createJob, createPlan, createPlanJob, deleteDocument, deleteMachine, deletePlan, machineDetail, updatePlan, uploadDocument, type User } from "../services/api";
import type { CatalogService, EquipmentDetail, MaintenancePlan } from "../services/types";
import { servicesFor } from "../components/JobForms";
import { CertificateList } from "../components/JobFormsCard";
import { can } from "../lib/plan";
import PlanLocked from "../components/PlanLocked";
import { confirmAction, toast } from "../components/Feedback";
import { EditMachine } from "../components/MachineForms";
import Modal from "../components/Modal";
import Field from "../components/Field";
import { Loading } from "../components/States";
import { errorMessage, formatBytes, formatDate, formatDateTime, formatMinutes, toZoneInput } from "../lib/format";
import { statusClass } from "../lib/labels";
import { usePolling } from "../lib/usePolling";
import { mark, t } from "../i18n";
import "./JobPage.css";
import "./CustomerPage.css";
import "./EquipmentPage.css";

type Props = {
  machineId: number;
  user: User;
  onBack: () => void;
  onOpenJob: (id: number) => void;
  onOpenCustomer?: (id: number) => void;
};

const PLAN_STATES: Record<MaintenancePlan["state"], string> = {
  scheduled: mark("Scheduled"),
  due: mark("Due soon"),
  overdue: mark("Overdue"),
  paused: mark("Paused"),
};
// Documents the server takes (see DOCUMENT_TYPES in backend/app/routes/equipment.py).
const DOCUMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.txt,.doc,.docx,.xls,.xlsx";

/** How often a plan repeats: "Every month", "Every 3 months". */
function every(plan: Pick<MaintenancePlan, "every" | "unit">) {
  const count = plan.every;
  if (plan.unit === "days") return count === 1 ? t("Every day") : t("Every {count} days", { count });
  if (plan.unit === "weeks") return count === 1 ? t("Every week") : t("Every {count} weeks", { count });
  return count === 1 ? t("Every month") : t("Every {count} months", { count });
}

const today = () => toZoneInput(new Date()).slice(0, 10);

/**
 * One piece of equipment and everything about it: its details and site, the maintenance it's due,
 * its manuals and certificates, the faults it has had, every job on it, and its photos.
 */
export default function EquipmentPage({ machineId, user, onBack, onOpenJob, onOpenCustomer }: Props) {
  const [machine, setMachine] = useState<EquipmentDetail | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const load = () =>
    machineDetail(machineId)
      .then((data) => {
        setMachine(data.machine);
        setError("");
      })
      .catch((problem) => setError(errorMessage(problem)));
  usePolling(load, 30000, true);
  // Only equipment with no service history can go; the API says why not (Retired keeps its history).
  const remove = async () => {
    if (!machine) return;
    const ok = await confirmAction({
      title: t("Delete {name}?", { name: machine.name }),
      message: t("Its documents and maintenance plans are deleted too. Equipment with service history can't be deleted: mark it Retired instead."),
      confirmLabel: t("Delete equipment"),
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteMachine(machine.id);
      toast(t("{name} was deleted", { name: machine.name }));
      onBack();
    } catch (problem) {
      toast(errorMessage(problem), "error");
    }
  };

  if (!machine) {
    return (
      <main className="jobPage equipmentPage">
        <BackButton onBack={onBack} />
        {error ? <div className="error">{error}</div> : <Loading label={t("Loading equipment…")} />}
      </main>
    );
  }

  const makeAndModel = [machine.manufacturer, machine.model].filter(Boolean).join(" · ");
  const openable = new Set(machine.jobs.filter((job) => job.can_open).map((job) => job.id));
  return (
    <main className="jobPage equipmentPage">
      <BackButton onBack={onBack} />
      <section className="jobHero" aria-label={t("Equipment summary")}>
        <div className="jobHeroTop">
          <span className="eyebrow">{machine.equipment_type || t("Equipment")}</span>
          <span className={`machineStatus ${statusClass(machine.status)}`}>{t(machine.status)}</span>
        </div>
        <h1>{machine.name}</h1>
        {machine.notes && <p className="jobDescription">{machine.notes}</p>}
        <dl className="jobMeta">
          {machine.customer && user.role !== "customer" && (
            <div>
              <dt>{t("Customer")}</dt>
              <dd>
                <UserRound size={13} />{" "}
                {onOpenCustomer ? (
                  <button className="titleLink" onClick={() => onOpenCustomer(machine.customer!.id)}>
                    {machine.customer.name}
                  </button>
                ) : (
                  machine.customer.name
                )}
              </dd>
            </div>
          )}
          <div>
            <dt>{t("Make and model")}</dt>
            <dd>{makeAndModel || t("Not recorded")}</dd>
          </div>
          <div>
            <dt>{t("Serial number")}</dt>
            <dd>{machine.serial_no}</dd>
          </div>
          <div>
            <dt>{t("Site")}</dt>
            <dd>
              {machine.site ? (
                <>
                  <MapPin size={13} /> {machine.site.address ? `${machine.site.name}, ${machine.site.address}` : machine.site.name}
                </>
              ) : (
                t("Not set")
              )}
            </dd>
          </div>
          <div>
            <dt>{t("Installed")}</dt>
            <dd>{machine.installed_on ? formatDate(machine.installed_on) : t("Not recorded")}</dd>
          </div>
        </dl>
        {machine.can_edit && (
          <div className="equipmentActions">
            <button className="secondary equipmentEdit" onClick={() => setEditing(true)}>
              <Pencil size={14} /> {t("Edit details")}
            </button>
            <button className="listAction danger" onClick={() => void remove()}>
              <Trash2 size={14} /> {t("Delete")}
            </button>
          </div>
        )}
      </section>

      {machine.repeat_fault && (
        <p className="repeatFaultBanner" role="status">
          <Repeat size={16} />
          <span>
            <strong>{t("Repeat fault: {count} in 90 days", { count: machine.repeat_fault.count })}</strong>{" "}
            {t("The same equipment keeps needing repairs. It may be worth finding the cause, or replacing a part.")}
          </span>
        </p>
      )}

      <div className="jobGrid">
        {(machine.can_edit || machine.plans.length > 0) && <PlansCard machine={machine} user={user} onChanged={setMachine} onOpenJob={onOpenJob} openable={openable} />}
        {machine.can_edit && <ServiceShortcuts machine={machine} onOpenJob={onOpenJob} />}
        <DocumentsCard machine={machine} user={user} onChanged={setMachine} />
        {machine.certificates.length > 0 && (
          <section className="jobCard" aria-labelledby="equipment-certificates">
            <div className="jobCardHead">
              <h2 id="equipment-certificates">
                <Award size={16} /> {user.role === "customer" ? t("Certificates") : t("Forms and certificates")}
              </h2>
              <span className="jobBadge">{machine.certificates.length}</span>
            </div>
            <CertificateList
              items={machine.certificates.map((item) => ({ key: `${item.job_id}-${item.form_id}`, name: item.name, detail: item.job_title, date: item.completed_at, url: item.pdf_url }))}
            />
          </section>
        )}
        {machine.faults.length > 0 && (
          <section className="jobCard">
            <div className="jobCardHead">
              <h2>
                <AlertTriangle size={16} /> {t("Faults")}
              </h2>
              <span className="jobBadge">{machine.faults.length}</span>
            </div>
            <ul className="faultList">
              {machine.faults.map((fault) => (
                <li key={fault.record_id}>
                  <span className="historyDate">{formatDate(fault.date)}</span>
                  <div>
                    <strong>{fault.problem}</strong>
                    {fault.solution && <span>{t("Fixed: {solution}", { solution: fault.solution })}</span>}
                    {fault.job_id && openable.has(fault.job_id) && (
                      <button className="link" onClick={() => onOpenJob(fault.job_id!)}>
                        <ClipboardList size={13} /> {t("See the job")}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="jobCard wide">
          <div className="jobCardHead">
            <h2>
              <ClipboardList size={16} /> {t("Jobs")}
            </h2>
            <span className="jobBadge">{machine.jobs.length}</span>
          </div>
          {machine.jobs.length === 0 ? (
            <p className="muted jobEmpty">{t("No jobs on this equipment yet.")}</p>
          ) : (
            <ul className="equipmentJobs">
              {machine.jobs.map((job) => (
                <li key={job.id}>
                  <div>
                    {job.can_open ? (
                      <button className="titleLink" onClick={() => onOpenJob(job.id)}>
                        <strong>{job.title}</strong>
                      </button>
                    ) : (
                      <strong>{job.title}</strong>
                    )}
                    <small>
                      {[
                        job.scheduled_start ? formatDateTime(job.scheduled_start) : job.due_date ? t("Due {date}", { date: formatDate(job.due_date) }) : formatDate(job.created_at),
                        job.mechanic,
                        job.plan_id ? t("Planned maintenance") : job.job_type,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </div>
                  <span className={`jobStatusPill ${statusClass(job.status)}`}>{t(job.status)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        {machine.photos.length > 0 && (
          <section className="jobCard wide">
            <div className="jobCardHead">
              <h2>
                <Camera size={16} /> {t("Photos from jobs")}
              </h2>
              <span className="jobBadge">{machine.photos.length}</span>
            </div>
            <ul className="mediaGrid">
              {machine.photos
                .filter((photo) => photo.content_type.startsWith("image/"))
                .map((photo) => (
                  <li key={photo.id}>
                    <a href={apiUrl(photo.url)} target="_blank" rel="noreferrer">
                      <img src={apiUrl(photo.url)} alt={t("Photo from a job on {name}", { name: machine.name })} loading="lazy" />
                    </a>
                  </li>
                ))}
            </ul>
            {machine.photos.some((photo) => !photo.content_type.startsWith("image/")) && <p className="muted jobEmpty">{t("Videos are on the job's page.")}</p>}
          </section>
        )}
        <section className="jobCard wide">
          <div className="jobCardHead">
            <h2>
              <History size={16} /> {t("Service history")}
            </h2>
            <span className="jobBadge">{machine.records.length}</span>
          </div>
          {machine.records.length === 0 ? (
            <p className="muted jobEmpty">{t("No service records yet.")}</p>
          ) : (
            <ul className="historyList">
              {machine.records.map((record) => (
                <li key={record.id}>
                  <span className="historyDate">{formatDate(record.service_date)}</span>
                  <div>
                    {record.job_id && openable.has(record.job_id) ? (
                      <button className="titleLink" onClick={() => onOpenJob(record.job_id!)}>
                        <strong>{record.service_type}</strong>
                      </button>
                    ) : (
                      <strong>{record.service_type}</strong>
                    )}
                    <span>{record.work_done || record.problem || t("No summary recorded")}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {editing && (
        <EditMachine
          machine={machine}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void load();
          }}
        />
      )}
    </main>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button className="link jobBack" onClick={onBack}>
      <ArrowLeft size={15} /> {t("Back")}
    </button>
  );
}

type PlansProps = {
  machine: EquipmentDetail;
  user: User;
  onChanged: (machine: EquipmentDetail) => void;
  onOpenJob: (id: number) => void;
  openable: Set<number>;
};

/** Service it needs on a schedule. The daily run creates each job ahead of its due date; a manager can create it early. */
function PlansCard({ machine, user, onChanged, onOpenJob, openable }: PlansProps) {
  // On plans without planned maintenance, plans made before stay listed, paused.
  const editable = machine.can_edit && can(user, "maintenance");
  const [editing, setEditing] = useState<MaintenancePlan | "new" | null>(null);
  const [doneFor, setDoneFor] = useState<MaintenancePlan | null>(null);
  const [busy, setBusy] = useState(false);
  const jobNow = async (plan: MaintenancePlan) => {
    setBusy(true);
    try {
      onChanged((await createPlanJob(plan.id)).machine);
      toast(t("Job created. Assign it from Jobs."));
    } catch (problem) {
      toast(errorMessage(problem), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="jobCard wide">
      <div className="jobCardHead">
        <h2>
          <CalendarClock size={16} /> {t("Maintenance plan")}
        </h2>
        {editable && (
          <button className="primary-sm" onClick={() => setEditing("new")}>
            <Plus size={14} /> {t("Add plan")}
          </button>
        )}
      </div>
      {machine.can_edit && !editable && <PlanLocked feature="maintenance" user={user} compact />}
      {machine.plans.length === 0 ? (
        editable && <p className="muted jobEmpty">{t("No planned maintenance. Add a plan, and its job is created ahead of each due date.")}</p>
      ) : (
        <ul className="planList">
          {machine.plans.map((plan) => (
            <li key={plan.id} className={`planRow ${plan.state}`}>
              <div className="planHead">
                <div>
                  <strong>{plan.title}</strong>
                  <small>
                    {every(plan)}
                    {plan.job_type ? ` · ${plan.job_type}` : ""}
                  </small>
                </div>
                <span className={`planState ${plan.state}`}>{t(PLAN_STATES[plan.state])}</span>
              </div>
              <dl className="planDates">
                <div>
                  <dt>{t("Next due")}</dt>
                  <dd>{formatDate(plan.next_due)}</dd>
                </div>
                <div>
                  <dt>{t("Last done")}</dt>
                  <dd>{plan.last_done ? formatDate(plan.last_done) : t("Not yet")}</dd>
                </div>
              </dl>
              {plan.open_job_id && (
                <p className="planJob">
                  <ClipboardList size={13} />{" "}
                  {openable.has(plan.open_job_id) ? (
                    <button className="titleLink" onClick={() => onOpenJob(plan.open_job_id!)}>
                      {t("Its job is open")}
                    </button>
                  ) : (
                    t("Its job is open")
                  )}
                </p>
              )}
              {editable && (
                <div className="machineCardActions">
                  {!plan.open_job_id && plan.active && (
                    <button className="listAction" disabled={busy} onClick={() => jobNow(plan)}>
                      <Plus size={12} /> {t("Create the job now")}
                    </button>
                  )}
                  <button className="listAction" onClick={() => setDoneFor(plan)}>
                    <CheckCircle2 size={12} /> {t("Mark done")}
                  </button>
                  <button className="listAction" onClick={() => setEditing(plan)}>
                    <Pencil size={12} /> {t("Edit")}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <PlanForm
          machine={machine}
          plan={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(changed) => {
            setEditing(null);
            onChanged(changed);
          }}
        />
      )}
      {doneFor && (
        <MarkDone
          plan={doneFor}
          onClose={() => setDoneFor(null)}
          onSaved={(changed) => {
            setDoneFor(null);
            onChanged(changed);
          }}
        />
      )}
    </section>
  );
}

type PlanFormProps = { machine: EquipmentDetail; plan: MaintenancePlan | null; onClose: () => void; onSaved: (machine: EquipmentDetail) => void };

function PlanForm({ machine, plan, onClose, onSaved }: PlanFormProps) {
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const data = {
      title: String(form.get("title") ?? ""),
      job_type: String(form.get("job_type") ?? ""),
      every: Number(form.get("every")),
      unit: String(form.get("unit")),
      next_due: String(form.get("next_due") ?? ""),
      lead_days: Number(form.get("lead_days")),
      ...(plan ? { active: form.get("active") === "on" } : {}),
    };
    setBusy(true);
    setFormError("");
    try {
      const saved = plan ? await updatePlan(plan.id, data) : await createPlan(machine.id, data);
      toast(plan ? t("Plan saved") : t("Plan added"));
      onSaved(saved.machine);
    } catch (problem) {
      setFormError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!plan) return;
    const ok = await confirmAction({
      title: t("Remove {title}?", { title: plan.title }),
      message: t("Jobs it created stay, as ordinary jobs."),
      confirmLabel: t("Remove plan"),
      cancelLabel: t("Keep it"),
      danger: true,
    });
    if (!ok) return;
    try {
      onSaved((await deletePlan(plan.id)).machine);
      toast(t("Plan removed"));
    } catch (problem) {
      setFormError(errorMessage(problem));
    }
  };
  return (
    <Modal title={plan ? t("Edit plan") : t("Add maintenance plan")} icon={<CalendarClock size={20} />} onClose={onClose}>
      <form className="form form-upgraded planForm" onSubmit={submit}>
        {formError && <div className="error">{formError}</div>}
        <Field label={t("What's done")}>
          <input id="field-plan-title" name="title" defaultValue={plan?.title ?? ""} placeholder={t("e.g. {example}", { example: t("Oil and filter change") })} maxLength={150} required />
        </Field>
        <Field label={t("Job type")} optional>
          <input id="field-plan-job_type" name="job_type" defaultValue={plan?.job_type ?? t("Maintenance")} maxLength={80} />
        </Field>
        <div className="row">
          <Field label={t("Repeats every")}>
            <input id="field-plan-every" name="every" type="number" min={1} max={1000} defaultValue={plan?.every ?? 3} required />
          </Field>
          <Field label={t("Unit")}>
            <select id="field-plan-unit" name="unit" defaultValue={plan?.unit ?? "months"}>
              <option value="days">{t("days")}</option>
              <option value="weeks">{t("weeks")}</option>
              <option value="months">{t("months")}</option>
            </select>
          </Field>
        </div>
        <div className="row">
          <Field label={t("Next due")}>
            <input id="field-plan-next_due" name="next_due" type="date" defaultValue={plan?.next_due ?? today()} required />
          </Field>
          <Field label={t("Create the job")} hint={t("Days before the due date")}>
            <input id="field-plan-lead_days" name="lead_days" type="number" min={0} max={90} defaultValue={plan?.lead_days ?? 7} required />
          </Field>
        </div>
        {plan && (
          <label className="checkRow">
            <input type="checkbox" name="active" defaultChecked={plan.active} /> {t("Active (switch off to pause the plan)")}
          </label>
        )}
        <button className="primary" disabled={busy}>
          {plan ? t("Save changes") : t("Add plan")}
        </button>
        {plan && (
          <button type="button" className="link dangerText" onClick={remove}>
            <Trash2 size={14} /> {t("Remove plan")}
          </button>
        )}
      </form>
    </Modal>
  );
}

/** Done without a job in the app (or before the app): the next due date moves on from that day. */
function MarkDone({ plan, onClose, onSaved }: { plan: MaintenancePlan; onClose: () => void; onSaved: (machine: EquipmentDetail) => void }) {
  const [formError, setFormError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      onSaved((await updatePlan(plan.id, { done_on: String(new FormData(event.currentTarget).get("done_on")) })).machine);
      toast(t("Marked done"));
    } catch (problem) {
      setFormError(errorMessage(problem));
    }
  };
  return (
    <Modal title={t("Mark {title} done", { title: plan.title })} icon={<CalendarCheck size={20} />} onClose={onClose}>
      <form className="form form-upgraded" onSubmit={submit}>
        {formError && <div className="error">{formError}</div>}
        <Field label={t("Done on")} hint={t("The next due date is counted from this day.")}>
          <input id="field-done_on" name="done_on" type="date" defaultValue={today()} max={today()} required />
        </Field>
        <button className="primary">{t("Mark done")}</button>
      </form>
    </Modal>
  );
}

/** Manuals, certificates, wiring diagrams. Anyone who sees the equipment can read them and add one. */
function DocumentsCard({ machine, user, onChanged }: { machine: EquipmentDetail; user: User; onChanged: (machine: EquipmentDetail) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState("");
  const [problem, setProblem] = useState("");
  const add = async (file: File | undefined) => {
    if (!file) return;
    setProblem("");
    if (file.size > machine.document_mb * 1024 * 1024) {
      setProblem(t("Documents can be at most {size} MB.", { size: machine.document_mb }));
      return;
    }
    setUploading(file.name);
    try {
      onChanged((await uploadDocument(machine.id, file)).machine);
      toast(t("Document added"));
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setUploading("");
      if (input.current) input.current.value = "";
    }
  };
  const remove = async (id: number, name: string) => {
    const ok = await confirmAction({
      title: t("Remove {name}?", { name }),
      message: t("It's deleted for everyone who can see this equipment."),
      confirmLabel: t("Remove document"),
      cancelLabel: t("Keep it"),
      danger: true,
    });
    if (!ok) return;
    try {
      onChanged((await deleteDocument(machine.id, id)).machine);
      toast(t("Document removed"));
    } catch (error) {
      setProblem(errorMessage(error));
    }
  };
  return (
    <section className="jobCard">
      <div className="jobCardHead">
        <h2>
          <FileText size={16} /> {t("Documents")}
        </h2>
        {machine.can_add_documents && (
          <>
            <input
              ref={input}
              type="file"
              accept={DOCUMENT_ACCEPT}
              className="visuallyHidden"
              id="equipment-document"
              aria-label={t("Add document")}
              onChange={(event) => add(event.target.files?.[0])}
            />
            <button className="primary-sm" disabled={Boolean(uploading)} onClick={() => input.current?.click()}>
              <Upload size={14} /> {t("Add document")}
            </button>
          </>
        )}
      </div>
      {problem && <div className="error">{problem}</div>}
      {uploading && (
        <p className="muted jobEmpty" role="status">
          {t("Uploading {name}…", { name: uploading })}
        </p>
      )}
      {machine.documents.length === 0 ? (
        <p className="muted jobEmpty">{t("No documents yet. Keep the manual, certificates and wiring diagrams here (PDF, Word, Excel or photos, up to {size} MB).", { size: machine.document_mb })}</p>
      ) : (
        <ul className="docList">
          {machine.documents.map((doc) => (
            <li key={doc.id}>
              <FileText size={18} aria-hidden="true" />
              <div>
                <a href={apiUrl(doc.url)} target="_blank" rel="noreferrer">
                  {doc.name}
                </a>
                <small>{[formatBytes(doc.size_bytes), doc.uploaded_by, formatDate(doc.created_at)].filter(Boolean).join(" · ")}</small>
              </div>
              <a className="iconButton" href={apiUrl(`${doc.url}?download=1`)} title={t("Download")} aria-label={t("Download {name}", { name: doc.name })}>
                <Download size={14} />
              </a>
              {(user.role === "boss" || doc.uploaded_by_id === user.id) && (
                <button className="iconButton" title={t("Remove document")} aria-label={t("Remove {name}", { name: doc.name })} onClick={() => remove(doc.id, doc.name)}>
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Managers: a job from a service in the catalog, for this equipment, in one tap. */
function ServiceShortcuts({ machine, onOpenJob }: { machine: EquipmentDetail; onOpenJob: (id: number) => void }) {
  const [services, setServices] = useState<CatalogService[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  useEffect(() => {
    catalog()
      .then((data) => setServices(data.services))
      .catch(() => setServices([]));
  }, []);
  const fitting = servicesFor(services, machine);
  if (!fitting.length) return null;
  const start = async (service: CatalogService) => {
    setBusy(service.id);
    try {
      const { job } = await createJob({ service_id: service.id, machine_id: machine.id });
      toast(t("Job created: {title}", { title: job.title }));
      onOpenJob(job.id);
    } catch (problem) {
      toast(errorMessage(problem), "error");
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="jobCard" aria-labelledby="equipment-start-job">
      <div className="jobCardHead">
        <h2 id="equipment-start-job">
          <Wrench size={16} /> {t("Start a job")}
        </h2>
      </div>
      <p className="muted">{t("One tap creates the job from the service, for this equipment. Assign a technician on the job's page.")}</p>
      <div className="serviceShortcuts">
        {fitting.map((service) => (
          <button key={service.id} type="button" className="serviceShortcut" disabled={busy !== null} onClick={() => start(service)}>
            <b>{busy === service.id ? t("Creating…") : service.name}</b>
            <small>
              {[formatMinutes(service.duration_minutes), service.checklist ? t("Checklist: {name}", { name: service.checklist.job_type }) : null].filter(Boolean).join(" · ")}
            </small>
          </button>
        ))}
      </div>
    </section>
  );
}
