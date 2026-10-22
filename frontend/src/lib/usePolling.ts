import { useEffect, useRef } from "react";

/** Run `load` now and every `intervalMs` while the tab is visible, and again when it becomes visible. */
export function usePolling(load: () => unknown, intervalMs: number) {
  const latest = useRef(load);
  latest.current = load;

  useEffect(() => {
    const run = () => {
      if (document.visibilityState === "visible") latest.current();
    };
    run();
    const timer = window.setInterval(run, intervalMs);
    document.addEventListener("visibilitychange", run);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", run);
    };
  }, [intervalMs]);
}
