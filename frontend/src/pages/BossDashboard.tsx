import { useState } from "react";
import { Ban, Pencil, Plus, ClipboardList, Wrench, Trash2, CheckCircle2 } from "lucide-react";
import {
  customers,
  jobs,
  machines,
  mechanics,
  checklists,
  requests,
  updateJob,
  deleteJob,
  updateRequest,
} from "../services/api";
import Notifications from "../components/Notifications";
import Modal from "../components/Modal";
import MechanicProfile from "../components/MechanicProfile";
import { CreateJobModal, JobTypeSelect } from "../components/JobForms";
import InviteForm from "../components/InviteForm";
import { errorMessage, formatDate, greeting } from "../lib/format";
import { usePolling } from "../lib/usePolling";
import { PlanBanner } from "./BillingPage";
type Props = { u: any; onOpenJob: (id: number) => void; onOpenCustomer: (id: number) => void; onOpenBilling?: () => void };

export default function BossDashboard({ u, onOpenJob, onOpenCustomer, onOpenBilling = () => {} }: Props) {
  const [data, setData] = useState<any[]>([]),
    [cs, setCs] = useState<any[]>([]),
    [ms, setMs] = useState<any[]>([]),
    [rs, setRs] = useState<any[]>([]),
    [machineList, setMachineList] = useState<any[]>([]),
    [modal, setModalState] = useState(""),
    [formError, setFormError] = useState(""),
    [notice, setNotice] = useState(""),
    [editingJob, setEditingJob] = useState<any>(null),
    [jobTypes, setJobTypes] = useState<string[]>([]),
    [selectedMechanic, setSelectedMechanic] = useState(null);
  const load = () =>
    Promise.all([jobs(), customers(), mechanics(), requests(), machines(), checklists()])
      .then(([j, c, m, r, mc, cl]) => {
        setData(j.jobs);
        setCs(c.customers);
        setMs(m.mechanics);
        setRs(r.requests);
        setMachineList(mc.machines);
        setJobTypes(cl.checklists.map((template: any) => template.job_type));
      })
      .catch(() => {});
  usePolling(load, 30000);
  const setModal = (name: string) => {
    setFormError("");
    setModalState(name);
  };
  // Runs a change, reloads, and reports failures instead of failing silently.
  const act = async (change: () => Promise<unknown>) => {
    setNotice("");
    try {
      await change();
    } catch (error) {
      setNotice(errorMessage(error));
    }
    load();
  };
  const changeRequestStatus = (id: number, status: string) => act(() => updateRequest(id, { status }));
  const activeRequestCount = rs.filter((x) => !["Completed", "Cancelled"].includes(x.status)).length;
  return (
    <>
      <Header u={u} />
      <main className="page">
        <PlanBanner onOpenBilling={onOpenBilling} />
        <div className="welcome">
          <div>
            <h1>{greeting()}, {u.name.split(" ")[0]}.</h1>
            <p>Here's what's happening across your service team.</p>
          </div>
          <button className="primary" onClick={() => setModal("job")}>
            <Plus size={17} /> Create Job
          </button>
        </div>
        {notice && (
          <div className="error" role="alert">
            {notice}
          </div>
        )}
        <div className="stats">
          <Stat icon={<ClipboardList />} n={data.length} t="Total jobs" />
          <Stat icon={<ClipboardList />} n={activeRequestCount} t="Pending requests" />
          <Stat icon={<Wrench />} n={data.filter((x) => ["In Progress", "Paused"].includes(x.status)).length} t="In progress" />
          <Stat icon={<CheckCircle2 />} n={data.filter((x) => x.status === "Completed").length} t="Completed jobs" />
        </div>
        <div className="grid2">
          <Panel
            title="Active jobs"
            action={
              <button className="link" onClick={() => setModal("job")}>
                + New job
              </button>
            }
          >
            {data.slice(0, 8).map((j) => (
              <Job
                key={j.id}
                j={j}
                mechanics={ms}
                onAssign={(id: number, mechanic_id: number) => act(() => updateJob(id, { mechanic_id }))}
                onDelete={(id: number) => act(() => deleteJob(id))}
                onCancel={(id: number) => act(() => updateJob(id, { status: "Cancelled" }))}
                onEdit={(job: any) => {
                  setFormError("");
                  setEditingJob(job);
                }}
                onOpen={onOpenJob}
              />
            ))}
          </Panel>
          <Panel
            title="Customer requests"
            action={
              <span className="pill">
                {activeRequestCount} open
              </span>
            }
          >
            {rs.slice(0, 6).map((r) => (
              <div className="request" key={r.id}>
                <div>
                  <b>{r.subject}</b>
                  <span>{r.description}</span>
                </div>
                <div className="requestActions">
                  <span className="priority">{r.priority}</span>
                  <select
                    aria-label={`Status for ${r.subject}`}
                    value={r.status}
                    onChange={(e) => changeRequestStatus(r.id, e.target.value)}
                  >
                    {["Submitted", "Received", "Reviewing", "Approved", "Mechanic Assigned", "Scheduled", "In Progress", "Completed", "Cancelled"].map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </Panel>
        </div>
        <div className="panel">
          <div className="panelHead">
            <h2>Customers</h2>
            <button className="primary-sm" onClick={() => setModal("invite")}>
              <Plus size={14} /> Add customer
            </button>
          </div>
          <div className="customerGrid">
            {[...cs]
              .sort((a, b) => Number(b.needs_work_count > 0) - Number(a.needs_work_count > 0))
              .map((c) => (
                <button
                  key={c.id}
                  className={`customer-card ${c.needs_work_count ? "needsWork" : ""}`}
                  onClick={() => onOpenCustomer(c.id)}
                  style={{ border: "none", background: "none", cursor: "pointer" }}
                >
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
          <Panel title="Upcoming jobs" action={<span className="pill">{data.filter((job) => job.status !== "Completed" && job.status !== "Cancelled").length}</span>}>
            {data.filter((job) => job.status !== "Completed" && job.status !== "Cancelled").slice(0, 5).map((job) => <div className="request" key={job.id}><div><button className="titleLink" onClick={() => onOpenJob(job.id)}><b>{job.title}</b></button><span>{job.location || "Location not set"} · {formatDate(job.due_date) || "Date not set"}</span></div><span className="status">{job.status}</span></div>)}
          </Panel>
          <Panel title="Team overview" action={<button className="link" onClick={() => setModal("addmech")}>+ Add mechanic</button>}>
            {ms.length === 0 ? <p className="muted">No mechanics added yet.</p> : ms.map((mechanic) => <button key={mechanic.id} className="customer" onClick={() => setSelectedMechanic(mechanic)} style={{ border: "none", background: "none", cursor: "pointer", width: "100%", textAlign: "left" }}><div className="avatar">{mechanic.name[0]}</div><div><b>{mechanic.name}</b><span>{mechanic.email}</span></div><strong>{data.filter((job) => job.mechanic_id === mechanic.id && !["Completed", "Cancelled"].includes(job.status)).length} active</strong></button>)}
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
        <Modal title="Edit job" onClose={() => setEditingJob(null)}>
          <form
            className="form"
            onSubmit={async (e: any) => {
              e.preventDefault();
              setFormError("");
              try {
                await updateJob(editingJob.id, Object.fromEntries(new FormData(e.currentTarget)));
                setEditingJob(null);
                load();
              } catch (error) {
                setFormError(errorMessage(error));
              }
            }}
          >
            {formError && <div className="error">{formError}</div>}
            <input name="title" defaultValue={editingJob.title} placeholder="Job title" required />
            <textarea name="description" defaultValue={editingJob.description} placeholder="Problem / job description" required />
            <div className="row">
              <select name="priority" defaultValue={editingJob.priority}>
                <option>Low</option>
                <option>Medium</option>
                <option>High</option>
                <option>Urgent</option>
              </select>
              <input name="location" defaultValue={editingJob.location || ""} placeholder="Job site" />
            </div>
            <div className="row">
              <select name="machine_id" defaultValue={editingJob.machine_id || ""} aria-label="Machine">
                <option value="">No machine</option>
                {machineList
                  .filter((m) => !editingJob.customer_id || m.customer_id === editingJob.customer_id)
                  .map((m) => (
                    <option key={m.id} value={m.id}>{m.name} ({m.serial_no})</option>
                  ))}
              </select>
              <input name="due_date" type="date" defaultValue={editingJob.due_date || ""} aria-label="Due date" title="Due date" />
            </div>
            <JobTypeSelect types={jobTypes} value={editingJob.job_type} />
            <button className="primary">Save changes</button>
          </form>
        </Modal>
      )}
      {modal === "invite" && <InviteForm role="customer" onClose={() => setModal("")} />}
      {modal === "addmech" && <InviteForm role="mechanic" onClose={() => setModal("")} />}
      {selectedMechanic && (
        <MechanicProfile mechanic={selectedMechanic} onClose={() => setSelectedMechanic(null)} />
      )}
    </>
  );
}
function Header({ u }: { u: any }) {
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
function Stat({ icon, n, t }: any) {
  return (
    <div className="stat">
      <div className="statIcon">{icon}</div>
      <div>
        <b>{n}</b>
        <span>{t}</span>
      </div>
    </div>
  );
}
function Panel({ title, action, children }: any) {
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
export function machineSummary(customer: any) {
  const machines = `${customer.machine_count ?? 0} machine${customer.machine_count === 1 ? "" : "s"}`;
  return customer.needs_work_count ? `${machines} · ${customer.needs_work_count} need${customer.needs_work_count === 1 ? "s" : ""} work` : machines;
}
// Jobs that have not started can be deleted; any unfinished job can be cancelled.
const DELETABLE = ["Pending", "Assigned"];
const CANCELLABLE = ["Pending", "Assigned", "Accepted", "In Progress", "Paused"];
function Job({ j, mechanics, onAssign, onDelete, onCancel, onEdit, onOpen }: any) {
  return (
    <div className="job">
      <div className="jobMain">
        <div className="jobTitle">
          <button className="titleLink" onClick={() => onOpen(j.id)}>
            <b>{j.title}</b>
          </button>
          <span
            className={`status ${j.status.replaceAll(" ", "").toLowerCase()}`}
          >
            {j.status}
          </span>
        </div>
        <p>{j.description}</p>
        <small>
          📍 {j.location || "No location"} · Due {formatDate(j.due_date) || "Not set"}
        </small>
      </div>
      <select
        value={j.mechanic_id || ""}
        onChange={(e) =>
          e.target.value && onAssign(j.id, Number(e.target.value))
        }
      >
        <option value="">Assign</option>
        {mechanics.map((m: any) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
      {CANCELLABLE.includes(j.status) && (
        <button className="iconButton" title="Edit job" aria-label={`Edit ${j.title}`} onClick={() => onEdit(j)}>
          <Pencil size={15} />
        </button>
      )}
      {CANCELLABLE.includes(j.status) && (
        <button
          className="iconButton"
          title="Cancel job"
          aria-label={`Cancel ${j.title}`}
          onClick={() => {
            if (confirm("Cancel this job? The assigned mechanic will be notified.")) onCancel(j.id);
          }}
        >
          <Ban size={15} />
        </button>
      )}
      {DELETABLE.includes(j.status) && (
        <button
          className="iconButton"
          title="Delete job"
          aria-label={`Delete ${j.title}`}
          onClick={() => {
            if (confirm("Delete this job?")) onDelete(j.id);
          }}
        >
          <Trash2 size={15} />
        </button>
      )}
    </div>
  );
}
