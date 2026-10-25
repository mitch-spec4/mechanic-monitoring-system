import { useEffect, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, ClipboardCheck, Eye, Plus, Trash2 } from "lucide-react";
import Modal from "./Modal";
import Field from "./Field";
import { EmptyState, Loading } from "./States";
import { confirmAction, toast } from "./Feedback";
import { Question } from "./JobFormsCard";
import { catalog, checklists, createForm, deleteForm, listForms, updateForm, type FormDraft } from "../services/api";
import type { CatalogService, CustomForm, FormField, FormFieldType } from "../services/types";
import { visibleFields } from "../lib/forms";
import { errorMessage } from "../lib/format";
import { mark, t } from "../i18n";
import "./ChecklistManager.css";
import "./ServiceCatalog.css";
import "./Forms.css";

export const FIELD_TYPES: Record<FormFieldType, string> = {
  heading: mark("Section heading"),
  text: mark("Text"),
  number: mark("Number"),
  yesno: mark("Yes / no"),
  choice: mark("Choice"),
  date: mark("Date"),
  photo: mark("Photo"),
  signature: mark("Signature"),
};
const CONDITION_TYPES: FormFieldType[] = ["yesno", "choice"];

let made = 0;
/** A new question's ID: stable from then on, so answers stay with their question. */
const newId = () => `q${Date.now().toString(36)}${(made++).toString(36)}`;

/** The Forms page: forms the company builds (safety checks, handover sheets, certificates), the
 *  jobs that get them, and their questions. */
export default function FormsManager() {
  const [forms, setForms] = useState<CustomForm[] | null>(null);
  const [jobTypes, setJobTypes] = useState<string[]>([]);
  const [services, setServices] = useState<CatalogService[]>([]);
  const [editing, setEditing] = useState<CustomForm | "new" | null>(null);
  const [error, setError] = useState("");
  const load = () =>
    Promise.all([listForms(), checklists(), catalog()])
      .then(([found, lists, offered]) => {
        setForms(found.forms);
        setJobTypes(lists.checklists.map((list) => list.job_type));
        setServices(offered.services);
      })
      .catch((problem) => setError(errorMessage(problem)));
  useEffect(() => {
    void load();
  }, []);

  if (!forms) return error ? <div className="error">{error}</div> : <Loading />;
  const serviceName = (id: number) => services.find((service) => service.id === id)?.name;
  return (
    <div className="formsManager">
      {error && <div className="error">{error}</div>}
      <div className="checklistIntro">
        <p className="muted">
          {t("Build the forms your technicians fill in on jobs: safety checks, handover sheets, inspection certificates. Each job type or service you choose gets the form; a completed form becomes a PDF with your logo.")}
        </p>
        <button className="primary" onClick={() => setEditing("new")}>
          <Plus size={14} /> {t("New form")}
        </button>
      </div>
      {forms.length === 0 ? (
        <EmptyState icon={<ClipboardCheck size={26} />} title={t("No forms yet")} text={t("Start with the check your team does most, such as a site safety check.")} />
      ) : (
        <div className="checklistCards">
          {forms.map((form) => {
            const attached = [...form.job_types, ...form.service_ids.map(serviceName).filter(Boolean)];
            return (
              <article key={form.id} className="checklistCard formCard">
                <div className="checklistCardHead">
                  <h3>
                    <ClipboardCheck size={16} /> {form.name}
                  </h3>
                  <span>{t("Version {number}", { number: form.version?.number ?? 1 })}</span>
                </div>
                <p className="formCardMeta">
                  {form.required && <span className="formTag required">{t("Required")}</span>}
                  {form.customer_visible && <span className="formTag">{t("Certificate")}</span>}
                  {!form.active && <span className="serviceOffTag">{t("Off")}</span>}
                </p>
                <small className="muted">
                  {t("{count} questions", { count: (form.version?.fields ?? []).filter((field) => field.type !== "heading").length })} ·{" "}
                  {attached.length ? t("On: {list}", { list: attached.join(", ") }) : t("Not on any jobs yet")}
                </small>
                <small className="muted">{form.submissions === 1 ? t("Filled in on 1 job") : t("Filled in on {count} jobs", { count: form.submissions })}</small>
                <div className="checklistCardFoot">
                  <button className="listAction" onClick={() => setEditing(form)}>
                    {t("Edit")}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {editing && (
        <FormEditor
          form={editing === "new" ? null : editing}
          jobTypes={jobTypes}
          services={services}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

type EditorProps = { form: CustomForm | null; jobTypes: string[]; services: CatalogService[]; onClose: () => void; onSaved: () => void };
type Draft = FormField & { optionsText?: string };

const toDraft = (field: FormField): Draft => ({ ...field, optionsText: (field.options ?? []).join("\n") });
const STARTER: Draft[] = [
  { id: "q1", type: "yesno", label: "", required: true },
];

function FormEditor({ form, jobTypes, services, onClose, onSaved }: EditorProps) {
  const [name, setName] = useState(form?.name ?? "");
  const [description, setDescription] = useState(form?.description ?? "");
  const [types, setTypes] = useState<string[]>(form?.job_types ?? []);
  const [serviceIds, setServiceIds] = useState<number[]>(form?.service_ids ?? []);
  const [required, setRequired] = useState(form?.required ?? false);
  const [certificate, setCertificate] = useState(form?.customer_visible ?? false);
  const [active, setActive] = useState(form?.active ?? true);
  const [fields, setFields] = useState<Draft[]>(form?.version?.fields.map(toDraft) ?? STARTER.map((field) => ({ ...field, id: newId() })));
  const [adding, setAdding] = useState<FormFieldType>("text");
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const typeChoices = Array.from(new Set([...jobTypes, ...types]));

  const update = (index: number, change: Partial<Draft>) => setFields((rows) => rows.map((row, i) => (i === index ? { ...row, ...change } : row)));
  const move = (index: number, by: number) =>
    setFields((rows) => {
      const next = [...rows];
      const [row] = next.splice(index, 1);
      next.splice(index + by, 0, row);
      return next;
    });
  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  const built = (): FormField[] =>
    fields.map(({ optionsText, ...field }) => {
      const clean: FormField = { id: field.id, type: field.type, label: field.label.trim() };
      if (field.help?.trim()) clean.help = field.help.trim();
      if (field.type !== "heading") clean.required = Boolean(field.required);
      if (field.type === "text" && field.long) clean.long = true;
      if (field.type === "choice") clean.options = (optionsText ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
      if (field.show_if) clean.show_if = field.show_if;
      return clean;
    });

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    const draft: FormDraft = { name, description: description.trim() || null, job_types: types, service_ids: serviceIds, required, customer_visible: certificate, active, fields: built() };
    try {
      if (form) await updateForm(form.id, draft);
      else await createForm(draft);
      toast(form ? t("Form saved") : t("Form added"));
      onSaved();
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!form) return;
    const ok = await confirmAction({
      title: t("Delete {name}?", { name: form.name }),
      message: t("A form filled in on jobs can't be deleted: turn it off instead, and the jobs keep what was filled in."),
      confirmLabel: t("Delete form"),
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteForm(form.id);
      toast(t("Form deleted"));
      onSaved();
    } catch (problem) {
      setError(errorMessage(problem));
    }
  };

  return (
    <Modal title={form ? t("Edit {name}", { name: form.name }) : t("New form")} icon={<ClipboardCheck size={20} />} onClose={onClose}>
      <form className="form form-upgraded formEditor" onSubmit={save}>
        {error && <div className="error">{error}</div>}
        <Field label={t("Name")}>
          <input id="field-form-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={t("e.g. {example}", { example: t("Site safety check") })} required />
        </Field>
        <Field label={t("Description")} optional>
          <textarea id="field-form-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </Field>
        <fieldset className="formAttach">
          <legend>{t("Jobs that get it")}</legend>
          {typeChoices.length === 0 && services.length === 0 && <small className="muted">{t("Make checklists (job types) or services first.")}</small>}
          {typeChoices.map((type) => (
            <label key={`type-${type}`} className="checkRow">
              <input type="checkbox" checked={types.includes(type)} onChange={() => setTypes((list) => toggle(list, type))} />
              {t("Job type: {name}", { name: type })}
            </label>
          ))}
          {services.map((service) => (
            <label key={`service-${service.id}`} className="checkRow">
              <input type="checkbox" checked={serviceIds.includes(service.id)} onChange={() => setServiceIds((list) => toggle(list, service.id))} />
              {t("Service: {name}", { name: service.name })}
            </label>
          ))}
        </fieldset>
        <label className="checkRow">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          {t("Required: it must be completed before the job can be finished")}
        </label>
        <label className="checkRow">
          <input type="checkbox" checked={certificate} onChange={(e) => setCertificate(e.target.checked)} />
          {t("A certificate: the customer can see and download it once it's completed")}
        </label>
        {form && (
          <label className="checkRow">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            {t("In use (turn off to stop adding it to jobs)")}
          </label>
        )}

        <div className="formQuestionsHead">
          <h3>{t("Questions")}</h3>
          <button type="button" className="listAction" onClick={() => setPreview((shown) => !shown)}>
            <Eye size={13} /> {preview ? t("Back to editing") : t("Preview")}
          </button>
        </div>
        {form && (form.submissions ?? 0) > 0 && (
          <small className="muted">{t("Changing the questions makes a new version. Forms already filled in keep the questions they answered.")}</small>
        )}
        {preview ? (
          <Preview fields={built()} />
        ) : (
          <>
            <ol className="questionList">
              {fields.map((field, index) => (
                <QuestionEditor
                  key={field.id}
                  field={field}
                  index={index}
                  count={fields.length}
                  earlier={fields.slice(0, index).filter((other) => CONDITION_TYPES.includes(other.type))}
                  onChange={(change) => update(index, change)}
                  onMove={(by) => move(index, by)}
                  onRemove={() => setFields((rows) => rows.filter((_, i) => i !== index))}
                />
              ))}
            </ol>
            <div className="questionAdd">
              <select aria-label={t("Type of question to add")} value={adding} onChange={(e) => setAdding(e.target.value as FormFieldType)}>
                {(Object.keys(FIELD_TYPES) as FormFieldType[]).map((type) => (
                  <option key={type} value={type}>
                    {t(FIELD_TYPES[type])}
                  </option>
                ))}
              </select>
              <button type="button" className="secondary" onClick={() => setFields((rows) => [...rows, { id: newId(), type: adding, label: "", required: adding !== "heading" ? false : undefined }])}>
                <Plus size={14} /> {t("Add question")}
              </button>
            </div>
          </>
        )}
        <div className="serviceEditorActions">
          <button className="primary" disabled={busy}>
            {busy ? t("Saving…") : form ? t("Save form") : t("Add form")}
          </button>
          {form && (
            <button type="button" className="iconButton delete" title={t("Delete form")} aria-label={t("Delete form")} onClick={remove}>
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

type QuestionEditorProps = {
  field: Draft;
  index: number;
  count: number;
  earlier: Draft[];
  onChange: (change: Partial<Draft>) => void;
  onMove: (by: number) => void;
  onRemove: () => void;
};

function QuestionEditor({ field, index, count, earlier, onChange, onMove, onRemove }: QuestionEditorProps) {
  const number = index + 1;
  const source = earlier.find((other) => other.id === field.show_if?.field);
  const values = (other?: Draft) =>
    other?.type === "yesno"
      ? [["yes", t("Yes")], ["no", t("No")]]
      : (other?.optionsText ?? "")
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((option) => [option, option]);
  return (
    <li className={`questionEditor ${field.type === "heading" ? "isHeading" : ""}`}>
      <div className="questionTop">
        <span className="questionNumber">{number}</span>
        <select aria-label={t("Type of question {number}", { number })} value={field.type} onChange={(e) => onChange({ type: e.target.value as FormFieldType, show_if: field.show_if })}>
          {(Object.keys(FIELD_TYPES) as FormFieldType[]).map((type) => (
            <option key={type} value={type}>
              {t(FIELD_TYPES[type])}
            </option>
          ))}
        </select>
        <div className="questionMoves">
          <button type="button" className="iconButton" aria-label={t("Move question {number} up", { number })} disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp size={14} />
          </button>
          <button type="button" className="iconButton" aria-label={t("Move question {number} down", { number })} disabled={index === count - 1} onClick={() => onMove(1)}>
            <ArrowDown size={14} />
          </button>
          <button type="button" className="iconButton delete" aria-label={t("Remove question {number}", { number })} onClick={onRemove}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <input
        aria-label={field.type === "heading" ? t("Heading {number}", { number }) : t("Question {number}", { number })}
        value={field.label}
        onChange={(e) => onChange({ label: e.target.value })}
        placeholder={field.type === "heading" ? t("e.g. {example}", { example: t("Before you start") }) : t("What to ask")}
        maxLength={200}
        required
      />
      {field.type === "choice" && (
        <textarea
          aria-label={t("Choices for question {number}, one per line", { number })}
          value={field.optionsText ?? ""}
          onChange={(e) => onChange({ optionsText: e.target.value })}
          placeholder={t("One choice per line")}
          rows={3}
        />
      )}
      {field.type !== "heading" && (
        <div className="questionOptions">
          <label className="checkRow">
            <input type="checkbox" checked={Boolean(field.required)} onChange={(e) => onChange({ required: e.target.checked })} />
            {t("Required")}
          </label>
          {field.type === "text" && (
            <label className="checkRow">
              <input type="checkbox" checked={Boolean(field.long)} onChange={(e) => onChange({ long: e.target.checked })} />
              {t("Long answer")}
            </label>
          )}
        </div>
      )}
      {earlier.length > 0 && (
        <div className="questionRule">
          <select
            aria-label={t("When to ask question {number}", { number })}
            value={field.show_if?.field ?? ""}
            onChange={(e) => {
              const other = earlier.find((candidate) => candidate.id === e.target.value);
              onChange({ show_if: other ? { field: other.id, equals: values(other)[0]?.[0] ?? "" } : undefined });
            }}
          >
            <option value="">{t("Always ask")}</option>
            {earlier.map((other) => (
              <option key={other.id} value={other.id}>
                {t("Only when “{question}” is…", { question: other.label || t("question {number}", { number: earlier.indexOf(other) + 1 }) })}
              </option>
            ))}
          </select>
          {source && (
            <select
              aria-label={t("Answer that shows question {number}", { number })}
              value={field.show_if?.equals ?? ""}
              onChange={(e) => onChange({ show_if: { field: source.id, equals: e.target.value } })}
            >
              {values(source).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </li>
  );
}

/** The form as a technician sees it, to try the show/hide rules. Nothing is saved. */
function Preview({ fields }: { fields: FormField[] }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  return (
    <div className="formFill formPreview">
      {visibleFields(fields, draft).map((field) => (
        <Question
          key={field.id}
          field={field}
          value={draft[field.id] ?? ""}
          editable
          onChange={(value) => setDraft((current) => ({ ...current, [field.id]: value }))}
          photos={[]}
          canPhoto={false}
          uploading={false}
          onPhoto={() => undefined}
          onSign={() => undefined}
          answered=""
        />
      ))}
    </div>
  );
}
