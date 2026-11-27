ALTER TABLE "companies" ADD COLUMN "research" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "researched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "pitch" jsonb;