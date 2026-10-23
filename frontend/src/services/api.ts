import { language, t } from "../i18n";

// Same-origin "/api" by default: Vite proxies it to the backend in development, and in production
// the API should be served from the same site so the session cookies are sent.
const BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");

export const SESSION_EXPIRED_EVENT = "mechanicpro:session-expired";
// The server says this person must set up two-step sign-in before doing anything else.
export const TWO_FACTOR_SETUP_EVENT = "mechanicpro:two-factor-setup";
// Fired after any successful change so always-visible widgets (sidebar, bell) refresh at once.
export const DATA_CHANGED_EVENT = "mechanicpro:data-changed";

// The session itself lives in httpOnly cookies that scripts cannot read. Only the public
// profile is kept here so the app knows who is signed in after a reload.
/** The signed-in person, as the API sends it. */
export type User = {
  id: number;
  name: string;
  email: string;
  role: "boss" | "mechanic" | "customer";
  company_id: number;
  customer_id: number | null;
  email_verified: boolean;
  demo_until: string | null;
  language: string;
  timezone: string;
  units: string;
  two_factor_enabled: boolean;
  two_factor_setup_needed: boolean;
  /** Set while the company waits to be deleted: when it happens. */
  deletion_due: string | null;
};

export function saveSession(user: unknown) {
  localStorage.setItem("user", JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem("user");
  localStorage.removeItem("token");
  localStorage.removeItem("refreshToken");
}

function readCookie(name: string) {
  const match = document.cookie.split("; ").find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

/** An API failure. `data` is the full error body (e.g. what still blocks completing a job). */
export class ApiError extends Error {
  status: number;
  data: any;
  constructor(message: string, status: number, data: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

let refreshing: Promise<boolean> | null = null;

// One refresh at a time: parallel requests that all hit 401 share the same attempt.
function refreshSession() {
  refreshing ??= fetch(`${BASE}/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: { "X-CSRF-TOKEN": readCookie("csrf_refresh_token") },
  })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

function send(path: string, options: RequestInit) {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const method = (options.method || "GET").toUpperCase();
  if (method !== "GET") headers.set("X-CSRF-TOKEN", readCookie("csrf_access_token"));
  // Error messages and anything the server writes come back in the reader's language. Firefox keeps
  // its own Accept-Language, so the app's choice also goes in X-Language, which the server reads first.
  headers.set("Accept-Language", language());
  headers.set("X-Language", language());
  return fetch(`${BASE}${path.startsWith("/") ? path : `/${path}`}`, { ...options, headers, credentials: "include" });
}

/** `announce: false` skips the data-changed event, for a request that swaps the whole session
 * (switching people in the demo): the outgoing screen must not refetch with the new session. */
export async function api(path: string, options: RequestInit = {}, announce = true) {
  let response = await send(path, options);
  if (response.status === 401 && !path.startsWith("/auth/") && localStorage.getItem("user")) {
    if (await refreshSession()) {
      response = await send(path, options);
    }
    if (response.status === 401) {
      clearSession();
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 403 && data.two_factor_setup) window.dispatchEvent(new Event(TWO_FACTOR_SETUP_EVENT));
  if (!response.ok) {
    throw new ApiError(data.error || data.message || data.msg || t("Request failed ({status})", { status: response.status }), response.status, data);
  }
  if (announce && (options.method || "GET").toUpperCase() !== "GET") window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
  return data;
}

const post = (path: string, data: unknown) => api(path, { method: "POST", body: JSON.stringify(data) });
const patch = (path: string, data: unknown) => api(path, { method: "PATCH", body: JSON.stringify(data) });

/** Either a session ({ user }), or { two_factor_required, ticket } when a code is needed next. */
export const login = (email: string, password: string) => post("/auth/login", { email, password });
export const verifyTwoFactor = (ticket: string, code: string, remember: boolean) => post("/auth/two-factor/verify", { ticket, code, remember });
export const startTwoFactorSetup = () => post("/auth/two-factor/setup", {});
export const enableTwoFactor = (setupToken: string, code: string) => post("/auth/two-factor/enable", { setup_token: setupToken, code });
export const twoFactorStatus = () => api("/auth/two-factor");
export const renewBackupCodes = (password: string) => post("/auth/two-factor/backup-codes", { password });
export const resetTwoFactor = (userId: number) => post(`/users/${userId}/reset-two-factor`, {});
export const legalDocument = (name: "privacy" | "terms") => api(`/legal/${name}`);

// The company's data (managers): the activity log, export, and deleting the company
export const activity = (before?: number) => api(`/company/activity${before ? `?before=${before}` : ""}`);
export const deleteCompany = (companyName: string, password: string) => post("/company/delete", { company_name: companyName, password });
export const cancelCompanyDeletion = () => post("/company/delete/cancel", {});

/** "Export my data": the ZIP comes back as a file, so this reads the response itself. */
export async function exportData(password: string) {
  const response = await send("/company/export", { method: "POST", body: JSON.stringify({ password }) });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(data.error || t("Request failed ({status})", { status: response.status }), response.status, data);
  }
  const name = /filename="?([^";]+)"?/.exec(response.headers.get("Content-Disposition") || "")?.[1] || "mechanicpro-export.zip";
  return { blob: await response.blob(), name };
}
export const logout = () => post("/auth/logout", {}).catch(() => {});
export const acceptInvitation = (invitation: any) => post("/auth/accept-invitation", invitation);
export const resetPassword = (data: any) => post("/auth/reset-password", data);
export const changePassword = (data: any) => post("/auth/change-password", data);
export const issueResetCode = (userId: number) => post(`/users/${userId}/reset-code`, {});
export const forgotPassword = (email: string) => post("/auth/forgot-password", { email });
export const verifyEmail = (token: string) => post("/auth/verify-email", { token });
export const resendVerification = () => post("/auth/resend-verification", {});
export const me = () => api("/users/me");
export const saveLanguage = (language: string) => patch("/users/me", { language });

// Company settings (managers): time zone, currency and units
export type CompanySettings = { timezone: string; currency: string; units: string };
export const companySettings = () => api("/company/settings");
export const saveCompanySettings = (settings: Partial<CompanySettings>) => patch("/company/settings", settings);

// "Try the demo": a private demo company, seen as the boss, a mechanic or a customer
export const startDemo = (role: string) => post("/demo", { role });
export const switchDemo = (role: string) => api("/demo/switch", { method: "POST", body: JSON.stringify({ role }) }, false);

// The "Get set up" guide on a new company's dashboard
export const setupGuide = () => api("/company/setup");
export const dismissSetup = () => post("/company/setup/dismiss", {});

// Plans, company signup and billing
export const plans = () => api("/plans");
export const signup = (data: any) => post("/signup", data);
export const billing = () => api("/billing");
export const startCheckout = (plan: string, interval: string) => post("/billing/checkout", { plan, interval });
export const checkoutDetail = (reference: string) => api(`/billing/payments/${encodeURIComponent(reference)}`);
export const payTestCheckout = (reference: string, outcome: "success" | "declined") =>
  post(`/billing/test/${encodeURIComponent(reference)}/pay`, { outcome });

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
export const createRequest = (data: any) => post("/customers/requests", data);
export const updateMachine = (id: number, data: any) => patch(`/machines/${id}`, data);
export const updateCustomer = (id: number, data: any) => patch(`/customers/${id}`, data);
export const updateRequest = (id: number, data: any) => patch(`/customers/requests/${id}`, data);
export const createReview = (data: any) => post("/reviews", data);
export const markNotificationRead = (id: number) => patch(`/notifications/${id}/read`, {});
export const markAllNotificationsRead = () => patch("/notifications/read-all", {});

// Worksheets
const put = (path: string, data: unknown) => api(path, { method: "PUT", body: JSON.stringify(data) });
export const jobDetail = (id: number) => api(`/jobs/${id}`);
export const addEntry = (jobId: number, data: any) => post(`/jobs/${jobId}/entries`, data);
export const updateEntry = (jobId: number, entryId: number, data: any) => patch(`/jobs/${jobId}/entries/${entryId}`, data);
export const addPart = (jobId: number, data: any) => post(`/jobs/${jobId}/parts`, data);
export const removePart = (jobId: number, partId: number) => api(`/jobs/${jobId}/parts/${partId}`, { method: "DELETE" });
export const updateChecklistItem = (jobId: number, itemId: number, data: any) => patch(`/jobs/${jobId}/checklist/${itemId}`, data);
export const saveRecord = (jobId: number, data: any) => put(`/jobs/${jobId}/record`, data);
export const addNote = (jobId: number, note: string) => post(`/jobs/${jobId}/notes`, { note });

// Checklist templates (managers)
export const checklists = () => api("/checklists");
export const createChecklist = (data: any) => post("/checklists", data);
export const updateChecklist = (id: number, data: any) => patch(`/checklists/${id}`, data);
export const deleteChecklist = (id: number) => api(`/checklists/${id}`, { method: "DELETE" });

// Clock in/out and location
export const shiftStatus = () => api("/shifts/current");
export const setLocationConsent = (consent: boolean) => post("/shifts/consent", { consent });
export const clockIn = (position: any) => post("/shifts/clock-in", position);
export const clockOut = (position: any) => post("/shifts/clock-out", position);
export const shiftList = (params: { mechanic_id?: number | ""; days?: number } = {}) => {
  const query = new URLSearchParams();
  if (params.mechanic_id) query.set("mechanic_id", String(params.mechanic_id));
  if (params.days) query.set("days", String(params.days));
  return api(`/shifts?${query}`);
};
export const correctShift = (id: number, clockedOutAt: string) => patch(`/shifts/${id}`, { clocked_out_at: clockedOutAt });
export const sendLiveLocation = (jobId: number, position: any) => post("/location/live", { job_id: jobId, ...position });
export const teamLocations = () => api("/location/team");
export const customerDetail = (id: number) => api(`/customers/${id}`);

// Job photos, videos and reports
export const requestUpload = (jobId: number, data: any) => post(`/jobs/${jobId}/files`, data);
export const confirmUpload = (fileId: number) => post(`/files/${fileId}/confirm`, {});
export const deleteFile = (fileId: number) => api(`/files/${fileId}`, { method: "DELETE" });
/** Paths the API returns (like "/api/files/7") resolved against the configured API base. */
export const apiUrl = (path: string) => (path.startsWith("/api/") ? `${BASE}${path.slice(4)}` : path);

export type UploadTarget = { method: string; url: string; headers: Record<string, string> };

/** Send a file to its signed upload link: the storage bucket, or this app in local mode. */
export async function sendUpload(target: UploadTarget, file: Blob) {
  const failed = t("The upload failed. Check your connection and try again.");
  const response = await fetch(apiUrl(target.url), { method: target.method, headers: target.headers, body: file }).catch(() => {
    throw new ApiError(failed, 0, {});
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(data.error || failed, response.status, data);
  }
}

export async function downloadReport(path: string) {
  const response = await fetch(apiUrl(path), { credentials: "include" });
  if (!response.ok) throw new ApiError(t("Couldn't create the report. Please try again."), response.status, {});
  return response.blob();
}
