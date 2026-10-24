import { useSyncExternalStore } from "react";

/**
 * The installable app: the service worker (production builds), "Update ready", and installing to
 * the home screen ("Install app" on Android; on iPhone, Share → Add to Home Screen).
 */
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type PwaState = { updateReady: boolean; canInstall: boolean };

let state: PwaState = { updateReady: false, canInstall: false };
const listeners = new Set<() => void>();
let installPrompt: InstallPrompt | null = null;
let applyUpdate: ((reload?: boolean) => Promise<void>) | null = null;

function setState(patch: Partial<PwaState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export const usePwa = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => state,
  );

/** Called once, before the first render: the install offer comes early. */
export function startPwa() {
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    void import("virtual:pwa-register").then(({ registerSW }) => {
      applyUpdate = registerSW({ immediate: true, onNeedRefresh: () => setState({ updateReady: true }) });
    });
  }
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event as InstallPrompt;
    setState({ canInstall: true });
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    setState({ canInstall: false });
  });
}

/** Load the new version (only when the person taps Reload). */
export const reloadForUpdate = () => applyUpdate?.(true);

export async function install() {
  const prompt = installPrompt;
  if (!prompt) return;
  await prompt.prompt();
  if ((await prompt.userChoice).outcome === "accepted") {
    installPrompt = null;
    setState({ canInstall: false });
  }
}

/** Opened from the home screen, not a browser tab. */
export const installed = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const onIphone = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
