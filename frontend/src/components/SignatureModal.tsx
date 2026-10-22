import { useEffect, useRef, useState } from "react";
import { PenLine } from "lucide-react";
import Modal from "./Modal";
import "./SignatureModal.css";

export type SignOff = { signature: { name: string; image: string } } | { no_signature_reason: string };

type Props = { jobTitle: string; busy?: boolean; error?: string; onSubmit: (signOff: SignOff) => void; onClose: () => void };

/** The customer signs on the mechanic's phone when the job is completed. */
export default function SignatureModal({ jobTitle, busy, error, onSubmit, onClose }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [name, setName] = useState("");
  const [absent, setAbsent] = useState(false);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState("");

  // Size the drawing surface to the screen's pixel density so strokes stay sharp.
  useEffect(() => {
    const element = canvas.current;
    if (!element || absent) return;
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = element.getBoundingClientRect();
    element.width = Math.round(width * ratio);
    element.height = Math.round(height * ratio);
    const pen = element.getContext("2d")!;
    pen.scale(ratio, ratio);
    pen.lineWidth = 2.6;
    pen.lineCap = "round";
    pen.lineJoin = "round";
    pen.strokeStyle = "#172033";
    setHasInk(false);
  }, [absent]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return [event.clientX - box.left, event.clientY - box.top];
  };
  const down = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const pen = event.currentTarget.getContext("2d")!;
    const [x, y] = point(event);
    pen.beginPath();
    pen.moveTo(x, y);
    pen.lineTo(x + 0.1, y + 0.1);
    pen.stroke();
  };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const pen = event.currentTarget.getContext("2d")!;
    const [x, y] = point(event);
    pen.lineTo(x, y);
    pen.stroke();
    setHasInk(true);
  };
  const up = () => {
    drawing.current = false;
  };
  const clear = () => {
    const element = canvas.current!;
    element.getContext("2d")!.clearRect(0, 0, element.width, element.height);
    setHasInk(false);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setProblem("");
    if (absent) {
      if (!reason.trim()) return setProblem("Say why the customer couldn't sign.");
      return onSubmit({ no_signature_reason: reason.trim() });
    }
    if (!name.trim()) return setProblem("Enter the name of the person signing.");
    if (!hasInk) return setProblem("Ask the customer to sign in the box.");
    onSubmit({ signature: { name: name.trim(), image: canvas.current!.toDataURL("image/png") } });
  };

  return (
    <Modal title="Customer sign-off" icon={<PenLine size={20} />} onClose={onClose}>
      <form className="signOff" onSubmit={submit}>
        <p className="muted">
          Completing <b>{jobTitle}</b>. Hand the phone to the customer to confirm the work.
        </p>
        {(problem || error) && <div className="error">{problem || error}</div>}
        {!absent ? (
          <>
            <label htmlFor="signer-name">Name of the person signing</label>
            <input id="signer-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="e.g. Grace Wanjiru" />
            <div className="signPad">
              <canvas
                ref={canvas}
                aria-label="Signature pad: sign with your finger"
                onPointerDown={down}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={up}
                onPointerLeave={up}
              />
              {!hasInk && <span className="signHint">Sign here</span>}
              <button type="button" className="link signClear" onClick={clear}>
                Clear
              </button>
            </div>
          </>
        ) : (
          <>
            <label htmlFor="no-sign-reason">Why couldn't the customer sign?</label>
            <textarea
              id="no-sign-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Site manager had left; machine handed over to security"
            />
          </>
        )}
        <label className="signAbsent">
          <input type="checkbox" checked={absent} onChange={(e) => setAbsent(e.target.checked)} /> Customer not present
        </label>
        <button className="primary" disabled={busy}>
          {busy ? "Completing…" : "Complete job"}
        </button>
      </form>
    </Modal>
  );
}
