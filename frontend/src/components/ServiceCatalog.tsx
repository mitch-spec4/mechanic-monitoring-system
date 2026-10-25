import { useEffect, useState, type FormEvent } from "react";
import { Plus, Trash2, Wrench } from "lucide-react";
import Modal from "./Modal";
import Field from "./Field";
import { EmptyState, Loading } from "./States";
import { confirmAction, toast } from "./Feedback";
import { TYPE_SUGGESTIONS } from "./MachineForms";
import { catalog, checklists, createService, deleteService, updateService, type ServiceDraft } from "../services/api";
import type { BookingType, CatalogService, Checklist } from "../services/types";
import { errorMessage, formatMinutes } from "../lib/format";
import { mark, t } from "../i18n";
import "./ServiceCatalog.css";

/** How customers book a service, as the catalog and its editor say it. */
export const BOOKING_NAMES: Record<BookingType, string> = {
  none: mark("Managers only"),
  inspection: mark("Customers book an inspection first"),
  direct: mark("Customers book it directly"),
};
const BOOKING_HINTS: Record<BookingType, string> = {
  none: mark("Customers don't see it. Managers create its jobs."),
  inspection: mark("A technician inspects first; then the customer books the work, at the service's length."),
  direct: mark("The customer picks a time for the work itself, as long as the service takes."),
};

/** The skills a job needs, as small tags. */
export function SkillTags({ skills }: { skills: string[] }) {
  if (!skills.length) return null;
  return (
    <span className="skillTags">
      {skills.map((skill) => (
        <span key={skill} className="skillTag">
          {skill}
        </span>
      ))}
    </span>
  );
}

/** Settings → Services you offer: what a job made from each one starts with, and which ones
 *  customers can book. */
export default function ServiceCatalog() {
  const [services, setServices] = useState<CatalogService[] | null>(null);
  const [lists, setLists] = useState<Checklist[]>([]);
  const [editing, setEditing] = useState<CatalogService | "new" | null>(null);
  const [error, setError] = useState("");
  const load = () =>
    Promise.all([catalog(), checklists()])
      .then(([found, templates]) => {
        setServices(found.services);
        setLists(templates.checklists);
      })
      .catch((problem) => setError(errorMessage(problem)));
  useEffect(() => {
    void load();
  }, []);

  return (
    <section className="settingsSection serviceCatalog" aria-labelledby="settings-services">
      <div className="serviceCatalogHead">
        <h3 id="settings-services">
          <Wrench size={16} /> {t("Services you offer")}
        </h3>
        <button type="button" className="secondary" onClick={() => setEditing("new")}>
          <Plus size={14} /> {t("Add a service")}
        </button>
      </div>
      <p className="muted">
        {t("A job made from a service starts with its name, description, checklist and time. Customers can book the ones you choose. No prices: quotes stay in the chat.")}
      </p>
      {error && <div className="error">{error}</div>}
      {!services ? (
        !error && <Loading />
      ) : services.length === 0 ? (
        <EmptyState icon={<Wrench size={26} />} title={t("No services yet")} text={t("Add the work you do most, such as a 500-hour generator service.")} />
      ) : (
        <ul className="serviceList">
          {services.map((service) => (
            <li key={service.id} className={service.active ? "" : "serviceOff"}>
              <div className="serviceText">
                <strong>
                  {service.name}
                  {!service.active && <span className="serviceOffTag">{t("Off")}</span>}
                </strong>
                <span className="serviceMeta">
                  {[
                    formatMinutes(service.duration_minutes),
                    service.equipment_type,
                    service.checklist ? t("Checklist: {name}", { name: service.checklist.job_type }) : null,
                    t(BOOKING_NAMES[service.booking]),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <SkillTags skills={service.skills} />
              </div>
              <button type="button" className="listAction" aria-label={t("Edit {name}", { name: service.name })} onClick={() => setEditing(service)}>
                {t("Edit")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <ServiceEditor
          service={editing === "new" ? null : editing}
          checklists={lists}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </section>
  );
}

type EditorProps = { service: CatalogService | null; checklists: Checklist[]; onClose: () => void; onSaved: () => void };

function ServiceEditor({ service, checklists: lists, onClose, onSaved }: EditorProps) {
  const [name, setName] = useState(service?.name ?? "");
  const [description, setDescription] = useState(service?.description ?? "");
  const [equipmentType, setEquipmentType] = useState(service?.equipment_type ?? "");
  const [checklistId, setChecklistId] = useState(service?.checklist ? String(service.checklist.id) : "");
  const [minutes, setMinutes] = useState(String(service?.duration_minutes ?? 60));
  const [skills, setSkills] = useState((service?.skills ?? []).join(", "));
  const [booking, setBooking] = useState<BookingType>(service?.booking ?? "none");
  const [active, setActive] = useState(service?.active ?? true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    const draft: ServiceDraft = {
      name,
      description: description.trim() || null,
      equipment_type: equipmentType.trim() || null,
      checklist_id: checklistId ? Number(checklistId) : null,
      duration_minutes: Number(minutes),
      skills: skills
        .split(",")
        .map((skill) => skill.trim())
        .filter(Boolean),
      booking,
      active,
    };
    try {
      if (service) await updateService(service.id, draft);
      else await createService(draft);
      toast(service ? t("Service saved") : t("Service added"));
      onSaved();
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!service) return;
    const ok = await confirmAction({
      title: t("Delete {name}?", { name: service.name }),
      message: t("A service jobs were made from can't be deleted: turn it off instead, and its jobs keep it."),
      confirmLabel: t("Delete service"),
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteService(service.id);
      toast(t("Service deleted"));
      onSaved();
    } catch (problem) {
      setError(errorMessage(problem));
    }
  };

  return (
    <Modal title={service ? t("Edit {name}", { name: service.name }) : t("Add a service")} icon={<Wrench size={20} />} onClose={onClose}>
      <form className="form form-upgraded serviceEditor" onSubmit={save}>
        {error && <div className="error">{error}</div>}
        <Field label={t("Name")}>
          <input id="field-service-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={t("e.g. {example}", { example: t("Generator 500-hour service") })} required />
        </Field>
        <Field label={t("Description")} optional hint={t("What the work includes. Customers see it when they book.")}>
          <textarea id="field-service-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </Field>
        <div className="row">
          <Field label={t("For equipment of type")} optional hint={t("Empty: any equipment.")}>
            <input id="field-service-type" list="service-equipment-types" value={equipmentType} onChange={(e) => setEquipmentType(e.target.value)} maxLength={80} />
          </Field>
          <Field label={t("Usual time (minutes)")} hint={formatMinutes(Number(minutes) || 0)}>
            <input id="field-service-minutes" type="number" min={15} max={1440} step={15} value={minutes} onChange={(e) => setMinutes(e.target.value)} required />
          </Field>
        </div>
        <datalist id="service-equipment-types">
          {TYPE_SUGGESTIONS.map((type) => (
            <option key={type} value={t(type)} />
          ))}
        </datalist>
        <Field label={t("Checklist")} optional hint={t("Its jobs get this checklist. Make checklists on the Checklists page.")}>
          <select id="field-service-checklist" value={checklistId} onChange={(e) => setChecklistId(e.target.value)}>
            <option value="">{t("No checklist")}</option>
            {lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.job_type}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Skills needed")} optional hint={t("Separated by commas, e.g. Electrical, Welding. Shown on its jobs.")}>
          <input id="field-service-skills" value={skills} onChange={(e) => setSkills(e.target.value)} />
        </Field>
        <fieldset className="choiceCards">
          <legend>{t("Online booking")}</legend>
          {(Object.keys(BOOKING_NAMES) as BookingType[]).map((kind) => (
            <label key={kind} className={booking === kind ? "chosen" : ""}>
              <input type="radio" name="booking" value={kind} checked={booking === kind} onChange={() => setBooking(kind)} />
              <span>
                <b>{t(BOOKING_NAMES[kind])}</b>
                <small>{t(BOOKING_HINTS[kind])}</small>
              </span>
            </label>
          ))}
        </fieldset>
        {service && (
          <label className="checkRow">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            {t("Offered (turn off to stop offering it; its jobs keep it)")}
          </label>
        )}
        <div className="serviceEditorActions">
          <button className="primary" disabled={busy}>
            {busy ? t("Saving…") : service ? t("Save service") : t("Add service")}
          </button>
          {service && (
            <button type="button" className="iconButton delete" title={t("Delete service")} aria-label={t("Delete service")} onClick={remove}>
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
