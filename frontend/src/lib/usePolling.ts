import { useEffect, useRef } from "react";
import { DATA_CHANGED_EVENT } from "../services/api";

/**
 * Run `load` now and every `intervalMs` while the tab is visible, and again when it becomes visible.
 * With `refreshOnChange`, also reload right after the user changes data anywhere in the app.
 */
export function usePolling(load: () => unknown, intervalMs: number, refreshOnChange = false) {
  const latest = useRef(load);
  latest.current = load;

  useEffect(() => {
    const run = () => {
      if (document.visibilityState === "visible") latest.current();
    };
    run();
    const timer = window.setInterval(run, intervalMs);
    const changed = () => latest.current();
    document.addEventListener("visibilitychange", run);
    if (refreshOnChange) window.addEventListener(DATA_CHANGED_EVENT, changed);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", run);
      window.removeEventListener(DATA_CHANGED_EVENT, changed);
    };
  }, [intervalMs, refreshOnChange]);
}
