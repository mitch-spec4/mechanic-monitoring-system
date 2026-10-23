import { useEffect, useState, type FormEvent } from "react";
import { Building2, Languages, Moon, UserRound } from "lucide-react";
import { changePassword, companySettings, saveCompanySettings, saveLanguage, type CompanySettings, type User } from "../services/api";
import { errorMessage } from "../lib/format";
import { LocationSettings } from "./Shift";
import LanguagePicker from "./LanguagePicker";
import { toast } from "./Feedback";
import { ROLE_NAMES } from "./Sidebar";
import { setTheme, theme, THEMES, type Theme } from "../lib/theme";
import { t } from "../i18n";
import { Loading } from "./States";
import { TwoFactorSettings } from "./TwoFactor";
import { CompanyDataSettings } from "./CompanyData";

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
            <strong>{t(ROLE_NAMES[user.role] ?? user.role)}</strong>
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
  const [options, setOptions] = useState<{ timezones: string[]; currencies: string[]; units: string[] }>({ timezones: [], currencies: [], units: [] });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    companySettings()
      .then((data) => {
        setSettings(data.settings);
        setOptions({ timezones: data.timezones, currencies: data.currencies, units: data.units });
      })
      .catch((problem) => setError(errorMessage(problem)));
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!settings) return;
    setError("");
    setBusy(true);
    try {
      const data = await saveCompanySettings(settings);
      setSettings(data.settings);
      onUserChanged({ ...user, timezone: data.settings.timezone, units: data.settings.units });
      toast(t("Company settings saved"));
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  };

  const field = (key: keyof CompanySettings) => ({
    id: `field-${key}`,
    value: settings?.[key] ?? "",
    onChange: (event: { target: { value: string } }) => settings && setSettings({ ...settings, [key]: event.target.value }),
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
          <div className="formGroup">
            <label htmlFor="field-timezone">{t("Time zone")}</label>
            <select {...field("timezone")}>
              {options.timezones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <small className="muted">{t("Every time in the app and on reports is shown in this zone.")}</small>
          </div>
          <div className="row">
            <div className="formGroup">
              <label htmlFor="field-currency">{t("Currency")}</label>
              <select {...field("currency")}>
                {options.currencies.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
            </div>
            <div className="formGroup">
              <label htmlFor="field-units">{t("Units")}</label>
              <select {...field("units")}>
                {options.units.map((unit) => (
                  <option key={unit} value={unit}>
                    {t(UNIT_NAMES[unit] ?? unit)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button className="primary" disabled={busy}>
            {busy ? t("Saving…") : t("Save company settings")}
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
      <div className="formGroup">
        <label htmlFor="field-current_password">{t("Current password")}</label>
        <input id="field-current_password" name="current_password" type="password" autoComplete="current-password" required />
      </div>
      <div className="formGroup">
        <label htmlFor="field-new_password">{t("New password")}</label>
        <input id="field-new_password" name="new_password" type="password" autoComplete="new-password" minLength={8} required />
      </div>
      <div className="formGroup">
        <label htmlFor="field-confirm_password">{t("Confirm new password")}</label>
        <input id="field-confirm_password" name="confirm_password" type="password" autoComplete="new-password" minLength={8} required />
      </div>
      <button className="primary">{t("Update password")}</button>
    </form>
  );
}
