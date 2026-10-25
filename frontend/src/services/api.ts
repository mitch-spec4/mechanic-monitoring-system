import { language, t } from "../i18n";
import type {
  AuditEvent,
  BookableService,
  CatalogService,
  ChatMessage,
  Checklist,
  Company,
  Conversation,
  Customer,
  CustomerDetail,
  CustomerSummary,
  EquipmentDetail,
  ErrorBody,
  Feature,
  Insights,
  IssuedCode,
  Job,
  JobDetail,
  LegalDocument,
  Machine,
  Mechanic,
  Notification,
  Paging,
  Position,
  RoutePlan,
  Payload,
  Payment,
  Pricing,
  Report,
  RequestDetail,
  Review,
  Role,
  ServiceRecord,
  ServiceRequest,
  SetupStepState,
  Site,
  Slot,
  Shift,
  ShiftStatus,
  Subscription,
  TeamMember,
  TwoFactorSetup,
  TwoFactorStatus,
  Usage,
  Visit,
} from "./types";
import type { PositionResult } from "../lib/location";
import { noteServerClock } from "../offline/clock";

// Same-origin "/api" by default: Vite proxies it to the backend in development, and in production
// the API should be served from the same site so the session cookies are sent.
export const BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");

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
  currency?: string;
  /** What the company's plan includes (missing on profiles saved before plans had features). */
  features?: Feature[];
  /** Managers: where the plan stands, for the banner across the app. */
  subscription?: Subscription | null;
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

/** The CSRF token the server expects with every change (its cookie is readable on purpose). */
export const csrfToken = () => readCookie("csrf_access_token");

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
export function refreshSession() {
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
  const sentAt = Date.now();
  // Never an old answer from the browser's cache (an offline Firefox serves it): a technician's
  // offline copy is the app's own, and says how old it is.
  return fetch(`${BASE}${path.startsWith("/") ? path : `/${path}`}`, { cache: "no-store", ...options, headers, credentials: "include" }).then((response) => {
    noteServerClock(response.headers.get("Date"), sentAt, Date.now());
    return response;
  });
}

/** Reads can come from the phone's offline copy (technicians, see offline/index.ts). */
type Reader = <T>(path: string, load: () => Promise<T>) => Promise<T>;
let reader: Reader | null = null;
export function setReader(next: Reader | null) {
  reader = next;
}

/** `announce: false` skips the data-changed event, for a request that swaps the whole session
 * (switching people in the demo): the outgoing screen must not refetch with the new session. */
export async function api<T>(path: string, options: RequestInit = {}, announce = true): Promise<T> {
  if ((options.method || "GET").toUpperCase() === "GET" && reader) return reader(path, () => request<T>(path, options, announce));
  return request<T>(path, options, announce);
}

async function request<T>(path: string, options: RequestInit, announce: boolean): Promise<T> {
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

// Company settings (managers): time zone, currency, units, the company's language and booking
/** When customers can book visits: ISO weekdays (1 = Monday), opening hours, lengths in minutes. */
export type BookingSettings = {
  days: number[];
  start: string;
  end: string;
  inspection_minutes: number;
  repair_minutes: number;
  travel_minutes: number;
  notice_hours: number;
  window_days: number;
};
export type CompanySettings = { timezone: string; currency: string; units: string; language: string; booking: BookingSettings; base: Position | null };
export type CompanySettingsOptions = { timezones: string[]; currencies: string[]; units: string[]; languages: { code: string; name: string }[] };
export const companySettings = () => api<{ settings: CompanySettings } & CompanySettingsOptions>("/company/settings");
export const saveCompanySettings = (settings: Partial<Omit<CompanySettings, "booking">> & { booking?: Partial<BookingSettings> }) =>
  patch<{ settings: CompanySettings }>("/company/settings", settings);

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
export const startCheckout = (plan: string, interval: string, extraMechanics = 0) =>
  post<{ checkout_url: string; payment: Payment }>("/billing/checkout", { plan, interval, extra_mechanics: extraMechanics });
export const setRenewal = (autoRenew: boolean) => post<{ subscription: Subscription }>("/billing/renewal", { auto_renew: autoRenew });
/** Back from the payment provider's page: how it went. */
export const confirmPayment = (reference: string) =>
  post<{ payment: Payment; subscription: Subscription | null }>(`/billing/payments/${encodeURIComponent(reference)}/confirm`, {});
/** Test mode: charge the saved test card for the next period now. */
export const testRenew = () => post<{ payment: Payment; subscription: Subscription }>("/billing/test/renew", {});
export const checkoutDetail = (reference: string) =>
  api<{ payment: Payment; company: string; email: string }>(`/billing/payments/${encodeURIComponent(reference)}`);
export const payTestCheckout = (reference: string, outcome: "success" | "declined" | "declines_later") =>
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

// Technicians' routes and job costing (managers; technicians see their own route)
export const routePlan = (mechanicId: number, date: string) => api<{ plan: RoutePlan }>(`/routes?mechanic_id=${mechanicId}&date=${date}`);
export const saveRoute = (mechanicId: number, date: string, jobIds: number[]) => post<{ plan: RoutePlan }>("/routes", { mechanic_id: mechanicId, date, job_ids: jobIds });
export const myRoute = (date: string) => api<{ plan: RoutePlan }>(`/routes/mine?date=${date}`);
export const saveCosting = (jobId: number, data: { charged?: string | null; parts?: { id: number; unit_cost: string | null }[] }) =>
  patch<{ job: JobDetail }>(`/jobs/${jobId}/costing`, data);
export const setPayRate = (userId: number, payRate: string | null) => patch<{ user: unknown }>(`/users/${userId}`, { pay_rate: payRate });

// Long lists a page at a time (?page=, ?q= to search); without a page the whole list comes back.
export const PAGE_SIZE = 25;
const paged = (path: string, page: number, q: string) =>
  `${path}?page=${page}&per_page=${PAGE_SIZE}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`;
export const jobsPage = (page: number, q = "") => api<{ jobs: Job[] } & Paging>(paged("/jobs", page, q));
export const servicesPage = (page: number, q = "") => api<{ records: ServiceRecord[] } & Paging>(paged("/services", page, q));
export const reviewsPage = (page: number, q = "") => api<{ reviews: Review[] } & Paging>(paged("/reviews", page, q));
export const notificationsPage = (page: number, q = "") => api<{ notifications: Notification[] } & Paging>(paged("/notifications", page, q));
export const requestsPage = (page: number, q = "") => api<{ requests: ServiceRequest[] } & Paging>(paged("/customers/requests", page, q));

// Insights for managers, for a range of days (YYYY-MM-DD, in the company's time zone).
const range = (start: string, end: string) => `start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
export const insights = (start: string, end: string) => api<{ insights: Insights }>(`/insights?${range(start, end)}`);

/** Save the insights as an Excel workbook or a PDF: the browser's own download. */
export async function downloadInsights(kind: "xlsx" | "pdf", start: string, end: string) {
  const response = await fetch(apiUrl(`/api/insights/export.${kind}?${range(start, end)}`), { credentials: "include" }).catch(() => {
    throw new ApiError(t("The download failed. Check your connection and try again."), 0, {});
  });
  if (!response.ok) {
    const data: ErrorBody = await response.json().catch(() => ({}));
    throw new ApiError(data.error || t("The download failed. Check your connection and try again."), response.status, data);
  }
  const name = /filename="?([^";]+)"?/.exec(response.headers.get("Content-Disposition") || "")?.[1] || `insights.${kind}`;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(await response.blob());
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  return name;
}
export const company = () => api<{ company: Company }>("/company");

export const createJob = (data: Payload) => post<{ job: Job }>("/jobs", data);
export const updateJob = (id: number, data: Payload) => patch<{ job: Job }>(`/jobs/${id}`, data);
export const deleteJob = (id: number) => remove(`/jobs/${id}`);
export const invite = (data: Payload) => post<{ code: string; expires_at: string; emailed: boolean }>("/customers/invite", data);
export const createMachine = (data: Payload) => post<{ id: number; machine: Machine }>("/machines", data);
export const createRequest = (data: Payload) => post<{ id: number }>("/customers/requests", data);
export const updateMachine = (id: number, data: Payload) => patch<{ ok: true; machine: Machine }>(`/machines/${id}`, data);
export const updateCustomer = (id: number, data: Payload) => patch<{ ok: true; customer: Customer }>(`/customers/${id}`, data);
export const updateRequest = (id: number, data: Payload) => patch<{ ok: true; status: string; request: RequestDetail }>(`/customers/requests/${id}`, data);

// A request's page: its visits, booking a time, and the chat with the company
export const requestDetail = (id: number) => api<{ request: RequestDetail }>(`/customers/requests/${id}`);
export const requestSlots = (id: number) =>
  api<{ visit: Visit | null; minutes: number | null; moving?: number | null; slots: Slot[] }>(`/customers/requests/${id}/slots`);
export const bookVisit = (id: number, start: string) => post<{ request: RequestDetail }>(`/customers/requests/${id}/book`, { start });
export const cancelRequest = (id: number) => post<{ request: RequestDetail }>(`/customers/requests/${id}/cancel`, {});
export const conversations = () => api<{ conversations?: Conversation[]; unread: number }>("/messages");
export const customerThread = (customerId: number) => api<{ customer: { id: number; name: string }; messages: ChatMessage[] }>(`/messages/${customerId}`);
export const sendToCustomer = (customerId: number, body: string) => post<{ message: ChatMessage }>(`/messages/${customerId}`, { body });
export const myThread = () => api<{ company: string; messages: ChatMessage[] }>("/messages/mine");
export const sendToCompany = (body: string) => post<{ message: ChatMessage }>("/messages/mine", { body });
export const onTheWay = (jobId: number) => post<{ job: Job }>(`/jobs/${jobId}/on-the-way`, {});
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

// The service catalog: managers keep it; customers see what they can book for a piece of equipment
export type ServiceDraft = Partial<Omit<CatalogService, "id" | "checklist" | "jobs">> & { checklist_id?: number | null };
export const catalog = () => api<{ services: CatalogService[] }>("/catalog");
export const bookableServices = (machineId: number) => api<{ services: BookableService[] }>(`/catalog?machine_id=${machineId}`);
export const createService = (data: ServiceDraft) => post<{ service: CatalogService }>("/catalog", data);
export const updateService = (id: number, data: ServiceDraft) => patch<{ service: CatalogService }>(`/catalog/${id}`, data);
export const deleteService = (id: number) => remove(`/catalog/${id}`);

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

// Equipment: its page, documents, maintenance plans, and customers' sites
export const machineDetail = (id: number) => api<{ machine: EquipmentDetail }>(`/machines/${id}`);
export const requestDocumentUpload = (machineId: number, data: { content_type: string; size: number; name: string }) =>
  post<{ file_id: number; upload: UploadTarget }>(`/machines/${machineId}/documents`, data);
export const confirmDocument = (machineId: number, fileId: number) => post<{ machine: EquipmentDetail }>(`/machines/${machineId}/documents/${fileId}/confirm`, {});
export const deleteDocument = (machineId: number, fileId: number) => remove<{ machine: EquipmentDetail }>(`/machines/${machineId}/documents/${fileId}`);
export const createPlan = (machineId: number, data: Payload) => post<{ machine: EquipmentDetail }>(`/machines/${machineId}/plans`, data);
export const updatePlan = (planId: number, data: Payload) => patch<{ machine: EquipmentDetail }>(`/plans/${planId}`, data);
export const deletePlan = (planId: number) => remove<{ machine: EquipmentDetail }>(`/plans/${planId}`);
export const createPlanJob = (planId: number) => post<{ job_id: number; machine: EquipmentDetail }>(`/plans/${planId}/job`, {});
export const sites = (customerId?: number) => api<{ sites: Site[] }>(customerId ? `/sites?customer_id=${customerId}` : "/sites");
export const createSite = (data: Payload) => post<{ site: Site }>("/sites", data);
export const updateSite = (id: number, data: Payload) => patch<{ site: Site }>(`/sites/${id}`, data);
export const deleteSite = (id: number) => remove(`/sites/${id}`);

/** Add a document to a piece of equipment: reserve, upload to the signed link, confirm. */
export async function uploadDocument(machineId: number, file: File) {
  const reserved = await requestDocumentUpload(machineId, { content_type: file.type || "application/octet-stream", size: file.size, name: file.name });
  await sendUpload(reserved.upload, file);
  return confirmDocument(machineId, reserved.file_id);
}

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
