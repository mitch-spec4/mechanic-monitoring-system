import { useEffect, useRef, useState } from "react";
import { Check, CheckCircle2, Eraser, PenLine, Undo2, UserX, X } from "lucide-react";
import { errorMessage } from "../lib/format";
import "./SignatureModal.css";

export type SignOff = { signature: { name: string; image: string } } | { no_signature_reason: string };

type Props = {
  jobTitle: string;
  /** Short facts about the job shown to the customer: customer, machine, photos, checklist... */
  facts?: string[];
  /** Completes the job; rejects with the server's error, which is shown on the sheet. */
  onSubmit: (signOff: SignOff) => Promise<unknown>;
  /** Called after the job is completed and the celebration has played. */
  onDone: () => void;
  onClose: () => void;
};

type Point = { x: number; y: number; w: number };
type Stroke = { color: string; points: Point[] };
type Pen = { x: number; y: number; t: number; w: number };

const INKS = [
  { color: "#172033", label: "Black ink" },
  { color: "#1d4ed8", label: "Blue ink" },
];
const REASONS = ["Customer had left the site", "Site closed for the day", "Approved by phone", "Handed over to security"];
const CELEBRATE_MS = 2100;
const CONFETTI = Array.from({ length: 26 }, (_, i) => i);

// Faster strokes draw thinner lines, like a real pen.
const widthFor = (distance: number, ms: number) => Math.max(1.3, Math.min(4.4, 4.4 - (distance / Math.max(ms, 1)) * 1.7));

function drawStroke(pen: CanvasRenderingContext2D, stroke: Stroke, from = 0) {
  const points = stroke.points;
  pen.strokeStyle = stroke.color;
  pen.fillStyle = stroke.color;
  if (points.length === 1) {
    pen.beginPath();
    pen.arc(points[0].x, points[0].y, points[0].w / 2, 0, Math.PI * 2);
    pen.fill();
    return;
  }
  // Curves through the midpoints keep the line smooth however fast the finger moves.
  for (let i = Math.max(1, from); i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const before = points[i - 2] || a;
    pen.beginPath();
    pen.lineWidth = (a.w + b.w) / 2;
    pen.moveTo((before.x + a.x) / 2, (before.y + a.y) / 2);
    pen.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
    pen.stroke();
  }
}

/** The signature as a PNG cropped to the ink, so a tall phone pad doesn't print as a tall empty box. */
function exportSignature(strokes: Stroke[]) {
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { points } of strokes) {
    for (const { x, y, w } of points) {
      left = Math.min(left, x - w);
      top = Math.min(top, y - w);
      right = Math.max(right, x + w);
      bottom = Math.max(bottom, y + w);
    }
  }
  const margin = 10;
  const scale = 2;
  const out = document.createElement("canvas");
  out.width = Math.ceil((right - left + margin * 2) * scale);
  out.height = Math.ceil((bottom - top + margin * 2) * scale);
  const pen = out.getContext("2d")!;
  pen.setTransform(scale, 0, 0, scale, (margin - left) * scale, (margin - top) * scale);
  pen.lineCap = "round";
  pen.lineJoin = "round";
  strokes.forEach((stroke) => drawStroke(pen, stroke));
  return out.toDataURL("image/png");
}

/** The customer signs on the mechanic's phone when the job is completed. */
export default function SignatureModal({ jobTitle, facts = [], onSubmit, onDone, onClose }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const last = useRef<Pen | null>(null);
  const [inkCount, setInkCount] = useState(0);
  const [ink, setInk] = useState(INKS[0].color);
  const [name, setName] = useState("");
  const [absent, setAbsent] = useState(false);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"signed" | "recorded" | null>(null);
  const hasInk = inkCount > 0;

  const redraw = () => {
    const element = canvas.current;
    if (!element) return;
    const pen = element.getContext("2d")!;
    pen.clearRect(0, 0, element.width, element.height);
    strokes.current.forEach((stroke) => drawStroke(pen, stroke));
  };

  // Size the drawing surface to the screen's pixel density so strokes stay sharp, and keep the
  // signature when the phone is rotated.
  useEffect(() => {
    const element = canvas.current;
    if (!element || absent) return;
    const fit = () => {
      const ratio = window.devicePixelRatio || 1;
      const { width, height } = element.getBoundingClientRect();
      element.width = Math.round(width * ratio);
      element.height = Math.round(height * ratio);
      const pen = element.getContext("2d")!;
      pen.setTransform(ratio, 0, 0, ratio, 0, 0);
      pen.lineCap = "round";
      pen.lineJoin = "round";
      redraw();
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [absent]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy && !done) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, done, onClose]);

  const local = (event: { clientX: number; clientY: number }) => {
    const box = canvas.current!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const moveTip = (x: number, y: number, visible: boolean) => {
    if (!tip.current) return;
    tip.current.style.transform = `translate(${x}px, ${y}px)`;
    tip.current.classList.toggle("on", visible);
  };

  const down = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (busy || done) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const { x, y } = local(event);
    const w = event.pointerType === "pen" && event.pressure ? 1.5 + event.pressure * 3 : 3.2;
    last.current = { x, y, t: performance.now(), w };
    strokes.current.push({ color: ink, points: [{ x, y, w }] });
    drawStroke(event.currentTarget.getContext("2d")!, strokes.current[strokes.current.length - 1]);
    moveTip(x, y, true);
  };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!last.current) return;
    const stroke = strokes.current[strokes.current.length - 1];
    const pen = event.currentTarget.getContext("2d")!;
    const samples = event.nativeEvent.getCoalescedEvents?.() || [];
    for (const sample of samples.length ? samples : [event.nativeEvent]) {
      const { x, y } = local(sample);
      const now = performance.now();
      const previous: Pen = last.current;
      const distance = Math.hypot(x - previous.x, y - previous.y);
      if (distance < 0.8) continue;
      let w: number = previous.w * 0.65 + widthFor(distance, now - previous.t) * 0.35;
      if (sample.pointerType === "pen" && sample.pressure) w = w * 0.55 + sample.pressure * 2.4;
      stroke.points.push({ x, y, w });
      last.current = { x, y, t: now, w };
      drawStroke(pen, stroke, stroke.points.length - 1);
      moveTip(x, y, true);
    }
    if (stroke.points.length === 2) setInkCount((count) => count + 1);
  };
  const up = () => {
    if (!last.current) return;
    last.current = null;
    moveTip(0, 0, false);
    // A tap leaves a dot but doesn't count as a signature.
    const stroke = strokes.current[strokes.current.length - 1];
    if (stroke && stroke.points.length === 1) {
      strokes.current.pop();
      redraw();
    }
  };
  const undo = () => {
    if (strokes.current.pop()) setInkCount((count) => Math.max(0, count - 1));
    redraw();
  };
  const clear = () => {
    strokes.current = [];
    setInkCount(0);
    redraw();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setProblem("");
    let signOff: SignOff;
    if (absent) {
      if (!reason.trim()) return setProblem("Say why the customer couldn't sign.");
      signOff = { no_signature_reason: reason.trim() };
    } else {
      if (!name.trim()) return setProblem("Enter the name of the person signing.");
      if (!hasInk) return setProblem("Ask the customer to sign in the box.");
      signOff = { signature: { name: name.trim(), image: exportSignature(strokes.current) } };
    }
    setBusy(true);
    try {
      await onSubmit(signOff);
      setDone(absent ? "recorded" : "signed");
      window.setTimeout(onDone, CELEBRATE_MS);
    } catch (error) {
      setProblem(errorMessage(error));
      setBusy(false);
    }
  };

  const steps = absent
    ? [
        { label: "Reason", done: !!reason.trim() },
        { label: "Complete", done: !!done },
      ]
    : [
        { label: "Name", done: !!name.trim() },
        { label: "Sign", done: hasInk },
        { label: "Complete", done: !!done },
      ];
  const today = new Date().toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="overlay signOverlay">
      <section className={`signSheet ${done ? "isDone" : ""}`} role="dialog" aria-modal="true" aria-labelledby="sign-title">
        <div className="signHero">
          <span className="signAurora" aria-hidden="true" />
          <div className="signHeroTop">
            <div className="signBadge">
              <PenLine size={14} />
              <h2 id="sign-title">Customer sign-off</h2>
            </div>
            <button type="button" className="signClose" aria-label="Close" onClick={onClose} disabled={busy}>
              <X size={18} />
            </button>
          </div>
          <p className="signLead">Completing</p>
          <h3 className="signJob">{jobTitle}</h3>
          {facts.length > 0 && (
            <ul className="signFacts">
              {facts.map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
          )}
          <ol className="signSteps" aria-label="Progress">
            {steps.map((step, index) => (
              <li key={step.label} className={step.done ? "done" : ""}>
                <span>{step.done ? <Check size={12} strokeWidth={3} /> : index + 1}</span>
                {step.label}
              </li>
            ))}
          </ol>
        </div>

        <form className="signBody" onSubmit={submit}>
          <div className="signSwitch" style={{ "--pos": absent ? 1 : 0 } as React.CSSProperties}>
            <span className="signThumb" aria-hidden="true" />
            <button type="button" aria-pressed={!absent} onClick={() => setAbsent(false)} disabled={busy}>
              <PenLine size={15} /> Customer signs
            </button>
            <button type="button" aria-pressed={absent} onClick={() => setAbsent(true)} disabled={busy}>
              <UserX size={15} /> Customer not present
            </button>
          </div>

          {!absent ? (
            <>
              <p className="signHint">Hand the phone to the customer to confirm the work.</p>
              <label className="signField">
                <span>Name of the person signing</span>
                <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="e.g. Grace Wanjiru" disabled={busy} />
              </label>
              <div className={`signPaper ${hasInk ? "inked" : ""}`}>
                <canvas
                  ref={canvas}
                  aria-label="Signature pad: sign with your finger"
                  onPointerDown={down}
                  onPointerMove={move}
                  onPointerUp={up}
                  onPointerCancel={up}
                />
                <span ref={tip} className="signTip" aria-hidden="true" />
                {!hasInk && (
                  <div className="signGhost" aria-hidden="true">
                    <svg viewBox="0 0 300 90">
                      <path d="M12 62c14-30 26-44 34-38s-8 40-2 42 18-34 28-36 6 30 14 30 16-26 26-26-2 22 8 22 22-30 34-30 4 24 14 24c12 0 26-18 40-20s10 14 22 14 30-10 46-12" />
                    </svg>
                    <b>Sign here</b>
                  </div>
                )}
                <div className="signLine" aria-hidden="true">
                  <span>✕</span>
                </div>
                <p className="signCaption">
                  {name.trim() || "Customer name"} · {today}
                </p>
                {done === "signed" && (
                  <div className="signStamp" aria-hidden="true">
                    <span>Signed</span>
                  </div>
                )}
              </div>
              <div className="signTools">
                <div className="signInks">
                  <span>Ink</span>
                  {INKS.map((option) => (
                    <button
                      key={option.color}
                      type="button"
                      className={`signInk ${ink === option.color ? "active" : ""}`}
                      style={{ "--ink": option.color } as React.CSSProperties}
                      aria-label={option.label}
                      aria-pressed={ink === option.color}
                      onClick={() => setInk(option.color)}
                    />
                  ))}
                </div>
                <div className="signEdits">
                  <button type="button" className="signTool" onClick={undo} disabled={!hasInk || busy}>
                    <Undo2 size={14} /> Undo
                  </button>
                  <button type="button" className="signTool" onClick={clear} disabled={!hasInk || busy}>
                    <Eraser size={14} /> Clear
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <label className="signField">
                <span>Why couldn't the customer sign?</span>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Site manager had left; machine handed over to security"
                  disabled={busy}
                />
              </label>
              <div className="signReasons">
                {REASONS.map((option) => (
                  <button key={option} type="button" className={reason === option ? "active" : ""} onClick={() => setReason(option)} disabled={busy}>
                    {option}
                  </button>
                ))}
              </div>
              <p className="signHint">The reason is saved in the job's history and printed on the customer's report.</p>
            </>
          )}

          {problem && (
            <div className="error" role="alert">
              {problem}
            </div>
          )}
          <button className="primary signSubmit" disabled={busy}>
            <CheckCircle2 size={18} />
            {busy && !done ? "Completing…" : "Complete job"}
          </button>
        </form>

        {done && (
          <div className={`signCelebrate ${done === "signed" ? "afterStamp" : ""}`} role="status">
            <div className="signConfetti" aria-hidden="true">
              {CONFETTI.map((i) => (
                <i key={i} style={{ "--i": i } as React.CSSProperties} />
              ))}
            </div>
            <div className="signSeal">
              <CheckCircle2 size={44} />
            </div>
            <strong>Job completed</strong>
            <span>{done === "signed" ? `Signed by ${name.trim()}` : "Customer not present: reason saved"}</span>
          </div>
        )}
      </section>
    </div>
  );
}
