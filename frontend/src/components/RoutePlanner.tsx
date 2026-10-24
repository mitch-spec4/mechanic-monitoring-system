import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { CalendarClock, CheckCircle2, Navigation, Route as RouteIcon } from "lucide-react";
import { mechanics, routePlan, saveRoute } from "../services/api";
import type { Mechanic, RoutePlan, RouteStop } from "../services/types";
import { errorMessage, formatDate, formatDistance, formatMinutes, formatTime, toZoneInput } from "../lib/format";
import { directionsLink, routeLink } from "../lib/directions";
import { mark, t } from "../i18n";
import { toast } from "./Feedback";
import { EmptyState, Loading } from "./States";
import "./RoutePlanner.css";

const today = () => toZoneInput(new Date()).slice(0, 10);
const minutes = (seconds: number) => formatMinutes(Math.max(1, Math.round(seconds / 60)));
const START_WORDS: Record<RoutePlan["start"]["kind"], string> = {
  position: mark("Starts from where {name} is now."),
  base: mark("Starts from your base."),
  first_stop: mark("Starts at the first stop: set your base in Settings to start from there."),
};

/**
 * Managers: the order to visit a technician's jobs on a day, to cut the driving, against the order
 * they're in now. Saving it puts the technician's Today's jobs in that order.
 */
export default function RoutePlanner({ onOpenJob }: { onOpenJob?: (id: number) => void }) {
  const [team, setTeam] = useState<Mechanic[] | null>(null);
  const [mechanicId, setMechanicId] = useState<number | null>(null);
  const [day, setDay] = useState(today);
  const [plan, setPlan] = useState<RoutePlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const asked = useRef(0);

  useEffect(() => {
    mechanics()
      .then((data) => {
        setTeam(data.mechanics);
        setMechanicId((current) => current ?? data.mechanics[0]?.id ?? null);
      })
      .catch((problem) => setError(errorMessage(problem)));
  }, []);
  useEffect(() => {
    if (!mechanicId || !day) return;
    const ask = ++asked.current;
    setLoading(true);
    routePlan(mechanicId, day)
      .then((data) => ask === asked.current && (setPlan(data.plan), setError("")))
      .catch((problem) => ask === asked.current && setError(errorMessage(problem)))
      .finally(() => ask === asked.current && setLoading(false));
  }, [mechanicId, day]);

  const save = async () => {
    if (!plan || !mechanicId) return;
    setSaving(true);
    try {
      setPlan((await saveRoute(mechanicId, plan.date, plan.suggested.job_ids)).plan);
      toast(t("Route saved: {name}'s jobs are in this order", { name: plan.mechanic.name }));
    } catch (problem) {
      toast(errorMessage(problem), "error");
    } finally {
      setSaving(false);
    }
  };

  if (team === null) return error ? <div className="error">{error}</div> : <Loading />;
  if (team.length === 0) return <EmptyState icon={<RouteIcon size={26} />} title={t("No technicians yet")} text={t("Invite a technician to plan their routes.")} />;
  const savedMetres = plan ? plan.current.metres - plan.suggested.metres : 0;
  const savedSeconds = plan ? plan.current.seconds - plan.suggested.seconds : 0;
  const wholeRoute = plan ? routeLink(plan.stops.flatMap((stop) => (stop.latitude != null && stop.longitude != null ? [{ latitude: stop.latitude, longitude: stop.longitude }] : [])), plan.start) : null;
  return (
    <div className="routePlanner">
      <div className="routeFilters">
        <label>
          {t("Technician")}
          <select value={mechanicId ?? ""} onChange={(event) => setMechanicId(Number(event.target.value))}>
            {team.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Day")}
          <input type="date" value={day} onChange={(event) => event.target.value && setDay(event.target.value)} />
        </label>
      </div>
      {error && <div className="error">{error}</div>}
      {!plan ? (
        !error && <Loading label={t("Planning the route…")} />
      ) : (
        <div className={`routeBody ${loading ? "refreshing" : ""}`} aria-busy={loading}>
          {plan.stops.length === 0 ? (
            <EmptyState
              icon={<RouteIcon size={26} />}
              title={t("Nothing to route on {date}", { date: formatDate(plan.date) })}
              text={t("Jobs due by this day, with a pin on their site's map, appear here. Try another day.")}
            />
          ) : (
            <>
              <div className="routeSummary" role="status">
                <strong>
                  {plan.stops.length === 1 ? t("1 stop") : t("{count} stops", { count: plan.stops.length })} · {formatDistance(plan.suggested.metres)} ·{" "}
                  {t("about {time} driving", { time: minutes(plan.suggested.seconds) })}
                </strong>
                <span>
                  {savedMetres > 50
                    ? t("Saves {distance} and {time} against the order they're in now.", { distance: formatDistance(savedMetres), time: minutes(Math.max(savedSeconds, 60)) })
                    : t("This is already the shortest order found.")}{" "}
                  {t(START_WORDS[plan.start.kind], { name: plan.mechanic.name })}
                </span>
                {plan.estimate === "straight_line" && (
                  <small>
                    {plan.fell_back
                      ? t("The routing service didn't answer, so distances are straight lines and times are rough.")
                      : t("Distances are straight lines and times are rough: add a routing key for real drive times (see SETUP.md).")}
                  </small>
                )}
              </div>
              <div className="routeLayout">
                <RouteMap plan={plan} />
                <ol className="routeStops">
                  {plan.stops.map((stop, index) => {
                    const from = index === 0 ? (plan.start.kind === "first_stop" ? null : plan.start) : plan.stops[index - 1];
                    return (
                      <li key={stop.job_id}>
                        <span className="routeNumber" aria-hidden="true">
                          {stop.stop}
                        </span>
                        <div>
                          {onOpenJob ? (
                            <button className="titleLink" onClick={() => onOpenJob(stop.job_id)}>
                              <strong>{stop.title}</strong>
                            </button>
                          ) : (
                            <strong>{stop.title}</strong>
                          )}
                          <small>{[stop.customer, stop.location].filter(Boolean).join(" · ")}</small>
                          {index > 0 || plan.start.kind !== "first_stop" ? (
                            <small className="routeLeg">
                              {t("{distance}, about {time}", { distance: formatDistance(stop.leg_metres ?? 0), time: minutes(stop.leg_seconds ?? 0) })}
                            </small>
                          ) : null}
                        </div>
                        {stop.latitude != null && stop.longitude != null && (
                          <a className="listAction" href={directionsLink({ latitude: stop.latitude, longitude: stop.longitude }, from)} target="_blank" rel="noreferrer">
                            <Navigation size={12} /> {t("Directions")}
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>
              <div className="routeActions">
                {plan.applied ? (
                  <p className="routeSaved">
                    <CheckCircle2 size={15} /> {t("Saved: {name}'s Today's jobs follow this order.", { name: plan.mechanic.name })}
                  </p>
                ) : (
                  <button className="primary routeSave" disabled={saving} onClick={save}>
                    <RouteIcon size={15} /> {saving ? t("Saving…") : t("Use this order")}
                  </button>
                )}
                {wholeRoute && (
                  <a className="listAction" href={wholeRoute} target="_blank" rel="noreferrer">
                    <Navigation size={12} /> {plan.stops.length > 10 ? t("First 10 stops in Maps") : t("Whole route in Maps")}
                  </a>
                )}
              </div>
            </>
          )}
          {plan.booked.length > 0 && <OtherJobs title={t("Booked visits keep their times")} jobs={plan.booked} showTime onOpenJob={onOpenJob} />}
          {plan.unplaced.length > 0 && (
            <OtherJobs title={t("Not on the map")} hint={t("Give their site a pin (on the customer's page) to route them.")} jobs={plan.unplaced} onOpenJob={onOpenJob} />
          )}
        </div>
      )}
    </div>
  );
}

function OtherJobs({ title, hint, jobs, showTime, onOpenJob }: { title: string; hint?: string; jobs: RouteStop[]; showTime?: boolean; onOpenJob?: (id: number) => void }) {
  return (
    <section className="routeOther">
      <h3>
        <CalendarClock size={14} /> {title}
      </h3>
      {hint && <p className="muted">{hint}</p>}
      <ul>
        {jobs.map((job) => (
          <li key={job.job_id}>
            {onOpenJob ? (
              <button className="titleLink" onClick={() => onOpenJob(job.job_id)}>
                {job.title}
              </button>
            ) : (
              job.title
            )}
            <small>{[showTime && job.scheduled_start ? formatTime(job.scheduled_start) : null, job.customer, job.location].filter(Boolean).join(" · ")}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The stops numbered on a map, joined in order with straight lines (the drive itself follows roads). */
function RouteMap({ plan }: { plan: RoutePlan }) {
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!holder.current) return;
    map.current = L.map(holder.current, { scrollWheelZoom: false }).setView([-1.29, 36.82], 11);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current?.stop();
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    if (!map.current || !layer.current) return;
    layer.current.clearLayers();
    const points: [number, number][] = [];
    if (plan.start.kind !== "first_stop" && plan.start.latitude != null && plan.start.longitude != null) {
      points.push([plan.start.latitude, plan.start.longitude]);
      L.marker(points[0], { icon: L.divIcon({ className: "routeMarker start", html: "<span>⌂</span>", iconSize: [30, 30], iconAnchor: [15, 15] }), keyboard: false }).addTo(layer.current);
    }
    for (const stop of plan.stops) {
      if (stop.latitude == null || stop.longitude == null) continue;
      const at: [number, number] = [stop.latitude, stop.longitude];
      points.push(at);
      const label = document.createElement("span");
      label.textContent = String(stop.stop);
      L.marker(at, { icon: L.divIcon({ className: "routeMarker", html: label.outerHTML, iconSize: [30, 30], iconAnchor: [15, 15] }), title: stop.title, keyboard: false }).addTo(layer.current);
    }
    if (points.length > 1) L.polyline(points, { color: "#0969d7", weight: 3, opacity: 0.8 }).addTo(layer.current);
    if (points.length) map.current.fitBounds(L.latLngBounds(points).pad(0.25), { maxZoom: 15, animate: false });
  }, [plan]);

  return <div className="routeMap" ref={holder} role="img" aria-label={t("Map of the route, stops numbered in order")} />;
}
