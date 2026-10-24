import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin } from "lucide-react";
import { teamLocations } from "../services/api";
import type { TeamMember } from "../services/types";
import { ago, errorMessage, formatDistance } from "../lib/format";
import { mapLink } from "../lib/location";
import { usePolling } from "../lib/usePolling";
import { mark, t } from "../i18n";
import "./Team.css";
import { EmptyState } from "./States";

const SEEN: Record<string, string> = {
  clock_in: mark("Seen {ago} at clock-in"),
  clock_out: mark("Seen {ago} at clock-out"),
  job_start: mark("Seen {ago} starting a job"),
  job_complete: mark("Seen {ago} completing a job"),
  live: mark("Seen {ago} while working"),
};
// Letters and digits only: initials go into the marker's HTML.
const initials = (name: string) =>
  name
    .split(" ")
    .map((part) => part.replace(/[^\p{L}\p{N}]/gu, "")[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
// Leaflet treats tooltip strings as HTML, so names go in as text.
const textNode = (text: string) => {
  const span = document.createElement("span");
  span.textContent = text;
  return span;
};

/** Managers: the last known position of every clocked-in technician. */
export default function TeamMap({ onOpenJob }: { onOpenJob?: (id: number) => void }) {
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [error, setError] = useState("");
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);

  usePolling(
    () =>
      teamLocations()
        .then((data) => {
          setTeam(data.team);
          setError("");
        })
        .catch((e) => setError(errorMessage(e))),
    60000,
  );

  useEffect(() => {
    if (!holder.current) return;
    // Free OpenStreetMap tiles for now; switch to a paid tile provider before launch.
    map.current = L.map(holder.current, { scrollWheelZoom: false }).setView([-1.29, 36.82], 11);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => {
      // Stop any zoom in flight first: Leaflet throws if a removed map finishes animating.
      map.current?.stop();
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    if (!map.current || !layer.current || !team) return;
    layer.current.clearLayers();
    const placed = team.flatMap((person) => (person.last ? [{ ...person, last: person.last }] : []));
    for (const person of placed) {
      const { latitude, longitude, accuracy_m } = person.last;
      if (accuracy_m) L.circle([latitude, longitude], { radius: accuracy_m, color: "#0969d7", weight: 1, fillOpacity: 0.08 }).addTo(layer.current);
      L.marker([latitude, longitude], {
        icon: L.divIcon({ className: "teamMarker", html: `<span>${initials(person.name)}</span>`, iconSize: [34, 34], iconAnchor: [17, 17] }),
        title: person.name,
      })
        .bindTooltip(textNode(`${person.name} · ${ago(person.last.recorded_at)}`))
        .addTo(layer.current);
    }
    // Fit everyone in view once; after that, leave the zoom where the manager put it.
    if (placed.length && !fitted.current) {
      fitted.current = true;
      const bounds = L.latLngBounds(placed.map((p) => [p.last.latitude, p.last.longitude] as [number, number]));
      map.current.fitBounds(bounds.pad(0.4), { maxZoom: 15, animate: false });
    }
  }, [team]);

  const focus = (person: TeamMember) => {
    if (person.last && map.current) map.current.setView([person.last.latitude, person.last.longitude], 16, { animate: false });
  };

  return (
    <div className="teamMap">
      {error && <div className="error">{error}</div>}
      <div className="teamMapCanvas" ref={holder} aria-label={t("Map of clocked-in technicians")} />
      <div className="teamList">
        <p className="muted">
          {t("Only technicians who are clocked in are shown. Positions update while a job is in progress and the technician has the app open.")}
        </p>
        {team && team.length === 0 && (
          <EmptyState icon={<MapPin size={26} />} title={t("Nobody is clocked in")} text={t("Technicians appear here when they clock in.")} />
        )}
        {team?.map((person) => (
          <article className="teamRow" key={person.user_id}>
            <span className="teamAvatar">{initials(person.name)}</span>
            <div>
              <strong>{person.name}</strong>
              <span>
                {person.last ? t(SEEN[person.last.kind] || mark("Seen {ago}"), { ago: ago(person.last.recorded_at) }) : t("No location yet")}
                {person.last?.accuracy_m ? ` · ±${formatDistance(person.last.accuracy_m)}` : ""}
              </span>
              {person.job ? (
                <button className="titleLink" onClick={() => person.job && onOpenJob?.(person.job.id)}>
                  {t("Working on {title}", { title: person.job.title })}
                </button>
              ) : (
                <span>{t("Clocked in, no job in progress")}</span>
              )}
            </div>
            {person.last && (
              <div className="teamRowActions">
                <button className="listAction" onClick={() => focus(person)}>
                  <MapPin size={12} /> {t("Show")}
                </button>
                <a className="listAction" href={mapLink(person.last.latitude, person.last.longitude)} target="_blank" rel="noreferrer">
                  {t("Open map")}
                </a>
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
