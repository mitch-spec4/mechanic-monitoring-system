const BASE = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:5000/api").replace(/\/$/, "");

export async function api(path: string, options: RequestInit = {}) {
  const token = localStorage.getItem("token");
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${BASE}${path.startsWith("/") ? path : `/${path}`}`, {
    ...options,
    headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.message || `Request failed (${response.status})`);
  }
  return data;
}

export const login = (email: string, password: string) =>
  api("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
export const acceptInvitation = (invitation: any) =>
  api("/auth/accept-invitation", { method: "POST", body: JSON.stringify(invitation) });

export const jobs = () => api("/jobs");
export const notifications = () => api("/notifications");
export const machines = () => api("/machines");
export const services = () => api("/services");
export const customers = () => api("/customers");
export const mechanics = () => api("/users/mechanics");
export const reviews = () => api("/reviews");
export const requests = () => api("/customers/requests");

export const createJob = (data: any) => api("/jobs", { method: "POST", body: JSON.stringify(data) });
export const updateJob = (id: number, data: any) => api(`/jobs/${id}`, { method: "PATCH", body: JSON.stringify(data) });
export const invite = (data: any) => api("/customers/invite", { method: "POST", body: JSON.stringify(data) });
export const createMachine = (data: any) => api("/machines", { method: "POST", body: JSON.stringify(data) });
export const createService = (data: any) => api("/services", { method: "POST", body: JSON.stringify(data) });
export const createRequest = (data: any) => api("/customers/requests", { method: "POST", body: JSON.stringify(data) });
export const createReview = (data: any) => api("/reviews", { method: "POST", body: JSON.stringify(data) });
export const deleteJob = (id: number) => api(`/jobs/${id}`, { method: "DELETE" });
export const reports = () => api("/reports");
