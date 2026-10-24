import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { t } from "../i18n";
import { useDialogFocus } from "../lib/useDialogFocus";
import "./Feedback.css";

/**
 * Toasts and confirm dialogs, callable from anywhere:
 *   toast(t("Saved"))                                     a short note that fades away
 *   if (await confirmAction({ message, confirmLabel, danger: true })) ...   instead of window.confirm()
 * <FeedbackHost /> is mounted once, at the top of the app.
 */
type Tone = "success" | "error" | "info";
type Toast = { id: number; message: string; tone: Tone };
type Confirm = { message: string; title?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean; resolve: (ok: boolean) => void };

let showToast: (toast: Omit<Toast, "id">) => void = () => {};
let askConfirm: (request: Confirm) => void = (request) => request.resolve(window.confirm(request.message));

export function toast(message: string, tone: Tone = "success") {
  showToast({ message, tone });
}

export function confirmAction(options: Omit<Confirm, "resolve">) {
  return new Promise<boolean>((resolve) => askConfirm({ ...options, resolve }));
}

const ICONS = { success: CheckCircle2, error: AlertTriangle, info: Info };

export function FeedbackHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [request, setRequest] = useState<Confirm | null>(null);
  const nextId = useRef(0);

  useEffect(() => {
    showToast = (toast) => {
      const id = ++nextId.current;
      setToasts((current) => [...current.slice(-2), { ...toast, id }]);
      window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), toast.tone === "error" ? 7000 : 4000);
    };
    askConfirm = setRequest;
    return () => {
      showToast = () => {};
    };
  }, []);

  const answer = (ok: boolean) => {
    request?.resolve(ok);
    setRequest(null);
  };

  return (
    <>
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map(({ id, message, tone }) => {
          const Icon = ICONS[tone];
          return (
            <div key={id} className={`toast ${tone}`}>
              <Icon size={17} aria-hidden="true" />
              <span>{message}</span>
              <button aria-label={t("Dismiss")} onClick={() => setToasts((current) => current.filter((item) => item.id !== id))}>
                <X size={15} />
              </button>
            </div>
          );
        })}
      </div>
      {request && <ConfirmDialog request={request} answer={answer} />}
    </>
  );
}

function ConfirmDialog({ request, answer }: { request: Confirm; answer: (ok: boolean) => void }) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  // For deleting or cancelling, Enter keeps things as they are.
  useDialogFocus(box, request.danger ? keep : confirm);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => event.key === "Escape" && answer(false);
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);
  return (
    <div className="overlay confirmOverlay" onClick={(event) => event.target === event.currentTarget && answer(false)}>
      <div className="confirmDialog" ref={box} role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>{request.title ?? t("Are you sure?")}</h2>
        <p>{request.message}</p>
        <div className="confirmActions">
          <button ref={keep} className="secondary" onClick={() => answer(false)}>
            {request.cancelLabel ?? t("Keep it")}
          </button>
          <button ref={confirm} className={request.danger ? "dangerButton" : "primary"} onClick={() => answer(true)}>
            {request.confirmLabel ?? t("Yes")}
          </button>
        </div>
      </div>
    </div>
  );
}
