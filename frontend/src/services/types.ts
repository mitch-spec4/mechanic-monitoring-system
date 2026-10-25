// What the API sends back, field for field (see the `out()` functions in backend/app/routes).
// Dates are ISO strings; days ("YYYY-MM-DD") for due dates, moments in UTC for everything else.

export type Role = "boss" | "mechanic" | "customer";

/** A job in a list. */
export type Job = {
  id: number;
  title: string;
  description: string;
  priority: string;
  status: string;
  job_type: string | null;
  location: string | null;
  due_date: string | null;
  customer_id: number | null;
  machine_id: number | null;
  mechanic_id: number | null;
  /** A visit a customer booked: when, and since when the technician is on the way. */
  request_id?: number | null;
  visit?: Visit | null;
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  on_the_way_at?: string | null;
  /** Its place in the technician's planned route for route_date. */
  route_date?: string | null;
  route_order?: number | null;
  /** The service it was made from, and how long the work should take. */
  service?: JobService | null;
  estimated_minutes?: number | null;
  /** Changed on this phone, not yet on the server. */
  pending_status?: boolean;
};

/** A booked visit: the inspection, the repair after it, or a service booked directly. */
export type Visit = "inspection" | "repair" | "service";

/** The service a job or request was made from, with the skills the work needs. */
export type JobService = { id: number; name: string; skills: string[] };

/** How customers book a service: not at all, an inspection first, or the service directly. */
export type BookingType = "none" | "inspection" | "direct";

/** A service in the company's catalog (app/routes/catalog.py). */
export type CatalogService = {
  id: number;
  name: string;
  description: string | null;
  equipment_type: string | null;
  checklist: { id: number; job_type: string; items: number } | null;
  duration_minutes: number;
  skills: string[];
  booking: BookingType;
  active: boolean;
  /** How many jobs were made from it. */
  jobs: number;
};

/** What a customer sees of a service they can book. */
export type BookableService = Pick<CatalogService, "id" | "name" | "description" | "equipment_type" | "duration_minutes" | "booking">;

/** Why a piece of equipment needs work: an open job or request, or its status. */
export type WorkReason =
  | { type: "job" | "request"; id: number; title: string; status: string }
  | { type: "maintenance"; id: number; title: string; status: string; due: string }
  | { type: "status"; status: string };

export type Machine = {
  id: number;
  name: string;
  model: string | null;
  serial_no: string;
  customer_id: number;
  status: string;
  equipment_type?: string | null;
  manufacturer?: string | null;
  site_id?: number | null;
  installed_on?: string | null;
  notes?: string | null;
  /** In the manager's list: what makes it need work, and faults in the last 90 days (2+ is a repeat fault). */
  work?: WorkReason[];
  needs_work?: boolean;
  repeat_faults?: number;
};

/** A place a customer has equipment. */
/** A pin on the map. */
export type Position = { latitude: number; longitude: number };

export type Site = { id: number; customer_id?: number; name: string; address: string | null; notes: string | null; position?: Position | null; machine_count?: number };

/** Service a piece of equipment needs every N days, weeks or months. */
export type MaintenancePlan = {
  id: number;
  machine_id: number;
  title: string;
  job_type: string | null;
  every: number;
  unit: "days" | "weeks" | "months";
  next_due: string;
  lead_days: number;
  active: boolean;
  last_done: string | null;
  state: "scheduled" | "due" | "overdue" | "paused";
  open_job_id: number | null;
};

export type EquipmentDocument = {
  id: number;
  name: string;
  content_type: string;
  size_bytes: number;
  url: string;
  created_at: string;
  uploaded_by: string | null;
  uploaded_by_id: number;
};

/** A piece of equipment's page: its details, plans, documents and everything done on it. */
export type EquipmentDetail = Machine & {
  customer: { id: number; name: string } | null;
  site: Site | null;
  repeat_fault: { count: number; days: number } | null;
  plans: MaintenancePlan[];
  documents: EquipmentDocument[];
  photos: { id: number; kind: string; content_type: string; url: string; job_id: number; created_at: string }[];
  jobs: { id: number; title: string; status: string; job_type: string | null; due_date: string | null; scheduled_start: string | null; created_at: string; mechanic: string | null; plan_id: number | null; can_open: boolean }[];
  faults: { record_id: number; job_id: number | null; date: string; problem: string; solution: string | null }[];
  records: ServiceRecord[];
  can_edit: boolean;
  can_add_documents: boolean;
  /** Forms completed on its jobs (customers: the certificates). */
  certificates: Certificate[];
  document_mb: number;
};

/** Equipment on a customer's page, with what makes it need work. */
export type EquipmentSummary = Machine & { work: WorkReason[]; needs_work: boolean };

export type Customer = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  user_id: number | null;
  two_factor_enabled: boolean;
};

/** A customer in the customer list: how much equipment they have, and how much needs work. */
export type CustomerSummary = Customer & { machine_count: number; needs_work_count: number };

export type ServiceRecord = {
  id: number;
  job_id: number | null;
  machine_id: number;
  customer_id: number;
  mechanic_id: number | null;
  service_type: string;
  problem: string | null;
  work_done: string | null;
  parts_replaced: string | null;
  solution: string | null;
  advice: string | null;
  service_date: string;
};

export type CustomerDetail = Customer & {
  sites: Site[];
  machines: EquipmentSummary[];
  needs_work_count: number;
  job_count: number;
  completed_job_count: number;
  records: ServiceRecord[];
};

export type ServiceRequest = {
  id: number;
  machine_id: number;
  customer_id: number;
  subject: string;
  description: string;
  priority: string;
  status: string;
  created_at: string;
  updated_at?: string | null;
  /** The service picked from the catalog, and whether it's booked directly or after an inspection. */
  service?: JobService | null;
  booking?: "inspection" | "direct";
};

/** A visit as a request's page shows it; findings and photos once it's done. */
export type RequestVisit = {
  job_id: number;
  visit: Visit;
  status: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  on_the_way_at: string | null;
  technician: { id: number; name: string } | null;
  findings: { problem: string | null; solution: string | null; advice: string | null; work_done: string | null } | null;
  photos: { id: number; kind: string; content_type: string; url: string }[];
};

export type RequestDetail = ServiceRequest & {
  machine: { id: number; name: string; serial_no: string } | null;
  customer: { id: number; name: string } | null;
  inspection_minutes: number;
  repair_minutes: number;
  visits: RequestVisit[];
  /** What the customer can book now, if anything. */
  can_book: Visit | null;
  /** A visit is booked and hasn't started: it can move. */
  can_move: boolean;
  can_cancel: boolean;
};

/** A time a visit can start (UTC, without a zone marker). */
export type Slot = { start: string; end: string };

export type ChatMessage = { id: number; body: string; created_at: string; from_customer: boolean; sender: string | null; mine: boolean; read_at: string | null };

export type Conversation = {
  customer_id: number;
  customer: string;
  last: { body: string; created_at: string; from_customer: boolean };
  unread: number;
};

export type Review = {
  id: number;
  rating: number;
  comment: string | null;
  advice: string | null;
  mechanic_id: number | null;
  machine_id: number;
  service_record_id: number;
  created_at: string;
};

export type Notification = { id: number; title: string; message: string; type: string; is_read: boolean; created_at: string };

export type Mechanic = { id: number; name: string; email: string; two_factor_enabled: boolean; pay_rate_cents?: number | null };

export type Company = { id: number; name: string; location: string | null; contacts: { name: string; email: string }[] };

export type Report = {
  jobs: { total: number; pending: number; in_progress: number; completed: number; cancelled: number };
  rating: number | null;
  review_count: number;
  service_records: number;
  totals: { customers?: number; machines?: number; storage_bytes?: number; open_requests?: number };
};

export type Checklist = { id: number; job_type: string; items: { id: number; label: string; required: boolean }[] };

// ---------- Clock in and location ----------

export type LocationPoint = {
  kind: string;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  missing_reason: string | null;
  recorded_at: string;
  job_id: number | null;
};

export type Shift = {
  id: number;
  user_id: number;
  mechanic: string | null;
  clocked_in_at: string;
  clocked_out_at: string | null;
  open: boolean;
  hours: number;
  long: boolean;
  edited: boolean;
  edited_by: string | null;
  original_clocked_out_at: string | null;
  clock_in_location: LocationPoint | null;
  clock_out_location: LocationPoint | null;
  pending?: boolean;
};

export type ShiftStatus = { consent: boolean; consent_at: string | null; shift: Shift | null; paused_jobs?: string[] };

/** A clocked-in technician on the team map. `last` is their latest stamp that has a position. */
export type TeamMember = {
  user_id: number;
  name: string;
  clocked_in_at: string;
  last: (LocationPoint & { latitude: number; longitude: number }) | null;
  job: { id: number; title: string } | null;
};

// ---------- A job's page ----------

// `pending`: made on this phone, not yet on the server.
export type Part = { id: number; name: string; quantity: number; label: string; added_by?: string | null; pending?: boolean };
export type ChecklistItem = {
  id: number;
  label: string;
  required: boolean;
  done: boolean;
  note?: string | null;
  done_by?: string | null;
  done_at?: string | null;
  pending?: boolean;
};
export type WorkEntry = {
  id: number;
  mechanic: string | null;
  started_at: string;
  ended_at: string | null;
  running: boolean;
  hours: number;
  site: string | null;
  work_done: string | null;
  pending?: boolean;
};
export type JobEvent = {
  id: number;
  action: string;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  user: string | null;
  created_at: string;
  /** Done offline: when it reached the server. */
  synced_at?: string | null;
  pending?: boolean;
};
export type JobFile = { id: number; kind: string; content_type: string; size_bytes: number; url: string; created_at: string; uploaded_by?: string | null; pending?: boolean };
export type Signature = { name: string; signed_at: string; url: string | null } | { not_signed_reason: string };
export type MediaLimits = { photo_mb: number; video_mb: number; video_seconds: number };

export type JobDetail = {
  id: number;
  title: string;
  description: string;
  status: string;
  priority: string;
  job_type: string | null;
  location: string | null;
  due_date: string | null;
  request_id?: number | null;
  visit?: Visit | null;
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  on_the_way_at?: string | null;
  service?: JobService | null;
  estimated_minutes?: number | null;
  customer: { id: number; name: string } | null;
  machine: { id: number; name: string; serial_no: string } | null;
  mechanic: { id: number; name: string | null } | null;
  parts: Part[];
  checklist: ChecklistItem[];
  work_done: string[];
  files: JobFile[];
  signature: Signature | null;
  report_url: string | null;
  record: Pick<ServiceRecord, "id" | "service_type" | "problem" | "solution" | "advice" | "work_done" | "parts_replaced"> | null;
  // Left out for customers:
  entries?: WorkEntry[];
  total_hours?: number;
  timer_running?: boolean;
  history?: JobEvent[];
  locations?: LocationPoint[];
  /** Where it is (its equipment's site), for directions. */
  position?: Position | null;
  /** Managers only: what it cost and made. */
  costing?: Costing;
  can_edit?: boolean;
  can_upload?: boolean;
  media_limits?: MediaLimits;
  completion_blockers?: string[];
  /** The forms on the job (customers: completed certificates only). */
  forms?: JobForm[];
  // Changed on this phone, not yet on the server:
  pending_status?: boolean;
  record_pending?: boolean;
};

// ---------- Billing ----------

export type Subscription = {
  plan: string;
  plan_name: string;
  interval: "month" | "year";
  /** Technicians bought on top of the plan's own. */
  extra_mechanics: number;
  /** past_due: the paid period is over and its renewal unpaid, within the grace days. */
  state: "trialing" | "active" | "past_due" | "expired";
  trial_ends_at: string | null;
  current_period_end: string | null;
  days_left: number | null;
  /** Off once the manager cancels: the plan then ends with its paid period. */
  auto_renew: boolean;
  /** The saved card or wallet renewals charge, e.g. "Visa •••• 4081". */
  payment_method: string | null;
  /** A renewal is unpaid (declined, or nothing saved to charge): pay by grace_ends_at. */
  payment_problem: boolean;
  grace_ends_at: string | null;
};

/** What a plan can include beyond the basics (see backend/app/services/plans.py). */
export type Feature = "insights" | "maintenance" | "routes" | "costing" | "forms";

export type Payment = {
  reference: string;
  /** checkout (the manager paid) or renewal (the saved card was charged). */
  kind: "checkout" | "renewal";
  plan: string;
  plan_name: string;
  interval: "month" | "year";
  extra_mechanics: number;
  amount_cents: number;
  currency: string;
  provider: string;
  status: "pending" | "paid" | "failed";
  failure_reason: string | null;
  created_at: string;
  paid_at: string | null;
  failed_at: string | null;
};

export type Usage = { mechanics: number; mechanic_limit: number | null; storage_bytes: number; storage_limit_bytes: number | null };

/** The body of an error reply: always a message, sometimes more (what blocks a job, say). */
export type ErrorBody = {
  error?: string;
  message?: string;
  msg?: string;
  restart?: boolean;
  locked?: boolean;
  two_factor_setup?: boolean;
  needs_signature?: boolean;
  blockers?: string[];
};

/** What forms send: their fields as typed. */
export type Payload = Record<string, FormDataEntryValue | string | number | boolean | Position | null | undefined>;

// ---------- Accounts, settings and plans ----------

export type TwoFactorSetup = { setup_token: string; secret: string; secret_grouped: string; otpauth_uri: string; qr_svg: string };
export type TwoFactorStatus = { enabled: boolean; required: boolean; backup_codes_left: number };
export type LegalDocument = { name: string; version: string; text: string };
export type AuditEvent = { id: number; action: string; user: string | null; detail: string | null; ip: string | null; created_at: string };
/** A one-time password reset code a manager hands on. */
export type IssuedCode = { code: string; email: string; name: string; expires_at: string };
export type SetupStepKey = "verify" | "customer" | "machine" | "mechanic" | "job";
export type SetupStepState = { key: SetupStepKey; done: boolean; waiting?: boolean };

export type Interval = "month" | "year";
export type Plan = { key: string; name: string; mechanics: number; storage_gb: number; features: Feature[]; prices: Record<Interval, number> };
export type Pricing = {
  plans: Plan[];
  currency: string;
  trial_days: number;
  yearly_months: number;
  /** Each technician beyond a plan's own, a month (a year costs yearly_months of it). */
  extra_mechanic_cents: number;
  max_extra_mechanics: number;
  payment_provider: string | null;
};

/** Where a page of a long list sits. */
export type Paging = { page: number; per_page: number; total: number; pages: number };

export type TechnicianInsight = {
  id: number;
  name: string;
  clocked_hours: number;
  job_hours: number;
  /** Job hours as a share of clocked hours, 0-100 (null with no clocked hours). */
  share_on_jobs: number | null;
  jobs_completed: number;
  median_hours_to_complete: number | null;
  rating: number | null;
  reviews: number;
};

/** A manager's view of a range of days: see backend/app/services/insights.py. */
export type Insights = {
  range: { start: string; end: string; days: number; unit: "day" | "week" };
  jobs: {
    created: number;
    completed: number;
    cancelled: number;
    median_hours_to_complete: number | null;
    average_hours_to_complete: number | null;
    average_hours_worked: number | null;
  };
  hours: { clocked: number; on_jobs: number };
  completed_over_time: { start: string; count: number }[];
  by_type: { job_type: string; count: number }[];
  technicians: TechnicianInsight[];
  repeat_faults: { machine_id: number; name: string; equipment_type: string | null; customer: string | null; faults: number; last_fault: string | null }[];
  /** The completed jobs' costing, in cents (null on plans without job costing). */
  money: {
    currency: string;
    labour_cents: number;
    parts_cents: number;
    cost_cents: number;
    charged_jobs: number;
    charged_cents: number;
    margin_cents: number | null;
    incomplete_jobs: number;
  } | null;
};

/** What a job cost and made (managers only), in cents of the company's currency. */
export type Costing = {
  labour: { mechanic_id: number; name: string | null; hours: number; rate_cents: number | null; cost_cents: number | null }[];
  parts: { id: number; name: string; quantity: number; unit_cost_cents: number | null; cost_cents: number | null }[];
  labour_cents: number;
  parts_cents: number;
  cost_cents: number;
  charged_cents: number | null;
  margin_cents: number | null;
  margin_percent: number | null;
  missing_rates: (string | null)[];
  missing_costs: string[];
};

/** What a question asks for (backend/app/services/forms.py). */
export type FormFieldType = "heading" | "text" | "number" | "yesno" | "choice" | "date" | "photo" | "signature";

/** One question of a form's version. */
export type FormField = {
  id: string;
  type: FormFieldType;
  label: string;
  help?: string;
  required?: boolean;
  /** Text: a box for longer answers. */
  long?: boolean;
  /** Choice: what can be picked. */
  options?: string[];
  /** Only asked when an earlier yes/no or choice question has this answer. */
  show_if?: { field: string; equals: string };
};

/** An answer as stored: text, a number, "yes"/"no", a choice, a date, or a signer's name. */
export type FormAnswer = string | number | { name: string };

/** A form built by the managers (the Forms page). */
export type CustomForm = {
  id: number;
  name: string;
  description: string | null;
  job_types: string[];
  service_ids: number[];
  required: boolean;
  customer_visible: boolean;
  active: boolean;
  version: { id: number; number: number; fields: FormField[] } | null;
  /** How many jobs it was filled in on. */
  submissions: number;
};

/** A form on a job, and what was filled in. */
export type JobForm = {
  form_id: number;
  name: string;
  description: string | null;
  required: boolean;
  customer_visible: boolean;
  /** The certificate, once completed. */
  pdf_url: string | null;
  completed_at: string | null;
  // Left out for customers:
  version?: { id: number; number: number; fields: FormField[] } | null;
  submission?: {
    status: "draft" | "completed";
    answers: Record<string, FormAnswer>;
    updated_at: string | null;
    updated_by: string | null;
    completed_by: string | null;
    photos: Record<string, { id: number; url: string; content_type: string; pending?: boolean }[]>;
    signatures: Record<string, { url: string | null; name: string | null; signed_at: string | null }>;
    /** Changed on this phone, not yet on the server. */
    pending?: boolean;
  } | null;
};

/** A completed form on a piece of equipment's jobs. */
export type Certificate = { form_id: number; name: string; job_id: number; job_title: string; completed_at: string | null; customer_visible: boolean; pdf_url: string };

export type RouteStop = {
  job_id: number;
  title: string;
  customer: string | null;
  location: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  scheduled_start: string | null;
  estimated_minutes: number | null;
  latitude: number | null;
  longitude: number | null;
  /** On planned stops: its number and the drive to it. */
  stop?: number;
  leg_seconds?: number;
  leg_metres?: number;
};

/** A technician's day: the suggested order of their jobs, and the drive it saves (app/services/routing.py). */
export type RoutePlan = {
  date: string;
  mechanic: { id: number; name: string };
  /** The day's work (estimates and booked visits) against the working day, in minutes. */
  work: { minutes: number; unestimated: number; day_minutes: number };
  start: { kind: "position" | "base" | "first_stop"; latitude: number | null; longitude: number | null };
  estimate: "straight_line" | "openrouteservice";
  fell_back: boolean;
  stops: RouteStop[];
  suggested: { job_ids: number[]; seconds: number; metres: number };
  current: { job_ids: number[]; seconds: number; metres: number };
  applied: boolean;
  booked: RouteStop[];
  unplaced: RouteStop[];
};
