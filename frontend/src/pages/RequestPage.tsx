import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Ban,
  CalendarClock,
  CalendarCheck,
  Camera,
  Check,
  ClipboardList,
  MessageSquare,
  Search,
  Truck,
  UserRound,
  Wrench,
} from "lucide-react";
import { apiUrl, bookVisit, cancelRequest, requestDetail, requestSlots, updateRequest, type User } from "../services/api";
import type { RequestDetail, RequestVisit, Slot, Visit } from "../services/types";
import { confirmAction, toast } from "../components/Feedback";
import { Loading } from "../components/States";
import Field from "../components/Field";
import { dayKey, errorMessage, formatDateTime, formatMinutes, formatTime, formatVisit, formatWeekday } from "../lib/format";
import { statusClass } from "../lib/labels";
import { usePolling } from "../lib/usePolling";
import { mark, t } from "../i18n";
import "./JobPage.css";
import "./RequestPage.css";

type Props = {
  requestId: number;
  user: User;
  onBack: () => void;
  onOpenJob: (id: number) => void;
  onOpenMachine: (id: number) => void;
  /** The chat with the company (a customer), or with this customer (a manager). */
  onOpenMessages: (customerId?: number) => void;
};

// The steps of a request, in order (the server's statuses).
const STEPS: string[] = [mark("Submitted"), mark("Inspection booked"), mark("Inspected"), mark("Repair booked"), mark("Completed")];
// A service from the catalog booked directly: no inspection.
const DIRECT_STEPS: string[] = [mark("Submitted"), mark("Service booked"), mark("Completed")];
const CLOSED = ["Completed", "Declined", "Cancelled"];
const VISIT_NAMES: Record<Visit, string> = { inspection: mark("Inspection"), repair: mark("Repair"), service: mark("Service visit") };
const NOT_STARTED = ["Pending", "Assigned", "Accepted"];

/**
 * One service request, for the customer who sent it and for the managers: where it is, the visits
 * (with "on the way", the findings and the photos), and the times free to book the next visit.
 */
export default function RequestPage({ requestId, user, onBack, onOpenJob, onOpenMachine, onOpenMessages }: Props) {
  const [request, setRequest] = useState<RequestDetail | null>(null);
  const [error, setError] = useState("");
  const load = () =>
    requestDetail(requestId)
      .then((data) => {
        setRequest(data.request);
        setError("");
      })
      .catch((problem) => setError(errorMessage(problem)));
  usePolling(load, 30000, true);

  if (!request) {
    return (
      <main className="jobPage requestPage">
        <BackButton onBack={onBack} />
        {error ? <div className="error">{error}</div> : <Loading label={t("Loading request…")} />}
      </main>
    );
  }

  const isBoss = user.role === "boss";
  const closed = CLOSED.includes(request.status);
  return (
    <main className="jobPage requestPage">
      <BackButton onBack={onBack} />
      <section className="jobHero" aria-label={t("Request summary")}>
        <div className="jobHeroTop">
          <span className="eyebrow">{t("Service request")}</span>
          <span className={`jobStatusPill ${statusClass(request.status)}`}>{t(request.status)}</span>
        </div>
        <h1>{request.subject}</h1>
        <p className="jobDescription">{request.description}</p>
        <dl className="jobMeta">
          <div>
            <dt>{t("Equipment")}</dt>
            <dd>
              <Wrench size={13} />{" "}
              {request.machine ? (
                <>
                  <button className="titleLink" onClick={() => onOpenMachine(request.machine!.id)}>
                    {request.machine.name}
                  </button>{" "}
                  · {request.machine.serial_no}
                </>
              ) : (
                t("Not set")
              )}
            </dd>
          </div>
          {isBoss && request.customer && (
            <div>
              <dt>{t("Customer")}</dt>
              <dd>
                <UserRound size={13} /> {request.customer.name}
              </dd>
            </div>
          )}
          <div>
            <dt>{t("Requested")}</dt>
            <dd>{formatDateTime(request.created_at)}</dd>
          </div>
          <div>
            <dt>{t("Priority")}</dt>
            <dd>{t(request.priority)}</dd>
          </div>
        </dl>
      </section>

      <Steps status={request.status} steps={request.booking === "direct" ? DIRECT_STEPS : STEPS} />
      {(request.status === "Declined" || request.status === "Cancelled") && (
        <p className="requestClosed" role="status">
          <Ban size={16} />
          {request.status === "Declined" ? t("This request was declined. Send a message if you have questions.") : t("This request was cancelled.")}
        </p>
      )}

      <div className="jobGrid">
        {(request.can_book || request.can_move) && <SlotPicker key={`${request.status}-${request.visits.length}`} request={request} onBooked={setRequest} onOpenMessages={onOpenMessages} />}
        <section className="jobCard wide">
          <div className="jobCardHead">
            <h2>
              <CalendarClock size={16} /> {t("Visits")}
            </h2>
            {request.visits.length > 0 && <span className="jobBadge">{request.visits.length}</span>}
          </div>
          {request.visits.length === 0 ? (
            <p className="muted jobEmpty">{closed ? t("No visits were booked.") : t("No visit booked yet. Pick a time above.")}</p>
          ) : (
            <ul className="visitList">
              {request.visits.map((visit) => (
                <VisitCard key={visit.job_id} visit={visit} onOpenJob={onOpenJob} />
              ))}
            </ul>
          )}
        </section>
        <section className={`jobCard ${isBoss ? "" : "wide"}`}>
          <div className="jobCardHead">
            <h2>
              <MessageSquare size={16} /> {isBoss ? t("Talk to the customer") : t("Questions or a quote?")}
            </h2>
          </div>
          <p className="muted">
            {isBoss
              ? t("Quotes, prices and changes of plan go in the chat with the customer.")
              : t("Prices and quotes aren't in the app. Ask the team in the chat, and they'll reply here.")}
          </p>
          <button className="secondary" onClick={() => onOpenMessages(isBoss ? request.customer?.id : undefined)}>
            <MessageSquare size={15} /> {isBoss ? t("Message {name}", { name: request.customer?.name ?? t("Customer") }) : t("Send a message")}
          </button>
          {!isBoss && request.can_cancel && <CancelButton request={request} onDone={setRequest} />}
        </section>
        {isBoss && !closed && <ManagerActions request={request} onDone={setRequest} />}
      </div>
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

/** Where the request is: Submitted → Inspection booked → Inspected → Repair booked → Completed,
 *  or for a service booked directly, Submitted → Service booked → Completed. */
function Steps({ status, steps }: { status: string; steps: string[] }) {
  const reached = steps.indexOf(status);
  return (
    <ol className="requestSteps" aria-label={t("Steps")}>
      {steps.map((step, index) => {
        const state = reached < 0 ? "" : index < reached || status === "Completed" ? "done" : index === reached ? "current" : "";
        return (
          <li key={step} className={state} aria-current={state === "current" ? "step" : undefined}>
            <span className="stepDot" aria-hidden="true">
              {state === "done" ? <Check size={13} /> : index + 1}
            </span>
            <span>{t(step)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function VisitCard({ visit, onOpenJob }: { visit: RequestVisit; onOpenJob: (id: number) => void }) {
  const onTheWay = visit.on_the_way_at && NOT_STARTED.includes(visit.status);
  const findings = visit.findings;
  return (
    <li className={`visitCard ${onTheWay ? "onTheWay" : ""}`}>
      <div className="visitHead">
        <div>
          <strong>
            {visit.visit === "inspection" ? <Search size={15} /> : <Wrench size={15} />} {t(VISIT_NAMES[visit.visit])}
          </strong>
          <span>{formatVisit(visit.scheduled_start, visit.scheduled_end)}</span>
        </div>
        <span className={`jobStatusPill ${statusClass(visit.status)}`}>{t(visit.status)}</span>
      </div>
      {visit.technician && <p className="visitLine">{t("Technician: {name}", { name: visit.technician.name })}</p>}
      {onTheWay && visit.on_the_way_at && (
        <p className="visitOnTheWay" role="status">
          <Truck size={16} /> {t("On the way since {time}", { time: formatTime(visit.on_the_way_at) })}
        </p>
      )}
      {visit.status === "In Progress" && <p className="visitLine strong">{t("Work is under way.")}</p>}
      {findings && (findings.problem || findings.solution || findings.work_done || findings.advice) && (
        <dl className="visitFindings">
          {findings.problem && (
            <div>
              <dt>{t("What was found")}</dt>
              <dd>{findings.problem}</dd>
            </div>
          )}
          {(findings.solution || findings.work_done) && (
            <div>
              <dt>{t("What was done")}</dt>
              <dd>{findings.solution || findings.work_done}</dd>
            </div>
          )}
          {findings.advice && (
            <div>
              <dt>{t("Advice")}</dt>
              <dd>{findings.advice}</dd>
            </div>
          )}
        </dl>
      )}
      {visit.photos.length > 0 && (
        <ul className="visitPhotos" aria-label={t("Photos")}>
          {visit.photos
            .filter((photo) => photo.content_type.startsWith("image/"))
            .map((photo) => (
              <li key={photo.id}>
                <a href={apiUrl(photo.url)} target="_blank" rel="noreferrer">
                  <img src={apiUrl(photo.url)} alt={t("Photo from the visit")} loading="lazy" />
                </a>
              </li>
            ))}
          {visit.photos.some((photo) => !photo.content_type.startsWith("image/")) && (
            <li className="visitVideoNote">
              <Camera size={14} /> {t("Videos are on the job's page.")}
            </li>
          )}
        </ul>
      )}
      <button className="link" onClick={() => onOpenJob(visit.job_id)}>
        <ClipboardList size={14} /> {t("See the job's details")}
      </button>
    </li>
  );
}

/** The free times for the next visit (or to move the booked one), a day at a time. */
function SlotPicker({ request, onBooked, onOpenMessages }: { request: RequestDetail; onBooked: (request: RequestDetail) => void; onOpenMessages: () => void }) {
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [visit, setVisit] = useState<Visit | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);
  const [day, setDay] = useState("");
  const [chosen, setChosen] = useState<Slot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadSlots = () =>
    requestSlots(request.id)
      .then((data) => {
        setSlots(data.slots);
        setVisit(data.visit);
        setMinutes(data.minutes);
        setMoving(Boolean(data.moving));
        setDay((current) => (data.slots.some((slot) => dayKey(slot.start) === current) ? current : data.slots[0] ? dayKey(data.slots[0].start) : ""));
      })
      .catch((problem) => setError(errorMessage(problem)));
  useEffect(() => {
    void loadSlots();
  }, [request.id]);

  const days = useMemo(() => {
    const grouped = new Map<string, Slot[]>();
    for (const slot of slots ?? []) grouped.set(dayKey(slot.start), [...(grouped.get(dayKey(slot.start)) ?? []), slot]);
    return [...grouped.entries()];
  }, [slots]);
  const times = days.find(([key]) => key === day)?.[1] ?? [];

  const book = async () => {
    if (!chosen) return;
    setBusy(true);
    setError("");
    try {
      const data = await bookVisit(request.id, chosen.start);
      toast(moving ? t("Visit moved") : t("Visit booked"));
      setChosen(null);
      onBooked(data.request);
    } catch (problem) {
      setError(errorMessage(problem));
      setChosen(null);
      void loadSlots();
    } finally {
      setBusy(false);
    }
  };

  const title = moving
    ? t("Move the visit")
    : visit === "repair"
      ? t("Pick a time for the repair")
      : visit === "service"
        ? t("Pick a time for the service")
        : t("Pick a time for the inspection");
  return (
    <section className="jobCard wide slotPicker" aria-labelledby="slot-picker-title">
      <div className="jobCardHead">
        <h2 id="slot-picker-title">
          <CalendarCheck size={16} /> {title}
        </h2>
        {minutes && <span className="jobBadge">{t("About {duration}", { duration: formatMinutes(minutes) })}</span>}
      </div>
      {error && <div className="error">{error}</div>}
      {slots === null ? (
        !error && <Loading label={t("Finding free times…")} />
      ) : slots.length === 0 ? (
        <div className="slotEmpty">
          <p className="muted">{t("No times are free right now. Send a message and the team will find one.")}</p>
          <button className="secondary" onClick={() => onOpenMessages()}>
            <MessageSquare size={15} /> {t("Send a message")}
          </button>
        </div>
      ) : (
        <>
          <div className="slotDays" role="tablist" aria-label={t("Days")}>
            {days.map(([key, daySlots]) => (
              <button
                key={key}
                role="tab"
                aria-selected={key === day}
                className={key === day ? "chosen" : ""}
                onClick={() => {
                  setDay(key);
                  setChosen(null);
                }}
              >
                <strong>{formatWeekday(daySlots[0].start)}</strong>
                <small>{daySlots.length === 1 ? t("1 time") : t("{count} times", { count: daySlots.length })}</small>
              </button>
            ))}
          </div>
          <div className="slotTimes" role="radiogroup" aria-label={t("Times on {day}", { day: times[0] ? formatWeekday(times[0].start) : "" })}>
            {times.map((slot) => (
              <button
                key={slot.start}
                role="radio"
                aria-checked={chosen?.start === slot.start}
                className={chosen?.start === slot.start ? "chosen" : ""}
                onClick={() => setChosen(slot)}
              >
                {formatTime(slot.start)}
              </button>
            ))}
          </div>
          <button className="primary slotBook" disabled={!chosen || busy} onClick={book}>
            {busy
              ? t("Booking…")
              : chosen
                ? moving
                  ? t("Move to {time}", { time: formatVisit(chosen.start, chosen.end) })
                  : t("Book {time}", { time: formatVisit(chosen.start, chosen.end) })
                : t("Pick a time")}
          </button>
        </>
      )}
    </section>
  );
}

function CancelButton({ request, onDone }: { request: RequestDetail; onDone: (request: RequestDetail) => void }) {
  const cancel = async () => {
    const ok = await confirmAction({
      title: t("Cancel this request?"),
      message: t("Any visit booked for it is cancelled too."),
      confirmLabel: t("Cancel request"),
      cancelLabel: t("Keep it"),
      danger: true,
    });
    if (!ok) return;
    try {
      onDone((await cancelRequest(request.id)).request);
      toast(t("Request cancelled"));
    } catch (problem) {
      toast(errorMessage(problem), "error");
    }
  };
  return (
    <button className="link dangerText requestCancel" onClick={cancel}>
      <Ban size={14} /> {t("Cancel request")}
    </button>
  );
}

/** A manager sets how long the repair takes, or declines or cancels the request. */
function ManagerActions({ request, onDone }: { request: RequestDetail; onDone: (request: RequestDetail) => void }) {
  const [repairMinutes, setRepairMinutes] = useState(String(request.repair_minutes));
  const [busy, setBusy] = useState(false);
  const change = async (data: Record<string, string | number>, done: string) => {
    setBusy(true);
    try {
      onDone((await updateRequest(request.id, data)).request);
      toast(done);
    } catch (problem) {
      toast(errorMessage(problem), "error");
    } finally {
      setBusy(false);
    }
  };
  const close = async (status: "Declined" | "Cancelled") => {
    const ok = await confirmAction({
      title: status === "Declined" ? t("Decline this request?") : t("Cancel this request?"),
      message: t("Visits that haven't started are cancelled, and the customer is told."),
      confirmLabel: status === "Declined" ? t("Decline") : t("Cancel request"),
      cancelLabel: t("Keep it"),
      danger: true,
    });
    if (ok) await change({ status }, status === "Declined" ? t("Request declined") : t("Request cancelled"));
  };
  const repairAhead = !["Repair booked", "Service booked", "Completed"].includes(request.status);
  const direct = request.booking === "direct";
  return (
    <section className="jobCard">
      <div className="jobCardHead">
        <h2>
          <ClipboardList size={16} /> {t("Manage the request")}
        </h2>
      </div>
      {repairAhead && (
        <form
          className="form requestRepairLength"
          onSubmit={(event) => {
            event.preventDefault();
            void change({ repair_minutes: Number(repairMinutes) }, direct ? t("Visit length saved") : t("Repair length saved"));
          }}
        >
          <Field
            label={direct ? t("Visit length (minutes)") : t("Repair length (minutes)")}
            hint={direct ? t("The customer is offered times that fit it. It starts at the service's usual time.") : t("The customer is offered times that fit it. Set it after the inspection.")}
          >
            <input id="field-repair-minutes" type="number" min={30} max={1440} step={15} value={repairMinutes} onChange={(e) => setRepairMinutes(e.target.value)} required />
          </Field>
          <button className="secondary" disabled={busy}>
            {t("Save")}
          </button>
        </form>
      )}
      {request.can_cancel && (
        <div className="requestCloseActions">
          <button className="secondary dangerText" disabled={busy} onClick={() => close("Declined")}>
            {t("Decline")}
          </button>
          <button className="secondary dangerText" disabled={busy} onClick={() => close("Cancelled")}>
            {t("Cancel request")}
          </button>
        </div>
      )}
      <p className="muted requestHint">{t("Last updated {time}", { time: formatDateTime(request.updated_at || request.created_at) })}</p>
    </section>
  );
}
