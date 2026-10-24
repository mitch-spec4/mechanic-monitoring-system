/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { openOffline } from "./offline/db";
import { flushOutbox, goodConnection, type SendEnv } from "./offline/send";
import { SYNC_TAG } from "./offline/types";

type CookieStore = { get: (name: string) => Promise<{ value: string } | null> };
type SyncEvent = ExtendableEvent & { tag: string };
declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }>; cookieStore?: CookieStore };

// The app's own files, so it opens with no signal. API data is never kept here: a technician's
// data lives in their own database on the phone (offline/db.ts), wiped when they sign out.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html"), { denylist: [/^\/api\//] }));

// A new version waits until the person taps Reload ("Update ready"), never in the middle of a worksheet.
self.addEventListener("message", (event) => {
  if ((event.data as { type?: string } | null)?.type === "SKIP_WAITING") void self.skipWaiting();
});

const BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");

async function cookie(name: string) {
  const found = await self.cookieStore?.get(name).catch(() => null);
  return found?.value ?? "";
}

async function refresh() {
  try {
    const response = await fetch(`${BASE}/auth/refresh`, { method: "POST", credentials: "include", headers: { "X-CSRF-TOKEN": await cookie("csrf_refresh_token") } });
    return response.ok;
  } catch {
    return false;
  }
}

const env: SendEnv = {
  base: BASE,
  csrf: () => cookie("csrf_access_token"),
  refresh,
  goodConnection: () => goodConnection(self.navigator as WorkerNavigator & { onLine: boolean; connection?: { effectiveType?: string; saveData?: boolean } }),
};

/** Background Sync (Android): send the signed-in technician's queue with the app closed. */
async function sendQueue() {
  // With still no signal this fails, and the browser tries again later.
  let reply = await fetch(`${BASE}/users/me`, { credentials: "include" });
  if (reply.status === 401 && (await refresh())) reply = await fetch(`${BASE}/users/me`, { credentials: "include" });
  // Nobody signed in: the queue waits for the same person to sign in again.
  if (!reply.ok) return;
  const { user } = (await reply.json()) as { user: { id: number; role: string } };
  if (user.role !== "mechanic") return;
  const db = await openOffline(user.id);
  try {
    const result = await flushOutbox(db, user.id, env);
    for (const client of await self.clients.matchAll({ type: "window" })) client.postMessage({ type: "synced" });
    if (result === "offline" || result === "server") throw new Error(result);
  } finally {
    db.close();
  }
}

self.addEventListener("sync" as keyof ServiceWorkerGlobalScopeEventMap, (event) => {
  const sync = event as SyncEvent;
  if (sync.tag === SYNC_TAG) sync.waitUntil(sendQueue());
});
