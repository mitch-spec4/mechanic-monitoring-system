// Arrows in button text. They point the other way in right-to-left languages (see .flipInRtl),
// and screen readers skip them: the words already say where the button goes.
export const ForwardArrow = () => (
  <span className="flipInRtl" aria-hidden="true">
    →
  </span>
);

export const BackArrow = () => (
  <span className="flipInRtl" aria-hidden="true">
    ←
  </span>
);
