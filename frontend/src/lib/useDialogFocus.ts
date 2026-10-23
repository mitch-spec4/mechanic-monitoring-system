import { useEffect, type RefObject } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keyboard use of a dialog: focus moves inside when it opens (to `first`, or the first field),
 *  Tab stays inside, and focus goes back to what opened it when it closes. */
export function useDialogFocus(dialog: RefObject<HTMLElement>, first?: RefObject<HTMLElement>) {
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const box = dialog.current;
    if (!box) return;
    const items = () => Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((item) => item.offsetParent !== null);
    // Prefer a field to type in over the close button.
    const start = first?.current ?? items().find((item) => item.matches("input, select, textarea")) ?? items()[0];
    start?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const list = items();
      if (!list.length) return;
      const [head, tail] = [list[0], list[list.length - 1]];
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault();
        head.focus();
      }
    };
    box.addEventListener("keydown", trap);
    return () => {
      box.removeEventListener("keydown", trap);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);
}
