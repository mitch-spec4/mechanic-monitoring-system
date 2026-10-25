import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Crosshair, MapPin, X } from "lucide-react";
import type { Position } from "../services/types";
import { getPosition, hasFix, locationHelp } from "../lib/location";
import { t } from "../i18n";
import "./MapPicker.css";

// Where the map opens with no pin yet: Nairobi.
const START: [number, number] = [-1.2921, 36.8219];
const round = (value: number) => Math.round(value * 1e6) / 1e6;

type Props = {
  value: Position | null;
  onChange: (position: Position | null) => void;
  /** Read out with the map, e.g. "Pin for Industrial Area plant". */
  label: string;
};

/**
 * Put a pin on the map: click (or tap) the map, drag the pin, use this device's location, or type
 * the coordinates. Used for the company's base and customers' sites, for planning routes.
 */
export default function MapPicker({ value, onChange, label }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const latest = useRef(onChange);
  latest.current = onChange;
  const [finding, setFinding] = useState(false);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    if (!holder.current) return;
    map.current = L.map(holder.current, { scrollWheelZoom: false }).setView(value ? [value.latitude, value.longitude] : START, value ? 15 : 11);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map.current);
    map.current.on("click", (event: L.LeafletMouseEvent) => latest.current({ latitude: round(event.latlng.lat), longitude: round(event.latlng.lng) }));
    return () => {
      map.current?.stop();
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
  }, []);

  // The pin follows the value.
  useEffect(() => {
    if (!map.current) return;
    if (!value) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    const at: [number, number] = [value.latitude, value.longitude];
    if (!marker.current) {
      marker.current = L.marker(at, {
        draggable: true,
        icon: L.divIcon({ className: "pickerPin", html: "<span></span>", iconSize: [26, 26], iconAnchor: [13, 26] }),
        keyboard: false,
      }).addTo(map.current);
      marker.current.on("dragend", () => {
        const moved = marker.current?.getLatLng();
        if (moved) latest.current({ latitude: round(moved.lat), longitude: round(moved.lng) });
      });
    } else {
      marker.current.setLatLng(at);
    }
    if (!map.current.getBounds().contains(at)) map.current.setView(at, Math.max(map.current.getZoom(), 15), { animate: false });
  }, [value?.latitude, value?.longitude]);

  const here = async () => {
    setFinding(true);
    setProblem("");
    const result = await getPosition();
    setFinding(false);
    if (hasFix(result)) {
      onChange({ latitude: round(result.latitude), longitude: round(result.longitude) });
      map.current?.setView([result.latitude, result.longitude], 16, { animate: false });
    } else {
      setProblem(locationHelp(result.location_error));
    }
  };
  const typed = (key: keyof Position, text: string) => {
    const number = Number(text);
    if (text.trim() === "" || !Number.isFinite(number)) return;
    onChange({ latitude: value?.latitude ?? START[0], longitude: value?.longitude ?? START[1], [key]: number });
  };

  return (
    <div className="mapPicker">
      <div className="mapPickerCanvas" ref={holder} role="application" aria-label={label} />
      <div className="mapPickerBar">
        <span className="mapPickerValue">
          <MapPin size={13} /> {value ? `${value.latitude.toFixed(5)}, ${value.longitude.toFixed(5)}` : t("No pin yet: click the map to place it.")}
        </span>
        <button type="button" className="listAction" onClick={here} disabled={finding}>
          <Crosshair size={12} /> {finding ? t("Finding you…") : t("Use my location")}
        </button>
        {value && (
          <button type="button" className="listAction" onClick={() => onChange(null)}>
            <X size={12} /> {t("Remove pin")}
          </button>
        )}
      </div>
      {problem && <p className="error">{problem}</p>}
      <details className="mapPickerTyped">
        <summary>{t("Type the coordinates")}</summary>
        <div className="row">
          <label>
            {t("Latitude")}
            <input type="number" step="0.000001" min={-90} max={90} defaultValue={value?.latitude ?? ""} key={`lat-${value?.latitude}`} onBlur={(e) => typed("latitude", e.target.value)} />
          </label>
          <label>
            {t("Longitude")}
            <input type="number" step="0.000001" min={-180} max={180} defaultValue={value?.longitude ?? ""} key={`lng-${value?.longitude}`} onBlur={(e) => typed("longitude", e.target.value)} />
          </label>
        </div>
      </details>
    </div>
  );
}
