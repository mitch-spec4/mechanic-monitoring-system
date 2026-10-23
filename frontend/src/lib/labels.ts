import { mark } from "../i18n";

// Values the server stores in English. Show them with t(value); send the English value back.
export const PRIORITIES = [mark("Low"), mark("Medium"), mark("High"), mark("Urgent")];
export const JOB_STATUSES = [mark("Pending"), mark("Assigned"), mark("Accepted"), mark("In Progress"), mark("Paused"), mark("Completed"), mark("Cancelled")];
export const REQUEST_STATUSES = [
  mark("Submitted"),
  mark("Received"),
  mark("Reviewing"),
  mark("Approved"),
  mark("Mechanic Assigned"),
  mark("Scheduled"),
  mark("In Progress"),
  mark("Completed"),
  mark("Cancelled"),
];
export const EQUIPMENT_STATUSES = [mark("Operational"), mark("Under Maintenance"), mark("Under Repair"), mark("Retired")];

/** The class a status gets for its colour: "In Progress" -> "inprogress". */
export const statusClass = (status?: string | null) => String(status || "").replace(/ /g, "").toLowerCase();
