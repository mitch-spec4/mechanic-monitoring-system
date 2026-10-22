const BASE = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:5000/api").replace(/\/$/, "");

export const SESSION_EXPIRED_EVENT = "mechanicpro:session-expired";
// Fired after any successful change so always-visible widgets (sidebar, bell) refresh at once.
export const DATA_CHANGED_EVENT = "mechanicpro:data-changed";

export function saveSession(data: { token: string; refresh_token?: string; user?: unknown }) {
  localStorage.setItem("token", data.token);
  if (data.refresh_token) localStorage.setItem("refreshToken", data.refresh_token);
  if (data.user) localStorage.setItem("user", JSON.stringify(data.user));
}

export function clearSession() {
  localStorage.removeItem("token");
  localStorage.removeItem("refreshToken");
  localStorage.removeItem("user");
}

let refreshing: Promise<boolean> | null = null;

// One refresh at a time: parallel requests that all hit 401 share the same attempt.
function refreshSession() {
  refreshing ??= (async () => {
    const refreshToken = localStorage.getItem("refreshToken");
    if (!refreshToken) return false;
    try {
      const response = await fetch(`${BASE}/auth/refresh`, {
        method: "POST",
        headers: { Authorization: `Bearer ${refreshToken}` },
      });
      if (!response.ok) return false;
      saveSession(await response.json());
      return true;
    } catch {
      return false;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function send(path: string, options: RequestInit) {
  const token = localStorage.getItem("token");
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${BASE}${path.startsWith("/") ? path : `/${path}`}`, { ...options, headers });
}

export async function api(path: string, options: RequestInit = {}) {
  let response = await send(path, options);
  if (response.status === 401 && localStorage.getItem("token")) {
    if (await refreshSession()) {
      response = await send(path, options);
    }
    if (response.status === 401) {
      clearSession();
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.message || data.msg || `Request failed (${response.status})`);
  }
  if ((options.method || "GET").toUpperCase() !== "GET") window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
  return data;
}

const post = (path: string, data: unknown) => api(path, { method: "POST", body: JSON.stringify(data) });
const patch = (path: string, data: unknown) => api(path, { method: "PATCH", body: JSON.stringify(data) });

export const login = (email: string, password: string) => post("/auth/login", { email, password });
export const acceptInvitation = (invitation: any) => post("/auth/accept-invitation", invitation);

export const jobs = () => api("/jobs");
export const notifications = () => api("/notifications");
export const machines = () => api("/machines");
export const services = () => api("/services");
export const customers = () => api("/customers");
export const mechanics = () => api("/users/mechanics");
export const reviews = () => api("/reviews");
export const requests = () => api("/customers/requests");
export const reports = () => api("/reports");
export const company = () => api("/company");

export const createJob = (data: any) => post("/jobs", data);
export const updateJob = (id: number, data: any) => patch(`/jobs/${id}`, data);
export const deleteJob = (id: number) => api(`/jobs/${id}`, { method: "DELETE" });
export const invite = (data: any) => post("/customers/invite", data);
export const createMachine = (data: any) => post("/machines", data);
export const createService = (data: any) => post("/services", data);
export const createRequest = (data: any) => post("/customers/requests", data);
export const updateRequest = (id: number, data: any) => patch(`/customers/requests/${id}`, data);
export const createReview = (data: any) => post("/reviews", data);
export const markNotificationRead = (id: number) => patch(`/notifications/${id}/read`, {});
export const markAllNotificationsRead = () => patch("/notifications/read-all", {});
