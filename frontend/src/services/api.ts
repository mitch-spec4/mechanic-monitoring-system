import { language, t } from "../i18n";
import type {
  AuditEvent,
  Checklist,
  Company,
  Customer,
  CustomerDetail,
  CustomerSummary,
  ErrorBody,
  IssuedCode,
  Job,
  JobDetail,
  LegalDocument,
  Machine,
  Mechanic,
  Notification,
  Payload,
  Payment,
  Pricing,
  Report,
  Review,
  Role,
  ServiceRecord,
  ServiceRequest,
  SetupStepState,
  Shift,
  ShiftStatus,
  Subscription,
  TeamMember,
  TwoFactorSetup,
  TwoFactorStatus,
  Usage,
} from "./types";
import type { PositionResult } from "../lib/location";

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
  role: Role;
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
  data: ErrorBody;
  constructor(message: string, status: number, data: ErrorBody) {
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
export async function api<T>(path: string, options: RequestInit = {}, announce = true): Promise<T> {
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
  const data: T & ErrorBody = await response.json().catch(() => ({}));
  if (response.status === 403 && data.two_factor_setup) window.dispatchEvent(new Event(TWO_FACTOR_SETUP_EVENT));
  if (!response.ok) {
    throw new ApiError(data.error || data.message || data.msg || t("Request failed ({status})", { status: response.status }), response.status, data);
  }
  if (announce && (options.method || "GET").toUpperCase() !== "GET") window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
  return data;
}

const post = <T>(path: string, data: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(data) });
const patch = <T>(path: string, data: unknown) => api<T>(path, { method: "PATCH", body: JSON.stringify(data) });
const put = <T>(path: string, data: unknown) => api<T>(path, { method: "PUT", body: JSON.stringify(data) });
const remove = <T = Ok>(path: string) => api<T>(path, { method: "DELETE" });

type Ok = { ok: true };
type Signed = { user: User };
type Message = { message: string };
type WithJob = { job: JobDetail };

/** Either a session, or, for two-step sign-in, the ticket to send with the code. */
export const login = (email: string, password: string) => post<Signed | { two_factor_required: true; ticket: string }>("/auth/login", { email, password });
export const verifyTwoFactor = (ticket: string, code: string, remember: boolean) => post<Signed>("/auth/two-factor/verify", { ticket, code, remember });
export const startTwoFactorSetup = () => post<TwoFactorSetup>("/auth/two-factor/setup", {});
export const enableTwoFactor = (setupToken: string, code: string) =>
  post<Signed & { backup_codes: string[] }>("/auth/two-factor/enable", { setup_token: setupToken, code });
export const twoFactorStatus = () => api<TwoFactorStatus>("/auth/two-factor");
export const renewBackupCodes = (password: string) => post<{ backup_codes: string[] }>("/auth/two-factor/backup-codes", { password });
export const resetTwoFactor = (userId: number) => post<Ok>(`/users/${userId}/reset-two-factor`, {});
export const legalDocument = (name: "privacy" | "terms") => api<LegalDocument>(`/legal/${name}`);

// The company's data (managers): the activity log, export, and deleting the company
export const activity = (before?: number) => api<{ events: AuditEvent[]; more: boolean }>(`/company/activity${before ? `?before=${before}` : ""}`);
export const deleteCompany = (companyName: string, password: string) =>
  post<{ deletion_due: string }>("/company/delete", { company_name: companyName, password });
export const cancelCompanyDeletion = () => post<Ok>("/company/delete/cancel", {});

/** "Export my data": the ZIP comes back as a file, so this reads the response itself. */
export async function exportData(password: string) {
  const response = await send("/company/export", { method: "POST", body: JSON.stringify({ password }) });
  if (!response.ok) {
    const data: ErrorBody = await response.json().catch(() => ({}));
    throw new ApiError(data.error || t("Request failed ({status})", { status: response.status }), response.status, data);
  }
  const name = /filename="?([^";]+)"?/.exec(response.headers.get("Content-Disposition") || "")?.[1] || "mechanicpro-export.zip";
  return { blob: await response.blob(), name };
}
export const logout = () => post<Ok>("/auth/logout", {}).catch(() => {});
export const acceptInvitation = (invitation: Payload) => post<Message>("/auth/accept-invitation", invitation);
export const resetPassword = (data: Payload) => post<Message & { email?: string }>("/auth/reset-password", data);
export const changePassword = (data: { current_password: string; new_password: string }) => post<Signed>("/auth/change-password", data);
export const issueResetCode = (userId: number) => post<IssuedCode>(`/users/${userId}/reset-code`, {});
export const forgotPassword = (email: string) => post<Message>("/auth/forgot-password", { email });
export const verifyEmail = (token: string) => post<Message & { email: string }>("/auth/verify-email", { token });
export const resendVerification = () => post<Message & { sent: boolean }>("/auth/resend-verification", {});
export const me = () => api<Signed>("/users/me");
export const saveLanguage = (language: string) => patch<Signed>("/users/me", { language });

// Company settings (managers): time zone, currency, units and the company's language
export type CompanySettings = { timezone: string; currency: string; units: string; language: string };
export type CompanySettingsOptions = { timezones: string[]; currencies: string[]; units: string[]; languages: { code: string; name: string }[] };
export const companySettings = () => api<{ settings: CompanySettings } & CompanySettingsOptions>("/company/settings");
export const saveCompanySettings = (settings: Partial<CompanySettings>) => patch<{ settings: CompanySettings }>("/company/settings", settings);

// "Try the demo": a private demo company, seen as the boss, a mechanic or a customer
export const startDemo = (role: string) => post<Signed>("/demo", { role });
export const switchDemo = (role: string) => api<Signed>("/demo/switch", { method: "POST", body: JSON.stringify({ role }) }, false);

// The "Get set up" guide on a new company's dashboard
export const setupGuide = () => api<{ dismissed: boolean; steps: SetupStepState[] }>("/company/setup");
export const dismissSetup = () => post<Ok>("/company/setup/dismiss", {});

// Plans, company signup and billing
export const plans = () => api<Pricing>("/plans");
export const signup = (data: Payload) => post<Signed & { checkout_url?: string }>("/signup", data);
/** The billing page: the plans, this company's plan and usage, and its payments. */
export type Billing = Pricing & { subscription: Subscription | null; usage: Usage; payments: Payment[] };
export const billing = () => api<Billing>("/billing");
export const startCheckout = (plan: string, interval: string) => post<{ checkout_url: string; payment: Payment }>("/billing/checkout", { plan, interval });
export const checkoutDetail = (reference: string) =>
  api<{ payment: Payment; company: string; email: string }>(`/billing/payments/${encodeURIComponent(reference)}`);
export const payTestCheckout = (reference: string, outcome: "success" | "declined") =>
  post<{ payment: Payment; subscription: Subscription | null }>(`/billing/test/${encodeURIComponent(reference)}/pay`, { outcome });

export const jobs = () => api<{ jobs: Job[] }>("/jobs");
export const notifications = () => api<{ notifications: Notification[] }>("/notifications");
export const machines = () => api<{ machines: Machine[] }>("/machines");
export const services = () => api<{ records: ServiceRecord[] }>("/services");
export const customers = () => api<{ customers: CustomerSummary[] }>("/customers");
export const mechanics = () => api<{ mechanics: Mechanic[] }>("/users/mechanics");
export const reviews = () => api<{ reviews: Review[] }>("/reviews");
export const requests = () => api<{ requests: ServiceRequest[] }>("/customers/requests");
export const reports = () => api<Report>("/reports");
export const company = () => api<{ company: Company }>("/company");

export const createJob = (data: Payload) => post<{ job: Job }>("/jobs", data);
export const updateJob = (id: number, data: Payload) => patch<{ job: Job }>(`/jobs/${id}`, data);
export const deleteJob = (id: number) => remove(`/jobs/${id}`);
export const invite = (data: Payload) => post<{ code: string; expires_at: string; emailed: boolean }>("/customers/invite", data);
export const createMachine = (data: Payload) => post<{ id: number; machine: Machine }>("/machines", data);
export const createRequest = (data: Payload) => post<{ id: number }>("/customers/requests", data);
export const updateMachine = (id: number, data: Payload) => patch<{ ok: true; machine: Machine }>(`/machines/${id}`, data);
export const updateCustomer = (id: number, data: Payload) => patch<{ ok: true; customer: Customer }>(`/customers/${id}`, data);
export const updateRequest = (id: number, data: Payload) => patch<{ ok: true; status: string }>(`/customers/requests/${id}`, data);
export const createReview = (data: Payload) => post<{ id: number }>("/reviews", data);
export const markNotificationRead = (id: number) => patch<Ok>(`/notifications/${id}/read`, {});
export const markAllNotificationsRead = () => patch<Ok>("/notifications/read-all", {});

// Worksheets
export const jobDetail = (id: number) => api<WithJob>(`/jobs/${id}`);
export const addEntry = (jobId: number, data: Payload) => post<WithJob>(`/jobs/${jobId}/entries`, data);
export const updateEntry = (jobId: number, entryId: number, data: Payload) => patch<WithJob>(`/jobs/${jobId}/entries/${entryId}`, data);
export const addPart = (jobId: number, data: Payload) => post<WithJob>(`/jobs/${jobId}/parts`, data);
export const removePart = (jobId: number, partId: number) => remove<WithJob>(`/jobs/${jobId}/parts/${partId}`);
export const updateChecklistItem = (jobId: number, itemId: number, data: Payload) => patch<WithJob>(`/jobs/${jobId}/checklist/${itemId}`, data);
export const saveRecord = (jobId: number, data: Payload) => put<WithJob>(`/jobs/${jobId}/record`, data);
export const addNote = (jobId: number, note: string) => post<WithJob>(`/jobs/${jobId}/notes`, { note });

// Checklist templates (managers)
export type ChecklistDraft = { job_type: string; items: { label: string; required: boolean }[] };
export const checklists = () => api<{ checklists: Checklist[] }>("/checklists");
export const createChecklist = (data: ChecklistDraft) => post<{ checklist: Checklist }>("/checklists", data);
export const updateChecklist = (id: number, data: Partial<ChecklistDraft>) => patch<{ checklist: Checklist }>(`/checklists/${id}`, data);
export const deleteChecklist = (id: number) => remove(`/checklists/${id}`);

// Clock in/out and location
export const shiftStatus = () => api<ShiftStatus>("/shifts/current");
export const setLocationConsent = (consent: boolean) => post<ShiftStatus>("/shifts/consent", { consent });
export const clockIn = (position: PositionResult) => post<ShiftStatus>("/shifts/clock-in", position);
export const clockOut = (position: PositionResult) => post<ShiftStatus>("/shifts/clock-out", position);
export const shiftList = (params: { mechanic_id?: number | ""; days?: number } = {}) => {
  const query = new URLSearchParams();
  if (params.mechanic_id) query.set("mechanic_id", String(params.mechanic_id));
  if (params.days) query.set("days", String(params.days));
  return api<{ shifts: Shift[] }>(`/shifts?${query}`);
};
export const correctShift = (id: number, clockedOutAt: string) => patch<{ shift: Shift }>(`/shifts/${id}`, { clocked_out_at: clockedOutAt });
export const sendLiveLocation = (jobId: number, position: PositionResult) => post<{ saved: boolean }>("/location/live", { job_id: jobId, ...position });
export const teamLocations = () => api<{ team: TeamMember[] }>("/location/team");
export const customerDetail = (id: number) => api<{ customer: CustomerDetail }>(`/customers/${id}`);

// Job photos, videos and reports
export const requestUpload = (jobId: number, data: { kind: string; content_type: string; size: number; name: string }) =>
  post<{ file_id: number; upload: UploadTarget }>(`/jobs/${jobId}/files`, data);
export const confirmUpload = (fileId: number) => post<WithJob>(`/files/${fileId}/confirm`, {});
export const deleteFile = (fileId: number) => remove<WithJob>(`/files/${fileId}`);
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
    const data: ErrorBody = await response.json().catch(() => ({}));
    throw new ApiError(data.error || failed, response.status, data);
  }
}

export async function downloadReport(path: string) {
  const response = await fetch(apiUrl(path), { credentials: "include" });
  if (!response.ok) throw new ApiError(t("Couldn't create the report. Please try again."), response.status, {});
  return response.blob();
}
