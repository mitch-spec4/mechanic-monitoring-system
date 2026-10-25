import { useEffect, useState, type FormEvent } from "react";
import { Building2, CalendarClock, ImageIcon, Languages, Moon, Trash2, Upload, UserRound } from "lucide-react";
import {
  apiUrl,
  changePassword,
  companySettings,
  removeLogo,
  uploadLogo,
  saveCompanySettings,
  saveLanguage,
  type BookingSettings,
  type CompanySettings,
  type CompanySettingsOptions,
  type User,
} from "../services/api";
import { errorMessage } from "../lib/format";
import { LocationSettings } from "./Shift";
import LanguagePicker from "./LanguagePicker";
import { toast } from "./Feedback";
import { ROLE_NAMES } from "./Sidebar";
import { setTheme, theme, THEMES, type Theme } from "../lib/theme";
import { mark, t } from "../i18n";
import { Loading } from "./States";
import { TwoFactorSettings } from "./TwoFactor";
import { CompanyDataSettings } from "./CompanyData";
import Field from "./Field";
import MapPicker from "./MapPicker";
import "./Forms.css";
import ServiceCatalog from "./ServiceCatalog";

type Props = { user: User; onUserChanged: (user: User) => void };

/** Settings and Profile: who you are, your language, the company's settings (managers), location
 *  sharing (technicians), your password and two-step sign-in, and the company's data (managers). */
export default function SettingsPanel({ user, onUserChanged }: Props) {
  return (
    <div className="settingsStack">
      <section className="settingsSection" aria-labelledby="settings-account">
        <h3 id="settings-account">
          <UserRound size={16} /> {t("Your account")}
        </h3>
        <div className="settingsView">
          <div>
            <span>{t("Full name")}</span>
            <strong>{user.name}</strong>
          </div>
          <div>
            <span>{t("Email")}</span>
            <strong>{user.email}</strong>
          </div>
          <div>
            <span>{t("Role")}</span>
            <strong>{t(ROLE_NAMES[user.role])}</strong>
          </div>
        </div>
      </section>
      <section className="settingsSection" aria-labelledby="settings-language">
        <h3 id="settings-language">
          <Languages size={16} /> {t("Language")}
        </h3>
        <p className="muted">{t("The app, your emails and your notifications use this language.")}</p>
        <LanguagePicker
          onChange={async (language) => {
            const data = await saveLanguage(language).catch((problem) => {
              toast(errorMessage(problem), "error");
              throw problem;
            });
            onUserChanged({ ...user, ...data.user });
          }}
        />
      </section>
      <AppearancePicker />
      {user.role === "boss" && <CompanySettingsForm user={user} onUserChanged={onUserChanged} />}
      {user.role === "boss" && <LogoSettings />}
      {user.role === "boss" && <BookingSettingsForm />}
      {user.role === "boss" && <ServiceCatalog />}
      {user.role === "mechanic" && <LocationSettings />}
      <ChangePassword />
      <TwoFactorSettings user={user} onUserChanged={onUserChanged} />
      {user.role === "boss" && <CompanyDataSettings user={user} onUserChanged={onUserChanged} />}
    </div>
  );
}

function AppearancePicker() {
  const [value, setValue] = useState<Theme>(theme());
  return (
    <section className="settingsSection" aria-labelledby="settings-appearance">
      <h3 id="settings-appearance">
        <Moon size={16} /> {t("Appearance")}
      </h3>
      <p className="muted">{t("Kept on this device.")}</p>
      <div className="themeChoices" role="radiogroup" aria-labelledby="settings-appearance">
        {(Object.keys(THEMES) as Theme[]).map((option) => (
          <label key={option} className={value === option ? "chosen" : ""}>
            <input
              type="radio"
              name="theme"
              value={option}
              checked={value === option}
              onChange={() => {
                setTheme(option);
                setValue(option);
              }}
            />
            {t(THEMES[option])}
          </label>
        ))}
      </div>
    </section>
  );
}

const UNIT_NAMES: Record<string, string> = { metric: "Metric (m, km)", imperial: "Imperial (ft, mi)" };

function CompanySettingsForm({ user, onUserChanged }: Props) {
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [options, setOptions] = useState<CompanySettingsOptions>({ timezones: [], currencies: [], units: [], languages: [] });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // An answer that comes after the form was left (or loaded twice) must not undo a change.
    let current = true;
    companySettings()
      .then((data) => {
        if (!current) return;
        setSettings(data.settings);
        setOptions({ timezones: data.timezones, currencies: data.currencies, units: data.units, languages: data.languages });
      })
      .catch((problem) => current && setError(errorMessage(problem)));
    return () => {
      current = false;
    };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!settings) return;
    setError("");
    setBusy(true);
    try {
      const { booking: _booking, ...company } = settings;
      const data = await saveCompanySettings(company);
      setSettings(data.settings);
      onUserChanged({ ...user, timezone: data.settings.timezone, units: data.settings.units });
      toast(t("Company settings saved"));
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  };

  const field = (key: Exclude<keyof CompanySettings, "booking" | "base">) => ({
    id: `field-${key}`,
    value: settings?.[key] ?? "",
    // From the latest state, so two quick changes (a field, then the map) never undo each other.
    onChange: (event: { target: { value: string } }) => {
      const { value } = event.target;
      setSettings((current) => current && { ...current, [key]: value });
    },
  });

  return (
    <form className="form form-upgraded settingsSection" onSubmit={submit} aria-labelledby="settings-company">
      <h3 id="settings-company">
        <Building2 size={16} /> {t("Company settings")}
      </h3>
      <p className="muted">{t("These apply to everyone in your company.")}</p>
      {error && <div className="error">{error}</div>}
      {!settings ? (
        !error && <Loading />
      ) : (
        <>
          <Field label={t("Time zone")} hint={t("Every time in the app and on reports is shown in this zone.")}>
            <select {...field("timezone")}>
              {options.timezones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("Company language")} hint={t("New people start in this language, and invitations are written in it. Everyone can still choose their own.")}>
            <select {...field("language")}>
              {options.languages.map((option) => (
                <option key={option.code} value={option.code} lang={option.code}>
                  {option.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="row">
            <Field label={t("Currency")}>
              <select {...field("currency")}>
                {options.currencies.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("Units")}>
              <select {...field("units")}>
                {options.units.map((unit) => (
                  <option key={unit} value={unit}>
                    {t(UNIT_NAMES[unit] ?? unit)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="formGroup">
            <span className="fieldTitle">{t("Where technicians start the day")}</span>
            <small className="muted fieldHint">{t("Your yard or office. Planned routes start here when a technician hasn't shared where they are.")}</small>
            <MapPicker value={settings.base} onChange={(base) => setSettings((current) => current && { ...current, base })} label={t("Map: where technicians start the day")} />
          </div>
          <button className="primary" disabled={busy}>
            {busy ? t("Saving…") : t("Save company settings")}
          </button>
        </>
      )}
    </form>
  );
}

// ISO weekdays: 1 is Monday.
const WEEKDAYS: [number, string][] = [
  [1, mark("Mon")],
  [2, mark("Tue")],
  [3, mark("Wed")],
  [4, mark("Thu")],
  [5, mark("Fri")],
  [6, mark("Sat")],
  [7, mark("Sun")],
];
type NumberSetting = Exclude<keyof BookingSettings, "days" | "start" | "end">;
const BOOKING_NUMBERS: [NumberSetting, string, string, number, number, number][] = [
  ["inspection_minutes", mark("Inspection length (minutes)"), mark("How long an inspection visit takes."), 15, 1440, 15],
  ["repair_minutes", mark("Repair length (minutes)"), mark("The usual repair. You can change it for each request after the inspection."), 15, 1440, 15],
  ["travel_minutes", mark("Travel time between visits (minutes)"), mark("Kept free before and after each visit of a technician."), 0, 240, 5],
  ["notice_hours", mark("Notice needed (hours)"), mark("The earliest a customer can book, from now."), 0, 336, 1],
  ["window_days", mark("How far ahead customers can book (days)"), mark("The latest a customer can book, from today."), 1, 90, 1],
];

/** When customers can book visits online, and how long visits take (managers). */
const LOGO_MB = 1;

/** The company's logo: on certificates and service reports (PNG or JPEG, up to 1 MB). */
function LogoSettings() {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    companySettings()
      .then((data) => current && setUrl(data.settings.logo_url))
      .catch((problem) => current && setError(errorMessage(problem)));
    return () => {
      current = false;
    };
  }, []);
  const pick = (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setError("");
    if (!["image/png", "image/jpeg"].includes(file.type)) return setError(t("The logo must be a PNG or JPEG image"));
    if (file.size > LOGO_MB * 1024 * 1024) return setError(t("The logo is too large; the limit is {size} MB.", { size: LOGO_MB }));
    const reader = new FileReader();
    reader.onload = async () => {
      setBusy(true);
      try {
        const data = await uploadLogo(String(reader.result));
        setUrl(data.settings.logo_url);
        toast(t("Logo saved"));
      } catch (problem) {
        setError(errorMessage(problem));
      } finally {
        setBusy(false);
      }
    };
    reader.readAsDataURL(file);
  };
  const clear = async () => {
    setBusy(true);
    try {
      setUrl((await removeLogo()).settings.logo_url);
      toast(t("Logo removed"));
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="settingsSection" aria-labelledby="settings-logo">
      <h3 id="settings-logo">
        <ImageIcon size={16} /> {t("Logo")}
      </h3>
      <p className="muted">{t("Shown on certificates and service reports. A PNG or JPEG of up to 1 MB; a wide logo on a white background prints best.")}</p>
      {error && <div className="error">{error}</div>}
      {url === undefined ? (
        !error && <Loading />
      ) : (
        <div className="logoRow">
          {url ? <img className="logoPreview" src={apiUrl(url)} alt={t("Your logo")} /> : <span className="logoEmpty">{t("No logo yet")}</span>}
          <label className={`secondary logoPick ${busy ? "disabled" : ""}`}>
            <Upload size={14} /> {url ? t("Change logo") : t("Add a logo")}
            <input type="file" accept="image/png,image/jpeg" hidden disabled={busy} onChange={(event) => pick(event.currentTarget)} />
          </label>
          {url && (
            <button type="button" className="iconButton delete" title={t("Remove logo")} aria-label={t("Remove logo")} disabled={busy} onClick={clear}>
              <Trash2 size={15} />
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function BookingSettingsForm() {
  const [booking, setBooking] = useState<BookingSettings | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    companySettings()
      .then((data) => current && setBooking(data.settings.booking))
      .catch((problem) => current && setError(errorMessage(problem)));
    return () => {
      current = false;
    };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!booking) return;
    setError("");
    setBusy(true);
    try {
      const data = await saveCompanySettings({ booking });
      setBooking(data.settings.booking);
      toast(t("Booking settings saved"));
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  };
  const toggleDay = (day: number) =>
    booking && setBooking({ ...booking, days: booking.days.includes(day) ? booking.days.filter((d) => d !== day) : [...booking.days, day].sort() });

  return (
    <form className="form form-upgraded settingsSection" onSubmit={submit} aria-labelledby="settings-booking">
      <h3 id="settings-booking">
        <CalendarClock size={16} /> {t("Online booking")}
      </h3>
      <p className="muted">{t("Customers pick a time for each visit from these hours. A time is offered while a technician is free, with travel time between visits.")}</p>
      {error && <div className="error">{error}</div>}
      {!booking ? (
        !error && <Loading />
      ) : (
        <>
          <fieldset className="dayChoices">
            <legend>{t("Days customers can book")}</legend>
            {WEEKDAYS.map(([day, label]) => (
              <label key={day} className={booking.days.includes(day) ? "chosen" : ""}>
                <input type="checkbox" checked={booking.days.includes(day)} onChange={() => toggleDay(day)} />
                {t(label)}
              </label>
            ))}
          </fieldset>
          <div className="row">
            <Field label={t("Bookings start")}>
              <input id="field-booking-start" type="time" step={900} value={booking.start} onChange={(e) => setBooking({ ...booking, start: e.target.value })} required />
            </Field>
            <Field label={t("Bookings end")}>
              <input id="field-booking-end" type="time" step={900} value={booking.end} onChange={(e) => setBooking({ ...booking, end: e.target.value })} required />
            </Field>
          </div>
          {BOOKING_NUMBERS.map(([key, label, hint, min, max, step]) => (
            <Field key={key} label={t(label)} hint={t(hint)}>
              <input
                id={`field-booking-${key}`}
                type="number"
                min={min}
                max={max}
                step={step}
                value={booking[key]}
                onChange={(e) => setBooking({ ...booking, [key]: Number(e.target.value) })}
                required
              />
            </Field>
          ))}
          <button className="primary" disabled={busy}>
            {busy ? t("Saving…") : t("Save booking settings")}
          </button>
        </>
      )}
    </form>
  );
}

function ChangePassword() {
  const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    setError("");
    if (data.new_password !== data.confirm_password) {
      setError(t("The new passwords do not match"));
      return;
    }
    try {
      await changePassword({ current_password: data.current_password, new_password: data.new_password });
      form.reset();
      toast(t("Password changed. You've been signed out on your other devices."));
    } catch (problem) {
      setError(errorMessage(problem));
    }
  };
  return (
    <form className="form form-upgraded changePassword settingsSection" onSubmit={submit}>
      <h3>{t("Change password")}</h3>
      {error && <div className="error">{error}</div>}
      <Field label={t("Current password")}>
        <input id="field-current_password" name="current_password" type="password" autoComplete="current-password" required />
      </Field>
      <Field label={t("New password")}>
        <input id="field-new_password" name="new_password" type="password" autoComplete="new-password" minLength={8} required />
      </Field>
      <Field label={t("Confirm new password")}>
        <input id="field-confirm_password" name="confirm_password" type="password" autoComplete="new-password" minLength={8} required />
      </Field>
      <button className="primary">{t("Update password")}</button>
    </form>
  );
}
