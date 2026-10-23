import { useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, Clock, MapPin } from "lucide-react";
import Modal from "./Modal";
import { correctShift, mechanics, shiftList } from "../services/api";
import { asDate, errorMessage, formatDay as day, formatTime as time, fromZoneInput, toZoneInput } from "../lib/format";
import { mapLink } from "../lib/location";
import { t } from "../i18n";
import "./Team.css";

/** Shift times and hours. Managers see everyone and can fix a clock-out; technicians see their own. */
export default function ShiftsView({ user }: { user: any }) {
  const isBoss = user.role === "boss";
  const [shifts, setShifts] = useState<any[] | null>(null);
  const [people, setPeople] = useState<any[]>([]);
  const [mechanicId, setMechanicId] = useState<number | "">("");
  const [days, setDays] = useState(14);
  const [error, setError] = useState("");
  const [fixing, setFixing] = useState<any>(null);

  const load = () =>
    shiftList({ mechanic_id: mechanicId, days })
      .then((data) => setShifts(data.shifts))
      .catch((e) => setError(errorMessage(e)));
  useEffect(() => {
    load();
  }, [mechanicId, days]);
  useEffect(() => {
    if (isBoss) mechanics().then((data) => setPeople(data.mechanics || [])).catch(() => {});
  }, [isBoss]);

  const total = (shifts || []).reduce((sum, shift) => sum + shift.hours, 0);
  return (
    <div className="shiftsView">
      {error && <div className="error">{error}</div>}
      <div className="shiftFilters">
        {isBoss && (
          <label>
            {t("Technician")}
            <select value={mechanicId} onChange={(e) => setMechanicId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">{t("Everyone")}</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          {t("Period")}
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[7, 14, 30, 90].map((count) => (
              <option key={count} value={count}>
                {t("Last {count} days", { count })}
              </option>
            ))}
          </select>
        </label>
        <span className="shiftTotal">
          <Clock size={14} /> {t("{hours} h total", { hours: total.toFixed(1) })}
        </span>
      </div>
      {shifts && shifts.length === 0 ? (
        <div className="subEmpty">
          <strong>{t("No shifts in this period")}</strong>
          <span>{t("Shifts appear here when technicians clock in.")}</span>
        </div>
      ) : (
        <div className={`shiftTable ${isBoss ? "" : "own"}`} role="table" aria-label={t("Shifts")}>
          <div className="shiftRow shiftHead" role="row">
            {isBoss && <span role="columnheader">{t("Technician")}</span>}
            <span role="columnheader">{t("Date")}</span>
            <span role="columnheader">{t("In")}</span>
            <span role="columnheader">{t("Out")}</span>
            <span role="columnheader">{t("Hours")}</span>
            <span role="columnheader">{t("Clock-in place")}</span>
            {isBoss && <span role="columnheader" />}
          </div>
          {shifts?.map((shift) => (
            <div className={`shiftRow ${shift.open ? "open" : ""}`} role="row" key={shift.id}>
              {isBoss && (
                <strong role="cell" data-label={t("Technician")}>
                  {shift.mechanic}
                </strong>
              )}
              <span role="cell" data-label={t("Date")}>
                {day(shift.clocked_in_at)}
              </span>
              <span role="cell" data-label={t("In")}>
                {time(shift.clocked_in_at)}
              </span>
              <span role="cell" data-label={t("Out")}>
                {shift.open ? <em className="shiftBadge on">{t("On shift")}</em> : time(shift.clocked_out_at)}
                {shift.edited && (
                  <small title={shift.original_clocked_out_at ? t("Originally {time}", { time: time(shift.original_clocked_out_at) }) : t("Clock-out set by a manager")}>
                    {shift.original_clocked_out_at
                      ? t("Set by {name} (was {time})", { name: shift.edited_by, time: time(shift.original_clocked_out_at) })
                      : t("Set by {name}", { name: shift.edited_by })}
                  </small>
                )}
              </span>
              <span role="cell" data-label={t("Hours")}>
                {shift.hours.toFixed(1)}
                {shift.long && (
                  <em className="shiftBadge warn" title={t("Longer than 12 hours: check the clock-out time")}>
                    <AlertTriangle size={11} /> {t("Over 12 h")}
                  </em>
                )}
              </span>
              <span role="cell" data-label={t("Clock-in place")}>
                {shift.clock_in_location?.latitude != null ? (
                  <a href={mapLink(shift.clock_in_location.latitude, shift.clock_in_location.longitude)} target="_blank" rel="noreferrer">
                    <MapPin size={11} /> {t("Map")}
                  </a>
                ) : (
                  <span className="muted">{t("Not shared")}</span>
                )}
              </span>
              {isBoss && (
                <span role="cell" className="shiftAction">
                  {(shift.open || shift.long || shift.edited) && (
                    <button className="listAction" onClick={() => setFixing(shift)}>
                      {shift.open ? t("Clock out") : t("Fix clock-out")}
                    </button>
                  )}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {fixing && (
        <FixShift
          shift={fixing}
          onClose={() => setFixing(null)}
          onSaved={() => {
            setFixing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function FixShift({ shift, onClose, onSaved }: { shift: any; onClose: () => void; onSaved: () => void }) {
  // The input shows the company's clock, the same times as the table.
  const start = asDate(shift.clocked_in_at);
  const suggested = shift.clocked_out_at ? asDate(shift.clocked_out_at) : new Date(Math.min(Date.now(), start.getTime() + 8 * 3600000));
  const [value, setValue] = useState(toZoneInput(suggested));
  const [error, setError] = useState("");
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    try {
      await correctShift(shift.id, fromZoneInput(value).toISOString());
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <Modal title={t("Clock-out for {name}", { name: shift.mechanic })} icon={<Clock size={20} />} onClose={onClose}>
      <form className="form form-upgraded" onSubmit={save}>
        {error && <div className="error">{error}</div>}
        <p className="muted">
          {t("Clocked in {day} at {time}.", { day: day(shift.clocked_in_at), time: time(shift.clocked_in_at) })}{" "}
          {shift.open ? `${t("Setting a clock-out time ends this shift now and pauses any job in progress.")} ` : ""}
          {t("The change is recorded with your name, and the technician is notified.")}
        </p>
        <div className="formGroup">
          <label htmlFor="field-clocked_out_at">{t("Clock-out time")}</label>
          <input
            id="field-clocked_out_at"
            type="datetime-local"
            value={value}
            min={toZoneInput(start)}
            max={toZoneInput(new Date())}
            onChange={(e) => setValue(e.target.value)}
            required
          />
        </div>
        <button className="primary">{t("Save clock-out")}</button>
      </form>
    </Modal>
  );
}
