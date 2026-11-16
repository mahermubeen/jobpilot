/** Fields the browser may set on each record. Anything else in a request is ignored. */
export const JOB_FIELDS = [
  "company", "role", "link", "status", "fit", "source", "pay", "tier", "mode",
  "location", "description", "found", "applied", "followUp", "contact", "next",
  "notes", "cover", "flags",
] as const;

export const COMPANY_FIELDS = [
  "name", "website", "linkedin", "size", "stage", "industry", "location",
  "address", "phone", "about", "stack", "region",
] as const;

export const CONTACT_FIELDS = [
  "name", "title", "company", "companyId", "email", "emailStatus", "phone",
  "linkedin", "timezone", "status", "optedOut", "notes", "lastContacted",
  "nextFollowUp",
] as const;

export const OUTBOX_FIELDS = ["to", "subject", "body", "status"] as const;

export const JOB_STATUSES = [
  "Found", "Drafted", "Applied", "Replied", "Interview", "Offer", "Rejected", "Skipped",
] as const;

export const CONTACT_STATUSES = [
  "To contact", "Emailed", "Called", "Replied", "Meeting", "Not interested", "Do not contact",
] as const;

export const CALL_OUTCOMES = [
  "No answer", "Voicemail", "Talked - interested", "Talked - not now", "Wrong number",
] as const;
