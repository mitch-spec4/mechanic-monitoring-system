import { useEffect, useState } from "react";
import { Wrench, Plus, Star, ClipboardList } from "lucide-react";
import {
  jobs,
  machines,
  services,
  createRequest,
  createReview,
  reviews,
  requests,
} from "../services/api";
import Notifications from "../components/Notifications";
import Modal from "../components/Modal";
export default function CustomerDashboard({ u }: { u: any }) {
  const [j, setJ] = useState<any[]>([]),
    [m, setM] = useState<any[]>([]),
    [s, setS] = useState<any[]>([]),
    [r, setR] = useState<any[]>([]),
    [q, setQ] = useState<any[]>([]),
    [modal, setModal] = useState<any>(null);
  const load = () =>
    Promise.all([jobs(), machines(), services(), reviews(), requests()]).then(
      ([a, b, c, d, e]) => {
        setJ(a.jobs);
        setM(b.machines);
        setS(c.records);
        setR(d.reviews);
        setQ(e.requests);
      },
    );
  useEffect(() => {
    load();
  }, []);
  const req = async (e: any) => {
    e.preventDefault();
    await createRequest(Object.fromEntries(new FormData(e.currentTarget)));
    setModal(null);
    load();
  };
  const rev = async (e: any) => {
    e.preventDefault();
    await createReview(Object.fromEntries(new FormData(e.currentTarget)));
    setModal(null);
    load();
  };
  return (
    <>
      <Header u={u} />
      <main className="page">
        <div className="welcome">
          <div>
            <h1>Welcome, {u.name.split(" ")[0]}.</h1>
            <p>
              Everything about your machines and service history in one place.
            </p>
          </div>
          <button className="primary" onClick={() => setModal("request")}>
            <Plus size={17} /> Request service
          </button>
        </div>
        <div className="stats">
          <div className="stat">
            <Wrench />
            <div>
              <b>{m.length}</b>
              <span>Machines</span>
            </div>
          </div>
          <div className="stat">
            <ClipboardList />
            <div>
              <b>{q.filter((x) => !["Completed", "Cancelled"].includes(x.status)).length}</b>
              <span>Active requests</span>
            </div>
          </div>
          <div className="stat">
            <div>
              <b>{s.length}</b>
              <span>Service visits</span>
            </div>
          </div>
          <div className="stat">
            <div>
              <b>{j.filter((x) => x.status !== "Completed").length}</b>
              <span>Open jobs</span>
            </div>
          </div>
          <div className="stat">
            <Star />
            <div>
              <b>{r.length ? "★★★★★" : "—"}</b>
              <span>Your reviews</span>
            </div>
          </div>
        </div>
        <section className="panel">
          <div className="panelHead">
            <h2>Your machines</h2>
          </div>
          {m.map((x) => (
            <div className="machine" key={x.id}>
              <div>
                <b>{x.name}</b>
                <span>
                  {x.model} · Serial {x.serial_no}
                </span>
              </div>
              <strong>{x.status}</strong>
            </div>
          ))}
        </section>
        <div className="grid2">
          <section className="panel">
            <div className="panelHead"><h2>Active requests</h2><span className="pill">{q.filter((x) => !["Completed", "Cancelled"].includes(x.status)).length} open</span></div>
            {q.length === 0 ? <p className="muted">No active service requests.</p> : q.slice(0, 5).map((request) => <div className="request" key={request.id}><div><b>{request.subject}</b><span>{request.status} · {request.description}</span></div><span className="priority">{request.priority}</span></div>)}
          </section>
          <section className="panel"><div className="panelHead"><h2>Upcoming services</h2></div>{j.filter((x) => x.status !== "Completed").slice(0, 5).map((job) => <div className="request" key={job.id}><div><b>{job.title}</b><span>{job.location || "Location not set"}</span></div><span className="status">{job.status}</span></div>)}{j.length === 0 && <p className="muted">No upcoming services.</p>}</section>
        </div>
        <section className="panel">
          <div className="panelHead">
            <h2>Service history</h2>
          </div>
          {s.length === 0 ? (
            <p className="muted">No service history yet.</p>
          ) : (
            s.map((x) => (
              <div className="record" key={x.id}>
                <div>
                  <b>{x.service_type}</b>
                  <span>{x.work_done}</span>
                </div>
                <div>
                  <small>Parts: {x.parts_replaced || "None"}</small>
                  <small>Solution: {x.solution || "Not recorded"}</small>
                  <small>Advice: {x.advice || "None"}</small>
                  {!r.some((z) => z.service_record_id === x.id) && (
                    <button className="link" onClick={() => setModal(x)}>
                      Leave review
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </section>
      </main>
      {modal === "request" && (
        <Modal title="Request a service" onClose={() => setModal(null)}>
          <form className="form" onSubmit={req}>
            <select name="machine_id" required>
              <option value="">Select machine</option>
              {m.map((x) => (
                <option value={x.id}>{x.name}</option>
              ))}
            </select>
            <input name="subject" placeholder="What do you need?" required />
            <textarea
              name="description"
              placeholder="Describe the issue"
              required
            />
            <select name="priority">
              <option>Normal</option>
              <option>High</option>
              <option>Urgent</option>
            </select>
            <button className="primary">Send request</button>
          </form>
        </Modal>
      )}
      {modal && modal !== "request" && (
        <Modal title="Review service" onClose={() => setModal(null)}>
          <form className="form" onSubmit={rev}>
            <input type="hidden" name="service_record_id" value={modal.id} />
            <select name="rating">
              <option value="5">★★★★★ Excellent</option>
              <option value="4">★★★★ Very good</option>
              <option value="3">★★★ Good</option>
              <option value="2">★★ Needs improvement</option>
              <option value="1">★ Poor</option>
            </select>
            <textarea name="comment" placeholder="Tell us about the service" />
            <textarea
              name="advice"
              placeholder="Advice for the mechanic/company"
            />
            <button className="primary">Submit review</button>
          </form>
        </Modal>
      )}
    </>
  );
}
function Header({ u }: any) {
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
