import { useEffect, useId, useRef, type ReactNode } from "react";
import { useDialogFocus } from "../lib/useDialogFocus";
import { t } from "../i18n";

type Props = { title: string; icon?: ReactNode; onClose: () => void; children: ReactNode };

export default function Modal({ title, icon, onClose, children }: Props) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  useDialogFocus(box);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);
  return (
    <div className="overlay">
      <div className="modal" ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modalHead">
          <div className="modalTitle">
            {icon && <span className="modalIcon">{icon}</span>}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button className="closeBtn" onClick={onClose} aria-label={t("Close")}>
            ×
          </button>
        </div>
        <div className="modalContent">{children}</div>
      </div>
    </div>
  );
}
