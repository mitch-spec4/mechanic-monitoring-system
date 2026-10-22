import { useEffect, useState } from "react";
import { AlertTriangle, Clock, MapPin } from "lucide-react";
import Modal from "./Modal";
import { correctShift, mechanics, shiftList } from "../services/api";
import { errorMessage, formatDate } from "../lib/format";
import { mapLink } from "../lib/location";
import "./Team.css";

const asDate = (value: string) => new Date(value.endsWith("Z") ? value : `${value}Z`);
const time = (value?: string | null) => (value ? asDate(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
const day = (value: string) => formatDate(asDate(value).toISOString());
// "YYYY-MM-DDTHH:MM" in local time, for a datetime-local input.
const localInput = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

/** Shift times and hours. Managers see everyone and can fix a clock-out; mechanics see their own. */
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
            Mechanic
            <select value={mechanicId} onChange={(e) => setMechanicId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Everyone</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Period
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </label>
        <span className="shiftTotal">
          <Clock size={14} /> {total.toFixed(1)} h total
        </span>
      </div>
      {shifts && shifts.length === 0 ? (
        <div className="subEmpty">
          <strong>No shifts in this period</strong>
          <span>Shifts appear here when mechanics clock in.</span>
        </div>
      ) : (
        <div className={`shiftTable ${isBoss ? "" : "own"}`} role="table" aria-label="Shifts">
          <div className="shiftRow shiftHead" role="row">
            {isBoss && <span role="columnheader">Mechanic</span>}
            <span role="columnheader">Date</span>
            <span role="columnheader">In</span>
            <span role="columnheader">Out</span>
            <span role="columnheader">Hours</span>
            <span role="columnheader">Clock-in place</span>
            {isBoss && <span role="columnheader" />}
          </div>
          {shifts?.map((shift) => (
            <div className={`shiftRow ${shift.open ? "open" : ""}`} role="row" key={shift.id}>
              {isBoss && (
                <strong role="cell" data-label="Mechanic">
                  {shift.mechanic}
                </strong>
              )}
              <span role="cell" data-label="Date">
                {day(shift.clocked_in_at)}
              </span>
              <span role="cell" data-label="In">
                {time(shift.clocked_in_at)}
              </span>
              <span role="cell" data-label="Out">
                {shift.open ? <em className="shiftBadge on">On shift</em> : time(shift.clocked_out_at)}
                {shift.edited && (
                  <small title={shift.original_clocked_out_at ? `Originally ${time(shift.original_clocked_out_at)}` : "Clock-out set by a manager"}>
                    Set by {shift.edited_by}
                    {shift.original_clocked_out_at ? ` (was ${time(shift.original_clocked_out_at)})` : ""}
                  </small>
                )}
              </span>
              <span role="cell" data-label="Hours">
                {shift.hours.toFixed(1)}
                {shift.long && (
                  <em className="shiftBadge warn" title="Longer than 12 hours: check the clock-out time">
                    <AlertTriangle size={11} /> Over 12 h
                  </em>
                )}
              </span>
              <span role="cell" data-label="Clock-in place">
                {shift.clock_in_location?.latitude != null ? (
                  <a href={mapLink(shift.clock_in_location.latitude, shift.clock_in_location.longitude)} target="_blank" rel="noreferrer">
                    <MapPin size={11} /> Map
                  </a>
                ) : (
                  <span className="muted">Not shared</span>
                )}
              </span>
              {isBoss && (
                <span role="cell" className="shiftAction">
                  {(shift.open || shift.long || shift.edited) && (
                    <button className="listAction" onClick={() => setFixing(shift)}>
                      {shift.open ? "Clock out" : "Fix clock-out"}
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
  const start = asDate(shift.clocked_in_at);
  const suggested = shift.clocked_out_at ? asDate(shift.clocked_out_at) : new Date(Math.min(Date.now(), start.getTime() + 8 * 3600000));
  const [value, setValue] = useState(localInput(suggested));
  const [error, setError] = useState("");
  const save = async (event: any) => {
    event.preventDefault();
    setError("");
    try {
      await correctShift(shift.id, new Date(value).toISOString());
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <Modal title={`Clock-out for ${shift.mechanic}`} icon={<Clock size={20} />} onClose={onClose}>
      <form className="form form-upgraded" onSubmit={save}>
        {error && <div className="error">{error}</div>}
        <p className="muted">
          Clocked in {day(shift.clocked_in_at)} at {time(shift.clocked_in_at)}.
          {shift.open ? " Setting a clock-out time ends this shift now and pauses any job in progress." : ""} The change is
          recorded with your name, and the mechanic is notified.
        </p>
        <div className="formGroup">
          <label htmlFor="field-clocked_out_at">Clock-out time</label>
          <input
            id="field-clocked_out_at"
            type="datetime-local"
            value={value}
            min={localInput(start)}
            max={localInput(new Date())}
            onChange={(e) => setValue(e.target.value)}
            required
          />
        </div>
        <button className="primary">Save clock-out</button>
      </form>
    </Modal>
  );
}
