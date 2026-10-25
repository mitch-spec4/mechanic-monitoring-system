import { useState, type FormEvent, type ReactNode } from "react";
import { Ban, Pencil, Plus, ClipboardList, Wrench, Trash2, CheckCircle2 } from "lucide-react";
import {
  customers,
  jobsPage,
  machines,
  mechanics,
  checklists,
  openJobs,
  reports,
  requestsPage,
  updateJob,
  deleteJob,
} from "../services/api";
import Notifications from "../components/Notifications";
import Modal from "../components/Modal";
import MechanicProfile from "../components/MechanicProfile";
import { CreateJobModal, JobTypeSelect } from "../components/JobForms";
import InviteForm from "../components/InviteForm";
import SetupGuide, { type SetupStep } from "../components/SetupGuide";
import VerifyBanner from "../components/VerifyBanner";
import { AddMachine } from "../components/MachineForms";
import { confirmAction, toast } from "../components/Feedback";
import { errorMessage, formatDate, greeting } from "../lib/format";
import { usePolling } from "../lib/usePolling";
import { PRIORITIES, statusClass } from "../lib/labels";
import type { User } from "../services/api";
import type { CustomerSummary, Job, Machine, Mechanic, Report, ServiceRequest } from "../services/types";
import { t } from "../i18n";
import Field from "../components/Field";

type Props = {
  u: User;
  onOpenJob: (id: number) => void;
  onOpenCustomer: (id: number) => void;
  onOpenRequest?: (id: number) => void;
  onUserChanged?: (user: User) => void;
};

export default function BossDashboard({ u, onOpenJob, onOpenCustomer, onOpenRequest = () => {}, onUserChanged = () => {} }: Props) {
  // The newest jobs, the unfinished ones and the counts: never every job the company ever had,
  // which only grows and is asked for again every 30 seconds.
  const [data, setData] = useState<Job[]>([]);
  const [upcoming, setUpcoming] = useState<Job[]>([]);
  const [counts, setCounts] = useState<Report | null>(null);
  const [cs, setCs] = useState<CustomerSummary[]>([]);
  const [ms, setMs] = useState<Mechanic[]>([]);
  const [rs, setRs] = useState<ServiceRequest[]>([]);
  const [machineList, setMachineList] = useState<Machine[]>([]);
  const [modal, setModalState] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [jobTypes, setJobTypes] = useState<string[]>([]);
  const [selectedMechanic, setSelectedMechanic] = useState<Mechanic | null>(null);
  const load = () =>
    Promise.all([jobsPage(1), openJobs(), reports(), customers(), mechanics(), requestsPage(1), machines(), checklists()])
      .then(([j, open, report, c, m, r, mc, cl]) => {
        setData(j.jobs);
        setUpcoming(open.jobs);
        setCounts(report);
        setCs(c.customers);
        setMs(m.mechanics);
        setRs(r.requests);
        setMachineList(mc.machines);
        setJobTypes(cl.checklists.map((template) => template.job_type));
      })
      .catch(() => {});
  usePolling(load, 30000);
  const setModal = (name: string) => {
    setFormError("");
    setModalState(name);
  };
  // Runs a change, reloads, and reports failures instead of failing silently.
  const act = async (change: () => Promise<unknown>, done?: string) => {
    setNotice("");
    try {
      await change();
      if (done) toast(done);
    } catch (error) {
      setNotice(errorMessage(error));
    }
    load();
  };
  const activeRequestCount = counts?.totals.open_requests ?? 0;
  return (
    <>
      <Header u={u} />
      <main className="page">
        {u.email_verified === false && <VerifyBanner user={u} onVerified={onUserChanged} />}
        <SetupGuide onAction={(step: SetupStep) => setModal(SETUP_MODALS[step])} />
        <div className="welcome">
          <div>
            <h1>{t("{greeting}, {name}.", { greeting: greeting(), name: u.name.split(" ")[0] })}</h1>
            <p>{t("Here's what's happening across your service team.")}</p>
          </div>
          <button className="primary" onClick={() => setModal("job")}>
            <Plus size={17} /> {t("Create job")}
          </button>
        </div>
        {notice && (
          <div className="error" role="alert">
            {notice}
          </div>
        )}
        <div className="stats">
          <Stat icon={<ClipboardList />} n={counts?.jobs.total ?? 0} label={t("Total jobs")} />
          <Stat icon={<ClipboardList />} n={activeRequestCount} label={t("Pending requests")} />
          <Stat icon={<Wrench />} n={counts?.jobs.in_progress ?? 0} label={t("In progress")} />
          <Stat icon={<CheckCircle2 />} n={counts?.jobs.completed ?? 0} label={t("Completed jobs")} />
        </div>
        <div className="grid2">
          <Panel
            title={t("Active jobs")}
            action={
              <button className="link" onClick={() => setModal("job")}>
                + {t("New job")}
              </button>
            }
          >
            {data.slice(0, 8).map((j) => (
              <JobRow
                key={j.id}
                j={j}
                mechanics={ms}
                onAssign={(id, mechanic_id) => act(() => updateJob(id, { mechanic_id }), t("Technician assigned"))}
                onDelete={(id) => act(() => deleteJob(id), t("Job deleted"))}
                onCancel={(id) => act(() => updateJob(id, { status: "Cancelled" }), t("Job cancelled"))}
                onEdit={(job) => {
                  setFormError("");
                  setEditingJob(job);
                }}
                onOpen={onOpenJob}
              />
            ))}
          </Panel>
          <Panel
            title={t("Customer requests")}
            action={<span className="pill">{t("{count} open", { count: activeRequestCount })}</span>}
          >
            {rs.slice(0, 6).map((r) => (
              <div className="request" key={r.id}>
                <div>
                  <button className="titleLink" onClick={() => onOpenRequest(r.id)}>
                    <b>{r.subject}</b>
                  </button>
                  <span>{r.description}</span>
                </div>
                <div className="requestActions">
                  <span className="priority" data-level={statusClass(r.priority)}>{t(r.priority)}</span>
                  <span className={`status ${statusClass(r.status)}`}>{t(r.status)}</span>
                </div>
              </div>
            ))}
            {rs.length === 0 && <p className="muted">{t("No customer requests yet.")}</p>}
          </Panel>
        </div>
        <div className="panel">
          <div className="panelHead">
            <h2>{t("Customers")}</h2>
            <button className="primary-sm" onClick={() => setModal("invite")}>
              <Plus size={14} /> {t("Add customer")}
            </button>
          </div>
          <div className="customerGrid">
            {[...cs]
              .sort((a, b) => Number(b.needs_work_count > 0) - Number(a.needs_work_count > 0))
              .map((c) => (
                <button key={c.id} className={`customer-card plainButton ${c.needs_work_count ? "needsWork" : ""}`} onClick={() => onOpenCustomer(c.id)}>
                  <div className="avatar-lg">{c.name[0]}</div>
                  <div className="customer-info">
                    <b>{c.name}</b>
                    <span>{machineSummary(c)}</span>
                  </div>
                </button>
              ))}
          </div>
        </div>
        <div className="dashboardGrid bossOverviewGrid">
          <Panel title={t("Upcoming jobs")} action={<span className="pill">{upcoming.length}</span>}>
            {upcoming.slice(0, 5).map((job) => (
              <div className="request" key={job.id}>
                <div>
                  <button className="titleLink" onClick={() => onOpenJob(job.id)}>
                    <b>{job.title}</b>
                  </button>
                  <span>
                    {job.location || t("Site not set")} · {formatDate(job.due_date) || t("Date not set")}
                  </span>
                </div>
                <span className={`status ${statusClass(job.status)}`}>{t(job.status)}</span>
              </div>
            ))}
          </Panel>
          <Panel
            title={t("Team overview")}
            action={
              <button className="link" onClick={() => setModal("addmech")}>
                + {t("Add technician")}
              </button>
            }
          >
            {ms.length === 0 ? (
              <p className="muted">{t("No technicians added yet.")}</p>
            ) : (
              ms.map((mechanic) => (
                <button key={mechanic.id} className="customer teamMember" onClick={() => setSelectedMechanic(mechanic)}>
                  <div className="avatar">{mechanic.name[0]}</div>
                  <div>
                    <b>{mechanic.name}</b>
                    <span>{mechanic.email}</span>
                  </div>
                  <strong>{t("{count} active", { count: upcoming.filter((job) => job.mechanic_id === mechanic.id).length })}</strong>
                </button>
              ))
            )}
          </Panel>
        </div>
      </main>
      {modal === "job" && (
        <CreateJobModal
          onClose={() => setModal("")}
          onCreated={() => {
            setModal("");
            load();
          }}
        />
      )}
      {editingJob && (
        <Modal title={t("Edit job")} onClose={() => setEditingJob(null)}>
          <form
            className="form"
            onSubmit={async (e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              setFormError("");
              try {
                await updateJob(editingJob.id, Object.fromEntries(new FormData(e.currentTarget)));
                setEditingJob(null);
                toast(t("Job saved"));
                load();
              } catch (error) {
                setFormError(errorMessage(error));
              }
            }}
          >
            {formError && <div className="error">{formError}</div>}
            <Field label={t("Job title")}>
              <input name="title" defaultValue={editingJob.title} placeholder={t("Job title")} required />
            </Field>
            <Field label={t("Problem / job description")}>
              <textarea name="description" defaultValue={editingJob.description} placeholder={t("Problem / job description")} required />
            </Field>
            <div className="row">
              <Field label={t("Priority")}>
                <select name="priority" defaultValue={editingJob.priority}>
                  {PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {t(priority)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("Site")} optional>
                <input name="location" defaultValue={editingJob.location || ""} placeholder={t("Site")} />
              </Field>
            </div>
            <div className="row">
              <Field label={t("Equipment")}>
                <select name="machine_id" defaultValue={editingJob.machine_id || ""}>
                  <option value="">{t("No equipment")}</option>
                  {machineList
                    .filter((m) => !editingJob.customer_id || m.customer_id === editingJob.customer_id)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.serial_no})
                      </option>
                    ))}
                </select>
              </Field>
              <Field label={t("Due date")} optional>
                <input name="due_date" type="date" defaultValue={editingJob.due_date || ""} />
              </Field>
            </div>
            <div className="row">
              <Field label={t("Job type")}>
                <JobTypeSelect types={jobTypes} value={editingJob.job_type} />
              </Field>
              <Field label={t("Estimated time (minutes)")} optional>
                <input name="estimated_minutes" type="number" min={5} max={1440} step={5} defaultValue={editingJob.estimated_minutes ?? ""} />
              </Field>
            </div>
            <button className="primary">{t("Save changes")}</button>
          </form>
        </Modal>
      )}
      {modal === "invite" && <InviteForm role="customer" onClose={() => setModal("")} />}
      {modal === "machine" && (
        <AddMachine
          onClose={() => setModal("")}
          onAdded={() => {
            setModal("");
            load();
          }}
        />
      )}
      {modal === "addmech" && <InviteForm role="mechanic" onClose={() => setModal("")} />}
      {selectedMechanic && (
        <MechanicProfile mechanic={selectedMechanic} onClose={() => setSelectedMechanic(null)} />
      )}
    </>
  );
}
// Which dialog each "Get set up" step opens.
const SETUP_MODALS: Record<SetupStep, string> = { verify: "", customer: "invite", machine: "machine", mechanic: "addmech", job: "job" };
function Header({ u }: { u: User }) {
  return (
    <header>
      <div className="logo">
        🔧{" "}
        <b>
          MECHANIC<span>PRO</span>
        </b>
      </div>
      <div className="headerRight">
        <Notifications />
        <button className="avatarBtn">{u.name[0]}</button>
      </div>
    </header>
  );
}
function Stat({ icon, n, label }: { icon: ReactNode; n: number; label: string }) {
  return (
    <div className="stat">
      <div className="statIcon">{icon}</div>
      <div>
        <b>{n}</b>
        <span>{label}</span>
      </div>
    </div>
  );
}
function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel">
      <div className="panelHead">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
export function machineSummary(customer: { machine_count?: number; needs_work_count?: number }) {
  const count = customer.machine_count ?? 0;
  const pieces = count === 1 ? t("1 piece of equipment") : t("{count} pieces of equipment", { count });
  const needing = customer.needs_work_count ?? 0;
  if (!needing) return pieces;
  return `${pieces} · ${needing === 1 ? t("1 needs work") : t("{count} need work", { count: needing })}`;
}
// Jobs that have not started can be deleted; any unfinished job can be cancelled.
const DELETABLE = ["Pending", "Assigned"];
const CANCELLABLE = ["Pending", "Assigned", "Accepted", "In Progress", "Paused"];
type JobProps = {
  j: Job;
  mechanics: Mechanic[];
  onAssign: (id: number, mechanicId: number) => void;
  onDelete: (id: number) => void;
  onCancel: (id: number) => void;
  onEdit: (job: Job) => void;
  onOpen: (id: number) => void;
};

function JobRow({ j, mechanics, onAssign, onDelete, onCancel, onEdit, onOpen }: JobProps) {
  return (
    <div className="job">
      <div className="jobMain">
        <div className="jobTitle">
          <button className="titleLink" onClick={() => onOpen(j.id)}>
            <b>{j.title}</b>
          </button>
          <span className={`status ${statusClass(j.status)}`}>{t(j.status)}</span>
        </div>
        <p>{j.description}</p>
        <small>
          📍 {j.location || t("No site")} · {t("Due {date}", { date: formatDate(j.due_date) || t("Not set") })}
        </small>
      </div>
      <select
        value={j.mechanic_id || ""}
        aria-label={t("Technician for {title}", { title: j.title })}
        onChange={(e) => e.target.value && onAssign(j.id, Number(e.target.value))}
      >
        <option value="">{t("Assign")}</option>
        {mechanics.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      {CANCELLABLE.includes(j.status) && (
        <button className="iconButton edit" title={t("Edit job")} aria-label={t("Edit {title}", { title: j.title })} onClick={() => onEdit(j)}>
          <Pencil size={15} />
        </button>
      )}
      {CANCELLABLE.includes(j.status) && (
        <button
          className="iconButton cancel"
          title={t("Cancel job")}
          aria-label={t("Cancel {title}", { title: j.title })}
          onClick={async () => {
            const ok = await confirmAction({
              title: t("Cancel this job?"),
              message: t("The assigned technician will be notified."),
              confirmLabel: t("Cancel job"),
              danger: true,
            });
            if (ok) onCancel(j.id);
          }}
        >
          <Ban size={15} />
        </button>
      )}
      {DELETABLE.includes(j.status) && (
        <button
          className="iconButton delete"
          title={t("Delete job")}
          aria-label={t("Delete {title}", { title: j.title })}
          onClick={async () => {
            const ok = await confirmAction({ title: t("Delete this job?"), message: t("This can't be undone."), confirmLabel: t("Delete job"), danger: true });
            if (ok) onDelete(j.id);
          }}
        >
          <Trash2 size={15} />
        </button>
      )}
    </div>
  );
}
