import { useState, type FormEvent } from "react";
import { Award, Camera, ClipboardCheck, FileDown, PenLine } from "lucide-react";
import Modal from "./Modal";
import Field from "./Field";
import SignatureModal, { type SignOff } from "./SignatureModal";
import { Waiting } from "./Offline";
import { toast } from "./Feedback";
import { apiUrl, type User } from "../services/api";
import type { FormAnswer, FormField, JobDetail, JobForm } from "../services/types";
import { queueForm } from "../offline/changes";
import { uploadMedia } from "../lib/media";
import { missingAnswers, visibleFields } from "../lib/forms";
import { errorMessage, formatDate, formatDateTime } from "../lib/format";
import { t } from "../i18n";
import "./Forms.css";

type Props = { job: JobDetail; user: User; reload: () => Promise<unknown> };

/** The forms on a job: staff fill them in (technicians offline too); customers get the certificates. */
export default function JobFormsCard({ job, user, reload }: Props) {
  const [open, setOpen] = useState<JobForm | null>(null);
  const forms = job.forms ?? [];
  if (!forms.length) return null;
  const finished = job.status === "Completed" || job.status === "Cancelled";
  // Technicians fill in their own jobs' forms; managers any job's, until it's finished.
  const editable = user.role === "mechanic" ? Boolean(job.can_edit) : user.role === "boss" && !finished;
  const current = open ? (forms.find((form) => form.form_id === open.form_id) ?? open) : null;

  if (user.role === "customer") {
    return (
      <section className="jobCard wide" aria-labelledby="job-certificates">
        <div className="jobCardHead">
          <h2 id="job-certificates">
            <Award size={16} /> {t("Certificates")}
          </h2>
        </div>
        <CertificateList items={forms.map((form) => ({ key: form.form_id, name: form.name, date: form.completed_at, url: form.pdf_url }))} />
      </section>
    );
  }

  return (
    <section className="jobCard wide jobForms" aria-labelledby="job-forms">
      <div className="jobCardHead">
        <h2 id="job-forms">
          <ClipboardCheck size={16} /> {t("Forms")}
        </h2>
        <span className="jobBadge">{forms.length}</span>
      </div>
      <ul className="formRows">
        {forms.map((form) => {
          const submission = form.submission;
          const completed = submission?.status === "completed";
          return (
            <li key={form.form_id}>
              <div>
                <strong>
                  {form.name}
                  {form.required && <span className="formTag required">{t("Required")}</span>}
                  {form.customer_visible && <span className="formTag">{t("Certificate")}</span>}
                </strong>
                <small>
                  {completed
                    ? submission?.completed_by
                      ? t("Completed by {name}", { name: submission.completed_by })
                      : t("Completed")
                    : submission
                      ? t("Started, not completed")
                      : t("Not started")}
                  {submission?.updated_at && !submission.pending ? ` · ${formatDateTime(submission.updated_at)}` : ""}
                </small>
                {submission?.pending && <Waiting />}
              </div>
              <div className="formRowActions">
                {form.pdf_url && !submission?.pending && (
                  <a className="listAction" href={apiUrl(form.pdf_url)} target="_blank" rel="noreferrer">
                    <FileDown size={13} /> {t("PDF")}
                  </a>
                )}
                <button type="button" className={editable && !completed ? "primary formOpen" : "listAction"} onClick={() => setOpen(form)}>
                  {editable ? (completed ? t("Open") : submission ? t("Continue") : t("Fill in")) : t("View")}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {current && (
        <FormFill
          job={job}
          form={current}
          editable={editable}
          onClose={() => setOpen(null)}
          onSaved={async () => {
            setOpen(null);
            await reload();
          }}
          reload={reload}
        />
      )}
    </section>
  );
}

/** Completed forms with their PDF: on a job for its customer, and on a piece of equipment. */
export function CertificateList({ items }: { items: { key: string | number; name: string; detail?: string; date: string | null; url: string | null }[] }) {
  return (
    <ul className="certificateList">
      {items.map((item) => (
        <li key={item.key}>
          <Award size={16} />
          <div>
            <strong>{item.name}</strong>
            <small>{[item.detail, item.date ? formatDate(item.date) : null].filter(Boolean).join(" · ")}</small>
          </div>
          {item.url && (
            <a className="listAction" href={apiUrl(item.url)} target="_blank" rel="noreferrer">
              <FileDown size={13} /> {t("PDF")}
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

type Draft = Record<string, string>;
type FillProps = { job: JobDetail; form: JobForm; editable: boolean; onClose: () => void; onSaved: () => Promise<void>; reload: () => Promise<unknown> };

const asText = (value: FormAnswer | undefined) => (value === undefined || typeof value === "object" ? "" : String(value));

/** Filling in a form: only the questions its answers so far call for. Saved as a draft, or
 *  completed once every required question shown is answered. Through the phone's queue, so it
 *  works with no signal; photos upload when the connection is good. */
export function FormFill({ job, form, editable, onClose, onSaved, reload }: FillProps) {
  const submission = form.submission;
  const fields = form.version?.fields ?? [];
  const [draft, setDraft] = useState<Draft>(() =>
    Object.fromEntries(Object.entries(submission?.answers ?? {}).flatMap(([id, value]) => (typeof value === "object" ? [] : [[id, String(value)]]))),
  );
  const [signed, setSigned] = useState<Record<string, { name: string; image: string }>>({});
  const [signing, setSigning] = useState<FormField | null>(null);
  const [uploading, setUploading] = useState("");
  const [problem, setProblem] = useState("");
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const answers: Record<string, FormAnswer> = { ...draft };
  for (const [id, value] of Object.entries(submission?.answers ?? {})) if (typeof value === "object") answers[id] = value;
  for (const [id, value] of Object.entries(signed)) answers[id] = { name: value.name };
  const shown = visibleFields(fields, answers);
  const photos = submission?.photos ?? {};
  const completed = submission?.status === "completed";
  const canPhoto = Boolean(job.can_upload && job.media_limits);
  // Only the job's technician uploads photos, while work is under way.
  const photoNote = ["In Progress", "Paused"].includes(job.status) ? t("The job's technician adds the photos.") : t("Photos can be added once work starts.");
  const set = (id: string, value: string) => {
    setDraft((current) => ({ ...current, [id]: value }));
    setMissing([]);
  };

  const save = async (complete: boolean) => {
    setProblem("");
    // A completed form stays complete: its required questions stay answered.
    if (complete || completed) {
      const gaps = missingAnswers(form, answers, photos);
      if (gaps.length) {
        setMissing(gaps);
        return;
      }
    }
    const sent: Record<string, unknown> = {};
    for (const field of fields) {
      if (["heading", "photo", "signature"].includes(field.type)) continue;
      sent[field.id] = draft[field.id] === undefined || draft[field.id] === "" ? null : draft[field.id];
    }
    for (const [id, value] of Object.entries(signed)) sent[id] = value;
    setBusy(true);
    try {
      const reply = await queueForm(job, form, { version_id: form.version?.id, answers: sent, complete });
      if (!reply) toast(t("Saved on this phone. It's sent when you're back online."), "info");
      else toast(complete ? t("Form completed") : t("Form saved"));
      await onSaved();
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const addPhoto = async (field: FormField, input: HTMLInputElement) => {
    const files = Array.from(input.files || []);
    input.value = "";
    if (!files.length || !job.media_limits) return;
    setProblem("");
    try {
      for (const file of files) {
        setUploading(field.id);
        const sent = await uploadMedia(job, "form_photo", file, job.media_limits, `${form.form_id}:${field.id}`);
        if (!sent) toast(t("Saved on this phone. It uploads when you have a good connection."), "info");
      }
      await reload();
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setUploading("");
    }
  };

  return (
    <Modal title={form.name} icon={<ClipboardCheck size={20} />} onClose={onClose}>
      <form className="form form-upgraded formFill" onSubmit={(event: FormEvent) => (event.preventDefault(), void save(false))}>
        {form.description && <p className="muted">{form.description}</p>}
        {completed && (
          <p className="formDone" role="status">
            {t("Completed by {name}", { name: submission?.completed_by || "—" })}
            {editable && ` ${t("You can still correct it until the job is finished.")}`}
          </p>
        )}
        {shown.map((field) => (
          <Question
            key={field.id}
            field={field}
            value={draft[field.id] ?? ""}
            editable={editable}
            onChange={(value) => set(field.id, value)}
            photos={photos[field.id] ?? []}
            canPhoto={canPhoto}
            photoNote={photoNote}
            uploading={uploading === field.id}
            onPhoto={(input) => addPhoto(field, input)}
            signature={signed[field.id] ? { name: signed[field.id].name, url: signed[field.id].image } : submission?.signatures?.[field.id]}
            onSign={() => setSigning(field)}
            answered={asText(answers[field.id])}
          />
        ))}
        {missing.length > 0 && (
          <div className="error" role="alert">
            {t("Answer every required question first: {questions}.", { questions: missing.join("; ") })}
          </div>
        )}
        {problem && (
          <div className="error" role="alert">
            {problem}
          </div>
        )}
        {editable && (
          <div className="formFillActions">
            <button type="submit" className="secondary" disabled={busy}>
              {busy ? t("Saving…") : t("Save")}
            </button>
            <button type="button" className="primary" disabled={busy} onClick={() => void save(true)}>
              {completed ? t("Save the completed form") : t("Complete the form")}
            </button>
          </div>
        )}
      </form>
      {signing && (
        <SignatureModal
          jobTitle={form.name}
          question={signing.label}
          onClose={() => setSigning(null)}
          onDone={() => setSigning(null)}
          onSubmit={async (signOff: SignOff) => {
            if ("signature" in signOff) setSigned((current) => ({ ...current, [signing.id]: signOff.signature }));
            setMissing([]);
          }}
        />
      )}
    </Modal>
  );
}

type QuestionProps = {
  field: FormField;
  value: string;
  editable: boolean;
  onChange: (value: string) => void;
  photos: { id: number; url: string; pending?: boolean }[];
  canPhoto: boolean;
  photoNote?: string;
  uploading: boolean;
  onPhoto: (input: HTMLInputElement) => void;
  signature?: { name: string | null; url: string | null };
  onSign: () => void;
  answered: string;
};

export function Question({ field, value, editable, onChange, photos, canPhoto, photoNote, uploading, onPhoto, signature, onSign, answered }: QuestionProps) {
  const id = `form-${field.id}`;
  if (field.type === "heading") return <h3 className="formHeading">{field.label}</h3>;
  const label = field.required ? `${field.label} *` : field.label;
  if (field.type === "yesno" || field.type === "choice") {
    const options = field.type === "yesno" ? [["yes", t("Yes")], ["no", t("No")]] : (field.options ?? []).map((option) => [option, option]);
    return (
      <fieldset className="formChoices" disabled={!editable}>
        <legend>{label}</legend>
        {field.help && <small className="formHelp">{field.help}</small>}
        <div>
          {options.map(([option, text]) => (
            <label key={option} className={value === option ? "chosen" : ""}>
              <input type="radio" name={id} value={option} checked={value === option} onChange={() => onChange(option)} />
              {text}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  if (field.type === "photo") {
    return (
      <div className="formPhotos">
        <span className="formLabel">{label}</span>
        {field.help && <small className="formHelp">{field.help}</small>}
        {photos.length > 0 && (
          <ul>
            {photos.map((photo) => (
              <li key={photo.id}>
                <img src={photo.url.startsWith("/api/") ? apiUrl(photo.url) : photo.url} alt={field.label} loading="lazy" />
                {photo.pending && <Waiting />}
              </li>
            ))}
          </ul>
        )}
        {editable &&
          (canPhoto ? (
            <label className="secondary formPhotoButton">
              <Camera size={15} /> {uploading ? t("Uploading…") : t("Add a photo")}
              <input type="file" accept="image/*" capture="environment" hidden disabled={uploading} onChange={(event) => onPhoto(event.currentTarget)} />
            </label>
          ) : (
            <small className="muted">{photoNote ?? t("Photos can be added once work starts.")}</small>
          ))}
      </div>
    );
  }
  if (field.type === "signature") {
    return (
      <div className="formSignature">
        <span className="formLabel">{label}</span>
        {signature?.url ? (
          <div className="signOffView">
            <img src={signature.url.startsWith("/api/") ? apiUrl(signature.url) : signature.url} alt={t("Signature of {name}", { name: signature.name || "" })} />
            <span>{t("Signed by {name}", { name: signature.name || "—" })}</span>
          </div>
        ) : (
          !editable && <small className="muted">{t("Not signed.")}</small>
        )}
        {editable && (
          <button type="button" className="secondary" onClick={onSign}>
            <PenLine size={15} /> {signature?.url ? t("Sign again") : t("Sign")}
          </button>
        )}
      </div>
    );
  }
  if (!editable) {
    return (
      <div className="formAnswer">
        <span className="formLabel">{field.label}</span>
        <p>{answered ? (field.type === "date" ? formatDate(answered) : answered) : "—"}</p>
      </div>
    );
  }
  const common = { id, value, onChange: (event: { target: { value: string } }) => onChange(event.target.value) };
  return (
    <Field label={label} hint={field.help}>
      {field.type === "text" && field.long ? (
        <textarea {...common} rows={3} />
      ) : field.type === "number" ? (
        <input {...common} type="number" inputMode="decimal" step="any" />
      ) : field.type === "date" ? (
        <input {...common} type="date" />
      ) : (
        <input {...common} />
      )}
    </Field>
  );
}
