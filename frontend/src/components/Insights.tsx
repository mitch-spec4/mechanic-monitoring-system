import { useEffect, useRef, useState, type ReactNode } from "react";
import { BarChart3, Clock, Coins, Download, FileSpreadsheet, FileText, Repeat, Timer } from "lucide-react";
import { downloadInsights, insights as loadInsights } from "../services/api";
import type { Insights as Data, TechnicianInsight } from "../services/types";
import { errorMessage, formatDate, formatDay, toZoneInput } from "../lib/format";
import { money } from "../lib/route";
import { mark, t } from "../i18n";
import { toast } from "./Feedback";
import { Loading } from "./States";
import "./Insights.css";

type Preset = "7" | "30" | "90" | "month" | "custom";
const PRESETS: [Preset, string][] = [
  ["7", mark("Last 7 days")],
  ["30", mark("Last 30 days")],
  ["90", mark("Last 90 days")],
  ["month", mark("This month")],
  ["custom", mark("Custom")],
];
const GENERAL = mark("General job");

// Days as "YYYY-MM-DD" on the company's calendar.
const today = () => toZoneInput(new Date()).slice(0, 10);
function addDays(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function rangeOf(preset: Preset, custom: { start: string; end: string }) {
  const end = today();
  if (preset === "custom") return custom;
  if (preset === "month") return { start: `${end.slice(0, 8)}01`, end };
  return { start: addDays(end, 1 - Number(preset)), end };
}

/** Hours with one decimal: "18 h", "2.5 h". */
const hours = (value: number) => t("{hours} h", { hours: Number.isInteger(value) ? value : value.toFixed(1) });

/**
 * Managers: how the team spent its time and how quickly jobs got done, for a range of days, with
 * the equipment that keeps failing. Everything below the filters follows the same range, and the
 * same numbers download as Excel or PDF.
 */
export default function Insights({ onOpenMachine }: { onOpenMachine?: (id: number) => void }) {
  const [preset, setPreset] = useState<Preset>("30");
  const [custom, setCustom] = useState(() => ({ start: addDays(today(), -29), end: today() }));
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<"" | "xlsx" | "pdf">("");
  const range = rangeOf(preset, custom);
  const asked = useRef(0);

  useEffect(() => {
    if (!range.start || !range.end) return;
    const ask = ++asked.current;
    setLoading(true);
    loadInsights(range.start, range.end)
      .then((result) => {
        if (ask !== asked.current) return;
        setData(result.insights);
        setError("");
      })
      .catch((problem) => ask === asked.current && setError(errorMessage(problem)))
      .finally(() => ask === asked.current && setLoading(false));
  }, [range.start, range.end]);

  const save = async (kind: "xlsx" | "pdf") => {
    setSaving(kind);
    try {
      const name = await downloadInsights(kind, range.start, range.end);
      toast(t("Saved {name}", { name }));
    } catch (problem) {
      toast(errorMessage(problem), "error");
    } finally {
      setSaving("");
    }
  };

  return (
    <section className="insights" aria-labelledby="insights-title">
      <div className="insightsHead">
        <div>
          <h2 id="insights-title">
            <BarChart3 size={18} /> {t("Insights")}
          </h2>
          <p className="muted">{data ? t("{start} to {end}", { start: formatDate(data.range.start), end: formatDate(data.range.end) }) : ""}</p>
        </div>
        <div className="insightsExports">
          <button className="secondary" disabled={Boolean(saving) || !data} onClick={() => save("xlsx")}>
            <FileSpreadsheet size={15} /> {saving === "xlsx" ? t("Preparing…") : t("Excel")}
          </button>
          <button className="secondary" disabled={Boolean(saving) || !data} onClick={() => save("pdf")}>
            <Download size={15} /> {saving === "pdf" ? t("Preparing…") : t("PDF")}
          </button>
        </div>
      </div>

      <div className="insightsFilters" role="group" aria-label={t("Date range")}>
        {PRESETS.map(([key, label]) => (
          <button key={key} className={preset === key ? "chosen" : ""} aria-pressed={preset === key} onClick={() => setPreset(key)}>
            {t(label)}
          </button>
        ))}
        {preset === "custom" && (
          <span className="insightsCustom">
            <label>
              {t("From")}
              <input type="date" value={custom.start} max={custom.end} onChange={(event) => event.target.value && setCustom({ ...custom, start: event.target.value })} />
            </label>
            <label>
              {t("To")}
              <input type="date" value={custom.end} min={custom.start} max={today()} onChange={(event) => event.target.value && setCustom({ ...custom, end: event.target.value })} />
            </label>
          </span>
        )}
      </div>

      {error && <div className="error">{error}</div>}
      {!data ? (
        !error && <Loading label={t("Working out the numbers…")} />
      ) : (
        <div className={`insightsBody ${loading ? "refreshing" : ""}`} aria-busy={loading}>
          <div className="insightsTiles">
            <Tile icon={<BarChart3 size={16} />} label={t("Jobs completed")} value={String(data.jobs.completed)} note={t("{created} created, {cancelled} cancelled", { created: data.jobs.created, cancelled: data.jobs.cancelled })} />
            <Tile
              icon={<Timer size={16} />}
              label={t("Time to complete")}
              value={data.jobs.median_hours_to_complete == null ? "–" : hours(data.jobs.median_hours_to_complete)}
              note={data.jobs.median_hours_to_complete == null ? t("No jobs completed yet") : t("Median, from the job's creation to its completion")}
            />
            <Tile
              icon={<Clock size={16} />}
              label={t("Hours on jobs")}
              value={hours(data.hours.on_jobs)}
              note={t("of {clocked} clocked in", { clocked: hours(data.hours.clocked) })}
            />
            <Tile
              icon={<Repeat size={16} />}
              label={t("Repeat faults")}
              value={String(data.repeat_faults.length)}
              note={t("Equipment fixed twice or more in 90 days")}
              warn={data.repeat_faults.length > 0}
            />
            {data.money && <MarginTile money={data.money} />}
          </div>

          <div className="insightsGrid">
            <CompletedChart data={data} />
            <TypesChart data={data} />
            <Technicians team={data.technicians} />
            <RepeatFaults data={data} onOpenMachine={onOpenMachine} />
          </div>
        </div>
      )}
    </section>
  );
}

function Tile({ icon, label, value, note, warn }: { icon: ReactNode; label: string; value: string; note: string; warn?: boolean }) {
  return (
    <div className={`insightsTile ${warn ? "warn" : ""}`}>
      <span className="insightsTileLabel">
        {icon} {label}
      </span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

/** What the completed jobs made: what was charged less labour (hours × pay rate) and parts. */
function MarginTile({ money: totals }: { money: NonNullable<Data["money"]> }) {
  const value = totals.margin_cents == null ? "–" : money(totals.margin_cents, totals.currency);
  const note =
    totals.charged_jobs === 0
      ? t("Add what you charged on a job's page to see the margin")
      : totals.incomplete_jobs > 0
        ? totals.incomplete_jobs === 1
          ? t("1 job is missing a pay rate or a part cost")
          : t("{count} jobs are missing a pay rate or a part cost", { count: totals.incomplete_jobs })
        : totals.charged_jobs === 1
          ? t("{charged} charged on 1 job", { charged: money(totals.charged_cents, totals.currency) })
          : t("{charged} charged on {jobs} jobs", { charged: money(totals.charged_cents, totals.currency), jobs: totals.charged_jobs });
  return <Tile icon={<Coins size={16} />} label={t("Margin")} value={value} note={note} warn={(totals.margin_cents ?? 0) < 0 || totals.incomplete_jobs > 0} />;
}

/** One column a day (a week for long ranges); the busiest is labelled, every column says its value on hover or focus. */
function CompletedChart({ data }: { data: Data }) {
  const points = data.completed_over_time;
  const most = Math.max(1, ...points.map((point) => point.count));
  const peak = points.reduce((best, point, index) => (point.count > points[best].count ? index : best), 0);
  const weekly = data.range.unit === "week";
  const when = (start: string) => (weekly ? t("Week of {date}", { date: formatDate(start) }) : formatDate(start));
  return (
    <section className="chartPanel insightsPanel wide">
      <div className="chartHeading">
        <h3>{weekly ? t("Jobs completed each week") : t("Jobs completed each day")}</h3>
        <span>{t("{count} total", { count: data.jobs.completed })}</span>
      </div>
      <div className="columnChart">
        <div className="columnAxis" aria-hidden="true">
          <span>{most}</span>
          <span>0</span>
        </div>
        <ol className="columns" aria-label={weekly ? t("Jobs completed each week") : t("Jobs completed each day")}>
          {points.map((point, index) => (
            <li
              key={point.start}
              tabIndex={0}
              className={index >= points.length / 2 ? "late" : ""}
              aria-label={t("{when}: {count} completed", { when: when(point.start), count: point.count })}
            >
              <span className="columnTip" role="tooltip">
                <b>{point.count}</b> {when(point.start)}
              </span>
              <i style={{ height: `${(point.count / most) * 100}%` }} className={point.count ? "" : "zero"} />
              {index === peak && point.count > 0 && <em style={{ bottom: `${(point.count / most) * 100}%` }}>{point.count}</em>}
            </li>
          ))}
        </ol>
      </div>
      <div className="columnLabels" aria-hidden="true">
        <span>{formatDate(points[0]?.start)}</span>
        <span>{formatDate(points[points.length - 1]?.start)}</span>
      </div>
      <details className="chartTable">
        <summary>{t("Show as a table")}</summary>
        <table>
          <thead>
            <tr>
              <th>{weekly ? t("Week starting") : t("Day")}</th>
              <th>{t("Jobs completed")}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.start}>
                <td>{formatDate(point.start)}</td>
                <td>{point.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

function TypesChart({ data }: { data: Data }) {
  const most = Math.max(1, ...data.by_type.map((row) => row.count));
  return (
    <section className="chartPanel insightsPanel">
      <div className="chartHeading">
        <h3>{t("Completed by job type")}</h3>
      </div>
      {data.by_type.length === 0 ? (
        <p className="muted insightsEmpty">{t("No jobs completed in these days.")}</p>
      ) : (
        <ul className="typeBars">
          {data.by_type.map((row) => (
            <li key={row.job_type}>
              <span>{row.job_type || t(GENERAL)}</span>
              <span className="typeTrack">
                <i style={{ width: `${(row.count / most) * 100}%` }} />
              </span>
              <b>{row.count}</b>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Each technician's clocked time as a track, filled by the part spent on jobs; the numbers are in the table. */
function Technicians({ team }: { team: TechnicianInsight[] }) {
  const longest = Math.max(1, ...team.map((row) => row.clocked_hours));
  return (
    <section className="chartPanel insightsPanel wide">
      <div className="chartHeading">
        <h3>{t("Hours per technician")}</h3>
        <span className="hoursLegend">
          <i className="onJobs" /> {t("On jobs")} <i className="clocked" /> {t("Clocked in")}
        </span>
      </div>
      {team.length === 0 ? (
        <p className="muted insightsEmpty">{t("No technicians yet.")}</p>
      ) : (
        <>
          <ul className="hoursBars">
            {team.map((row) => (
              <li key={row.id}>
                <span>{row.name}</span>
                <span className="hoursTrack" style={{ width: `${Math.max((row.clocked_hours / longest) * 100, row.clocked_hours ? 4 : 0)}%` }}>
                  <i style={{ width: `${row.clocked_hours ? Math.min((row.job_hours / row.clocked_hours) * 100, 100) : 0}%` }} />
                </span>
                <b>{t("{on} of {clocked}", { on: hours(row.job_hours), clocked: hours(row.clocked_hours) })}</b>
              </li>
            ))}
          </ul>
          <div className="tableScroll">
            <table className="insightsTable">
              <thead>
                <tr>
                  <th>{t("Technician")}</th>
                  <th>{t("Clocked in")}</th>
                  <th>{t("On jobs")}</th>
                  <th>{t("Share on jobs")}</th>
                  <th>{t("Jobs completed")}</th>
                  <th>{t("Time to complete")}</th>
                  <th>{t("Rating")}</th>
                </tr>
              </thead>
              <tbody>
                {team.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>{hours(row.clocked_hours)}</td>
                    <td>{hours(row.job_hours)}</td>
                    <td>{row.share_on_jobs == null ? "–" : `${row.share_on_jobs}%`}</td>
                    <td>{row.jobs_completed}</td>
                    <td>{row.median_hours_to_complete == null ? "–" : hours(row.median_hours_to_complete)}</td>
                    <td>{row.rating == null ? "–" : t("{rating} ({count})", { rating: row.rating.toFixed(1), count: row.reviews })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted insightsNote">{t("Time to complete is the median from a job's creation to its completion. Clocked and job hours count only time inside these days.")}</p>
        </>
      )}
    </section>
  );
}

function RepeatFaults({ data, onOpenMachine }: { data: Data; onOpenMachine?: (id: number) => void }) {
  return (
    <section className="chartPanel insightsPanel wide">
      <div className="chartHeading">
        <h3>{t("Repeat faults")}</h3>
        <span>{t("Fixed twice or more in the 90 days to {date}", { date: formatDate(data.range.end) })}</span>
      </div>
      {data.repeat_faults.length === 0 ? (
        <p className="muted insightsEmpty">{t("No equipment needed fixing twice in 90 days.")}</p>
      ) : (
        <div className="tableScroll">
          <table className="insightsTable">
            <thead>
              <tr>
                <th>{t("Equipment")}</th>
                <th>{t("Customer")}</th>
                <th>{t("Faults")}</th>
                <th>{t("Last fault")}</th>
              </tr>
            </thead>
            <tbody>
              {data.repeat_faults.map((row) => (
                <tr key={row.machine_id}>
                  <td>
                    {onOpenMachine ? (
                      <button className="titleLink" onClick={() => onOpenMachine(row.machine_id)}>
                        {row.name}
                      </button>
                    ) : (
                      row.name
                    )}
                    {row.equipment_type && <small> · {row.equipment_type}</small>}
                  </td>
                  <td>{row.customer ?? "–"}</td>
                  <td>{row.faults}</td>
                  <td>{row.last_fault ? formatDay(row.last_fault) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="insightsNote">
        <FileText size={12} /> {t("The Excel file also lists every completed job, with its times.")}
      </p>
    </section>
  );
}
