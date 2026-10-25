PRIORITIES = ("Low", "Medium", "High", "Urgent")
DEFAULT_PRIORITY = "Medium"

JOB_STATUSES = ("Pending", "Assigned", "Accepted", "In Progress", "Paused", "Completed", "Cancelled")
ACTIVE_JOB_STATUSES = ("Pending", "Assigned", "Accepted", "In Progress", "Paused")

# A customer's request: they book an inspection, the technician inspects, they book the repair.
# For a service booked directly: they book the service visit, then it's done.
REQUEST_STATUSES = ("Submitted", "Inspection booked", "Inspected", "Repair booked", "Service booked", "Completed", "Declined", "Cancelled")
# What a manager can set by hand; the booked steps follow the visits.
MANUAL_REQUEST_STATUSES = ("Submitted", "Inspected", "Completed", "Declined", "Cancelled")
CLOSED_REQUEST_STATUSES = ("Completed", "Declined", "Cancelled")
VISITS = ("inspection", "repair", "service")

MACHINE_STATUSES = ("Operational", "Under Maintenance", "Under Repair", "Retired")
ROLES = ("boss", "mechanic", "customer")
