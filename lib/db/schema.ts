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
  pay: text("pay"),
  tier: text("tier"),
  mode: text("mode"),
  location: text("location"),
  description: text("description"),
  found: text("found"),
  applied: text("applied"),
  followUp: text("follow_up"),
  contact: text("contact"),
  next: text("next"),
  notes: text("notes"),
  cover: text("cover"),
  flags: jsonb("flags").$type<string[]>().notNull().default([]),
  companyId: text("company_id"),
  cvVariant: jsonb("cv_variant").$type<CvVariant | null>(),
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
