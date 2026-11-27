import { profileIsReady } from "@/lib/cv/types";

/**
 * The pipeline steps, in run order: find, store and score, enrich, draft.
 * Each step lives in its own file; this one keeps the import path stable.
 */
export { findJobs, type Log } from "./find";
export { scoreNewJobs, storeJobs, upsertCompany } from "./store";
export { companiesToEnrich, enrichCompanies } from "./enrich";
export { bestContact, checkReplies, draftFollowUps, draftForJob, draftStrongJobs, writeApplication } from "./draft";

export { profileIsReady };
