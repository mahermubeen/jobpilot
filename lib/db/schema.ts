import {
  boolean,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type { CvVariant } from "@/lib/cv/types";

/** The idea a cover letter is built on. buildPlan is for the user only, never sent. */
export type Pitch = {
  subject: string;
  research: string;
  problem: string;
  approach: string;
  buildPlan: string[];
};

const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const jobs = pgTable("jobs", {
  id: text("id").primaryKey(),
  company: text("company").notNull(),
  role: text("role").notNull(),
  link: text("link"),
  status: text("status").notNull().default("Found"),
  fit: text("fit"),
  score: integer("score"),
  source: text("source"),
  sourceId: text("source_id"),
  /** "listing" for a job ad, "post" for a social post announcing a job. */
  kind: text("kind").notNull().default("listing"),
  /** Other sources that listed the same job when it was found. */
  alsoOn: jsonb("also_on").$type<string[]>().notNull().default([]),
  pay: text("pay"),
  tier: text("tier"),
  mode: text("mode"),
  location: text("location"),
  description: text("description"),
  found: text("found"),
  /** When the board says the job was posted, if it said. */
  postedAt: timestamp("posted_at", { withTimezone: true }),
  applied: text("applied"),
  followUp: text("follow_up"),
  contact: text("contact"),
  next: text("next"),
  notes: text("notes"),
  cover: text("cover"),
  flags: jsonb("flags").$type<string[]>().notNull().default([]),
  companyId: text("company_id"),
  cvVariant: jsonb("cv_variant").$type<CvVariant | null>(),
  /** The idea behind the cover letter: the problem, the build and how to demo it. */
  pitch: jsonb("pitch").$type<Pitch | null>(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const companies = pgTable("companies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  website: text("website"),
  linkedin: text("linkedin"),
  size: text("size"),
  stage: text("stage"),
  industry: text("industry"),
  location: text("location"),
  address: text("address"),
  phone: text("phone"),
  about: text("about"),
  stack: text("stack"),
  region: text("region"),
  openRoles: jsonb("open_roles")
    .$type<{ title: string; url?: string }[]>()
    .notNull()
    .default([]),
  enrichedAt: timestamp("enriched_at", { withTimezone: true }),
  /** Plain text read from the company's own site, for writing cover letters. */
  research: text("research"),
  researchedAt: timestamp("researched_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const contacts = pgTable("contacts", {
  id: text("id").primaryKey(),
  companyId: text("company_id"),
  company: text("company"),
  name: text("name").notNull(),
  title: text("title"),
  email: text("email"),
  // verified | site | guessed | unknown
  emailStatus: text("email_status"),
  phone: text("phone"),
  linkedin: text("linkedin"),
  timezone: text("timezone"),
  status: text("status").notNull().default("To contact"),
  optedOut: boolean("opted_out").notNull().default(false),
  source: text("source"),
  notes: text("notes"),
  lastContacted: text("last_contacted"),
  nextFollowUp: text("next_follow_up"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const outbox = pgTable("outbox", {
  id: text("id").primaryKey(),
  jobId: text("job_id"),
  contactId: text("contact_id"),
  companyId: text("company_id"),
  to: text("to_email").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  cvVariant: jsonb("cv_variant").$type<CvVariant | null>(),
  // queued | approved | sending | sent | failed
  status: text("status").notNull().default("queued"),
  error: text("error"),
  messageId: text("message_id"),
  followUpOf: text("follow_up_of"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  repliedAt: timestamp("replied_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const calls = pgTable("calls", {
  id: text("id").primaryKey(),
  contactId: text("contact_id"),
  companyId: text("company_id"),
  phone: text("phone"),
  outcome: text("outcome").notNull(),
  note: text("note"),
  createdAt: createdAt(),
});

export const runs = pgTable("runs", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  // running | done | failed
  status: text("status").notNull().default("running"),
  step: text("step"),
  stats: jsonb("stats").$type<Record<string, number>>().notNull().default({}),
  log: text("log").notNull().default(""),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

/** Company job boards (Greenhouse, Lever, ...) that are checked directly every run. */
export const atsBoards = pgTable("ats_boards", {
  /** "greenhouse:stripe" */
  id: text("id").primaryKey(),
  ats: text("ats").notNull(),
  slug: text("slug").notNull(),
  company: text("company"),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  /** Failed checks in a row; boards that keep failing are skipped. */
  failures: integer("failures").notNull().default(0),
  createdAt: createdAt(),
});

/**
 * Keys of jobs you deleted (board id, link, company + role), so a later search
 * never adds them back. Only these keys are kept, not the job.
 */
export const dismissedJobs = pgTable("dismissed_jobs", {
  /** "link:indeed:abc123", "role:acme|senior fullstack developer", "id:LinkedIn|123" */
  key: text("key").primaryKey(),
  company: text("company"),
  role: text("role"),
  createdAt: createdAt(),
});

/** One row per paid scraper run, so the monthly cap can be enforced locally. */
export const spend = pgTable("spend", {
  id: text("id").primaryKey(),
  actor: text("actor").notNull(),
  items: integer("items").notNull().default(0),
  usd: real("usd").notNull().default(0),
  createdAt: createdAt(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
});

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Company = typeof companies.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type OutboxItem = typeof outbox.$inferSelect;
export type Call = typeof calls.$inferSelect;
export type Run = typeof runs.$inferSelect;
