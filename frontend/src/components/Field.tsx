import { Children, cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { t } from "../i18n";

type ControlProps = { id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean | "true" | "false" };

type Props = {
  /** What the field is, shown above it (or around it, with `wrap`). */
  label: ReactNode;
  /** The input, select or textarea. Its id is kept, or one is made up. */
  children: ReactElement<ControlProps>;
  /** A line of help under the field. */
  hint?: ReactNode;
  /** What's wrong with the value, shown under the field and read out. */
  error?: string;
  /** Says "(optional)" next to the label, for fields that can stay empty. */
  optional?: boolean;
  /** The label wraps the field instead of sitting above it (the sign-in and sign-up pages). */
  wrap?: boolean;
  className?: string;
};

/** One form field: a visible label tied to its control, an optional hint and an error message,
 *  both linked to the control so screen readers read them with it. Every form uses this. */
export default function Field({ label, children, hint, error, optional, wrap, className = "" }: Props) {
  const fallbackId = `field-${useId().replace(/:/g, "")}`;
  const control = Children.only(children);
  if (!isValidElement<ControlProps>(control)) return null;
  const id = control.props.id ?? fallbackId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [control.props["aria-describedby"], hintId, errorId].filter(Boolean).join(" ") || undefined;
  const field = cloneElement(control, { id, "aria-describedby": describedBy, ...(error ? { "aria-invalid": true } : {}) });
  const title = (
    <>
      {label}
      {optional && <span className="fieldOptional"> {t("(optional)")}</span>}
    </>
  );
  const notes = (
    <>
      {hint && (
        <small id={hintId} className="muted fieldHint">
          {hint}
        </small>
      )}
      {error && (
        <small id={errorId} className="fieldError" role="alert">
          {error}
        </small>
      )}
    </>
  );
  if (wrap) {
    return (
      <label className={className || undefined}>
        {title}
        {field}
        {notes}
      </label>
    );
  }
  return (
    <div className={`formGroup ${className}`.trim()}>
      <label htmlFor={id}>{title}</label>
      {field}
      {notes}
    </div>
  );
}
