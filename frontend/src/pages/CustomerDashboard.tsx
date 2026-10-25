import { useEffect, useState, type FormEvent } from "react";
import { CalendarClock, CheckCircle2, ClipboardList, MessageSquare, Plus, Star, Wrench } from "lucide-react";
import { bookableServices, createRequest, createReview, jobs, machines, requests, reviews, services, type User } from "../services/api";
import Notifications from "../components/Notifications";
import Modal from "../components/Modal";
import { toast } from "../components/Feedback";
import { errorMessage, formatMinutes, formatVisit } from "../lib/format";
import { PRIORITIES, statusClass } from "../lib/labels";
import { usePolling } from "../lib/usePolling";
import { mark, t } from "../i18n";
import Field from "../components/Field";
import type { BookableService, Job, Machine, Review, ServiceRecord, ServiceRequest } from "../services/types";

// The request form, or the review form for one service visit.
type ModalState = null | "request" | ServiceRecord;

const FINISHED = ["Completed", "Cancelled", "Declined"];
const RATINGS: [number, string][] = [
  [5, mark("Excellent")],
  [4, mark("Very good")],
  [3, mark("Good")],
  [2, mark("Needs improvement")],
  [1, mark("Poor")],
];

type Props = { u: User; onOpenJob: (id: number) => void; onOpenRequest: (id: number) => void; onOpenMachine: (id: number) => void; onOpenMessages: () => void };

export default function CustomerDashboard({ u, onOpenJob, onOpenRequest, onOpenMachine, onOpenMessages }: Props) {
  const [jobList, setJobList] = useState<Job[]>([]);
  const [equipment, setEquipment] = useState<Machine[]>([]);
  const [records, setRecords] = useState<ServiceRecord[]>([]);
  const [reviewList, setReviewList] = useState<Review[]>([]);
  const [requestList, setRequestList] = useState<ServiceRequest[]>([]);
  const [modal, setModalState] = useState<ModalState>(null);
  const [formError, setFormError] = useState("");
  const load = () =>
    Promise.all([jobs(), machines(), services(), reviews(), requests()])
      .then(([a, b, c, d, e]) => {
        setJobList(a.jobs);
        setEquipment(b.machines);
        setRecords(c.records);
        setReviewList(d.reviews);
        setRequestList(e.requests);
      })
      .catch(() => {});
  usePolling(load, 60000);
  const setModal = (value: ModalState) => {
    setFormError("");
    setModalState(value);
  };
  const submit = (send: (data: Record<string, FormDataEntryValue>) => Promise<unknown>, done: string) => async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError("");
    try {
      await send(Object.fromEntries(new FormData(e.currentTarget)));
      setModal(null);
      toast(done);
      load();
    } catch (error) {
      setFormError(errorMessage(error));
    }
  };
  // A new request opens its page, to pick a time for the inspection (or the service itself).
  const requestSent = (id: number, direct: boolean) => {
    setModal(null);
    toast(direct ? t("Request sent. Now pick a time for the service.") : t("Request sent. Now pick a time for the inspection."));
    onOpenRequest(id);
  };
  const openJobs = jobList.filter((x) => !FINISHED.includes(x.status));
  const activeRequests = requestList.filter((x) => !FINISHED.includes(x.status));
  return (
    <>
      <Header u={u} />
      <main className="page">
        <div className="welcome">
          <div>
            <h1>{t("Welcome, {name}.", { name: u.name.split(" ")[0] })}</h1>
            <p>{t("Everything about your equipment and service history in one place.")}</p>
          </div>
          <div className="welcomeActions">
            <button className="secondary" onClick={onOpenMessages}>
              <MessageSquare size={16} /> {t("Message us")}
            </button>
            <button className="primary" onClick={() => setModal("request")}>
              <Plus size={17} /> {t("Request service")}
            </button>
          </div>
        </div>
        <div className="stats">
          <div className="stat">
            <Wrench />
            <div>
              <b>{equipment.length}</b>
              <span>{t("Equipment")}</span>
            </div>
          </div>
          <div className="stat">
            <ClipboardList />
            <div>
              <b>{activeRequests.length}</b>
              <span>{t("Active requests")}</span>
            </div>
          </div>
          <div className="stat">
            <CheckCircle2 />
            <div>
              <b>{records.length}</b>
              <span>{t("Service visits")}</span>
            </div>
          </div>
          <div className="stat">
            <Wrench />
            <div>
              <b>{openJobs.length}</b>
              <span>{t("Open jobs")}</span>
            </div>
          </div>
          <div className="stat">
            <Star />
            <div>
              <b>{reviewList.length}</b>
              <span>{t("Your reviews")}</span>
            </div>
          </div>
        </div>
        <section className="panel">
          <div className="panelHead">
            <h2>{t("Your equipment")}</h2>
          </div>
          {equipment.map((x) => (
            <div className="machine" key={x.id}>
              <div>
                <button className="titleLink" onClick={() => onOpenMachine(x.id)}>
                  <b>{x.name}</b>
                </button>
                <span>{t("{model} · Serial {serial}", { model: x.model || t("Model not recorded"), serial: x.serial_no })}</span>
              </div>
              <span className={`machineStatus ${statusClass(x.status)}`}>{t(x.status)}</span>
            </div>
          ))}
        </section>
        <div className="grid2">
          <section className="panel">
            <div className="panelHead">
              <h2>{t("Active requests")}</h2>
              <span className="pill">{t("{count} open", { count: activeRequests.length })}</span>
            </div>
            {activeRequests.length === 0 ? (
              <p className="muted">{t("No active service requests.")}</p>
            ) : (
              activeRequests.slice(0, 5).map((request) => (
                <div className="request" key={request.id}>
                  <div>
                    <button className="titleLink" onClick={() => onOpenRequest(request.id)}>
                      <b>{request.subject}</b>
                    </button>
                    <span>
                      {t(request.status)} · {request.description}
                    </span>
                  </div>
                  <span className="priority" data-level={statusClass(request.priority)}>{t(request.priority)}</span>
                </div>
              ))
            )}
          </section>
          <section className="panel">
            <div className="panelHead">
              <h2>{t("Upcoming services")}</h2>
            </div>
            {openJobs.slice(0, 5).map((job) => (
              <div className="request" key={job.id}>
                <div>
                  <button className="titleLink" onClick={() => (job.request_id ? onOpenRequest(job.request_id) : onOpenJob(job.id))}>
                    <b>{job.title}</b>
                  </button>
                  <span>
                    {job.scheduled_start ? (
                      <>
                        <CalendarClock size={12} /> {formatVisit(job.scheduled_start, job.scheduled_end)}
                      </>
                    ) : (
                      job.location || t("Site not set")
                    )}
                  </span>
                </div>
                <span className={`status ${statusClass(job.status)}`}>{t(job.status)}</span>
              </div>
            ))}
            {openJobs.length === 0 && <p className="muted">{t("No upcoming services.")}</p>}
          </section>
        </div>
        <section className="panel">
          <div className="panelHead">
            <h2>{t("Service history")}</h2>
          </div>
          {records.length === 0 ? (
            <p className="muted">{t("No service history yet.")}</p>
          ) : (
            records.map((x) => (
              <div className="record" key={x.id}>
                <div>
                  {x.job_id ? (
                    <button className="titleLink" onClick={() => x.job_id && onOpenJob(x.job_id)}>
                      <b>{x.service_type}</b>
                    </button>
                  ) : (
                    <b>{x.service_type}</b>
                  )}
                  <span>{x.work_done}</span>
                </div>
                <div>
                  <small>{t("Parts: {value}", { value: x.parts_replaced || t("None") })}</small>
                  <small>{t("Solution: {value}", { value: x.solution || t("Not recorded") })}</small>
                  <small>{t("Advice: {value}", { value: x.advice || t("None") })}</small>
                  {!reviewList.some((z) => z.service_record_id === x.id) && (
                    <button className="link" onClick={() => setModal(x)}>
                      {t("Leave review")}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </section>
      </main>
      {modal === "request" && (
        <Modal title={t("Request a service")} onClose={() => setModal(null)}>
          <RequestForm equipment={equipment} onSent={requestSent} />
        </Modal>
      )}
      {modal && modal !== "request" && (
        <Modal title={t("Review service")} onClose={() => setModal(null)}>
          <form className="form" onSubmit={submit(createReview, t("Thanks for your review"))}>
            {formError && <div className="error">{formError}</div>}
            <input type="hidden" name="service_record_id" value={modal.id} />
            <Field label={t("Rating")}>
              <select name="rating">
                {RATINGS.map(([stars, label]) => (
                  <option key={stars} value={stars}>
                    {"★".repeat(stars)} {t(label)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("Tell us about the service")} optional>
              <textarea name="comment" placeholder={t("Tell us about the service")} />
            </Field>
            <Field label={t("Advice for the technician or company")} optional>
              <textarea name="advice" placeholder={t("Advice for the technician or company")} />
            </Field>
            <button className="primary">{t("Submit review")}</button>
          </form>
        </Modal>
      )}
    </>
  );
}

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
        <button className="avatarBtn" aria-label={u.name}>
          {u.name[0]}
        </button>
      </div>
    </header>
  );
}

/** A new request: the equipment, then one of the services the company lets customers book for it
 *  (booked directly, or after an inspection), or something else, described in their own words. */
function RequestForm({ equipment, onSent }: { equipment: Machine[]; onSent: (id: number, direct: boolean) => void }) {
  const [machineId, setMachineId] = useState("");
  const [offered, setOffered] = useState<BookableService[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    setServiceId("");
    if (!machineId) {
      setOffered([]);
      return;
    }
    let current = true;
    bookableServices(Number(machineId))
      .then((data) => current && setOffered(data.services))
      .catch(() => current && setOffered([]));
    return () => {
      current = false;
    };
  }, [machineId]);
  const chosen = offered.find((service) => String(service.id) === serviceId);

  const send = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    try {
      const { id } = await createRequest(Object.fromEntries(new FormData(e.currentTarget)));
      onSent(id, chosen?.booking === "direct");
    } catch (problem) {
      setError(errorMessage(problem));
    }
  };

  return (
    <form className="form" onSubmit={send}>
      {error && <div className="error">{error}</div>}
      {equipment.length === 0 && <p className="muted">{t("No equipment is registered to your account yet. Ask your service company to add it.")}</p>}
      <Field label={t("Equipment")}>
        <select name="machine_id" required value={machineId} onChange={(e) => setMachineId(e.target.value)}>
          <option value="">{t("Select equipment")}</option>
          {equipment.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </Field>
      {offered.length > 0 && (
        <fieldset className="choiceCards">
          <legend>{t("Pick a service")}</legend>
          {offered.map((service) => (
            <label key={service.id} className={chosen?.id === service.id ? "chosen" : ""}>
              <input type="radio" name="service_id" value={service.id} checked={chosen?.id === service.id} onChange={() => setServiceId(String(service.id))} />
              <span>
                <b>{service.name}</b>
                {service.description && <small>{service.description}</small>}
                <small>
                  {service.booking === "direct"
                    ? t("About {time}. You pick a time for the work.", { time: formatMinutes(service.duration_minutes) })
                    : t("A technician inspects it first; then you pick a time for the work (about {time}).", { time: formatMinutes(service.duration_minutes) })}
                </small>
              </span>
            </label>
          ))}
          <label className={chosen ? "" : "chosen"}>
            <input type="radio" name="service_id" value="" checked={!chosen} onChange={() => setServiceId("")} />
            <span>
              <b>{t("Something else")}</b>
              <small>{t("Describe what you need. A technician inspects it first.")}</small>
            </span>
          </label>
        </fieldset>
      )}
      {!chosen && (
        <Field label={t("What do you need?")}>
          <input name="subject" placeholder={t("What do you need?")} required />
        </Field>
      )}
      {chosen ? (
        <Field label={t("Anything we should know?")} optional>
          <textarea name="description" placeholder={t("Where it is, what you've noticed…")} />
        </Field>
      ) : (
        <Field label={t("Describe the issue")}>
          <textarea name="description" placeholder={t("Describe the issue")} required />
        </Field>
      )}
      <Field label={t("Priority")}>
        <select name="priority" defaultValue="Medium">
          {PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {t(priority)}
            </option>
          ))}
        </select>
      </Field>
      <button className="primary">{t("Send request")}</button>
    </form>
  );
}
