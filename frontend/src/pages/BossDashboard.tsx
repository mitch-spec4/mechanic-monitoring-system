import { useEffect, useState } from "react";
import { Plus, Users, ClipboardList, Wrench, Star, Trash2, CheckCircle2 } from "lucide-react";
import {
  customers,
  jobs,
  mechanics,
  createJob,
  invite,
  requests,
  updateJob,
  deleteJob,
} from "../services/api";
import Notifications from "../components/Notifications";
import Modal from "../components/Modal";
export default function BossDashboard({ u }: { u: any }) {
  const [data, setData] = useState<any[]>([]),
    [cs, setCs] = useState<any[]>([]),
    [ms, setMs] = useState<any[]>([]),
    [rs, setRs] = useState<any[]>([]),
    [modal, setModal] = useState("");
  const load = () =>
    Promise.all([jobs(), customers(), mechanics(), requests()]).then(
      ([j, c, m, r]) => {
        setData(j.jobs);
        setCs(c.customers);
        setMs(m.mechanics);
        setRs(r.requests);
      },
    );
  useEffect(() => {
    load();
    const t = setInterval(load, 7000);
    return () => clearInterval(t);
  }, []);
  const submitJob = async (e: any) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await createJob(Object.fromEntries(f));
    setModal("");
    load();
  };
  const submitInvite = async (e: any) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const x = await invite(Object.fromEntries(f));
    alert(`Invitation code: ${x.code}`);
    setModal("");
  };
  return (
    <>
      <Header u={u} />
      <main className="page">
        <div className="welcome">
          <div>
            <h1>Good morning, {u.name.split(" ")[0]}.</h1>
            <p>Here's what's happening across your service team.</p>
          </div>
          <button className="primary" onClick={() => setModal("job")}>
            <Plus size={17} /> Create Job
          </button>
        </div>
        <div className="stats">
          <Stat icon={<ClipboardList />} n={data.length} t="Total jobs" />
          <Stat icon={<ClipboardList />} n={rs.filter((x) => x.status === "Open").length} t="Pending requests" />
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
                onAssign={async (id: number, mechanic_id: number) => {
                  await updateJob(id, { mechanic_id });
                  load();
                }}
              />
            ))}
          </Panel>
          <Panel
            title="Customer requests"
            action={
              <span className="pill">
                {rs.filter((x) => x.status === "Open").length} open
              </span>
            }
          >
            {rs.slice(0, 6).map((r) => (
              <div className="request" key={r.id}>
                <div>
                  <b>{r.subject}</b>
                  <span>{r.description}</span>
                </div>
                <span className="priority">{r.priority}</span>
              </div>
            ))}
          </Panel>
        </div>
        <div className="panel">
          <div className="panelHead">
            <h2>Customers</h2>
            <button className="secondary" onClick={() => setModal("invite")}>
              Invite customer
            </button>
          </div>
          <div className="customerGrid">
            {cs.map((c) => (
              <div className="customer" key={c.id}>
                <div className="avatar">{c.name[0]}</div>
                <div>
                  <b>{c.name}</b>
                  <span>{c.email}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="dashboardGrid bossOverviewGrid">
          <Panel title="Upcoming jobs" action={<span className="pill">{data.filter((job) => job.status !== "Completed" && job.status !== "Cancelled").length}</span>}>
            {data.filter((job) => job.status !== "Completed" && job.status !== "Cancelled").slice(0, 5).map((job) => <div className="request" key={job.id}><div><b>{job.title}</b><span>{job.location || "Location not set"} · {job.due_date || "Date not set"}</span></div><span className="status">{job.status}</span></div>)}
          </Panel>
          <Panel title="Team overview" action={<span className="pill">{ms.length} mechanics</span>}>
            {ms.length === 0 ? <p className="muted">No mechanics added yet.</p> : ms.map((mechanic) => <div className="customer" key={mechanic.id}><div className="avatar">{mechanic.name[0]}</div><div><b>{mechanic.name}</b><span>{mechanic.email}</span></div><strong>{data.filter((job) => job.mechanic_id === mechanic.id && job.status !== "Completed").length} active</strong></div>)}
          </Panel>
        </div>
      </main>
      {modal === "job" && (
        <Modal title="Create service job" onClose={() => setModal("")}>
          <form className="form" onSubmit={submitJob}>
            <input name="title" placeholder="Job title" required />
            <textarea
              name="description"
              placeholder="Problem / job description"
              required
            />
            <div className="row">
              <select name="customer_id">
                <option value="">Customer</option>
                {cs.map((c) => (
                  <option value={c.id}>{c.name}</option>
                ))}
              </select>
              <select name="mechanic_id">
                <option value="">Assign mechanic</option>
                {ms.map((m) => (
                  <option value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
            <div className="row">
              <select name="priority">
                <option>Normal</option>
                <option>High</option>
                <option>Urgent</option>
              </select>
              <input name="location" placeholder="Job site" />
            </div>
            <input name="due_date" placeholder="Due date" />
            <button className="primary">Create & notify mechanic</button>
          </form>
        </Modal>
      )}
      {modal === "invite" && (
        <Modal title="Invite customer" onClose={() => setModal("")}>
          <form className="form" onSubmit={submitInvite}>
            <input name="name" placeholder="Customer/company name" required />
            <input
              name="email"
              type="email"
              placeholder="Email address"
              required
            />
            <button className="primary">Generate invitation</button>
          </form>
        </Modal>
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
function Job({ j, mechanics, onAssign }: any) {
  return (
    <div className="job">
      <div className="jobMain">
        <div className="jobTitle">
          <b>{j.title}</b>
          <span
            className={`status ${j.status.replaceAll(" ", "").toLowerCase()}`}
          >
            {j.status}
          </span>
        </div>
        <p>{j.description}</p>
        <small>
          📍 {j.location || "No location"} · Due {j.due_date || "Not set"}
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
          <option value={m.id}>{m.name}</option>
        ))}
      </select>
      <button
        className="iconButton"
        title="Delete job"
        onClick={async () => {
          if (confirm("Delete this job?")) {
            await deleteJob(j.id);
            location.reload();
          }
        }}
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}
