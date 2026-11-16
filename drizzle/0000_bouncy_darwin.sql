CREATE TABLE "calls" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text,
	"company_id" text,
	"phone" text,
	"outcome" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"website" text,
	"linkedin" text,
	"size" text,
	"stage" text,
	"industry" text,
	"location" text,
	"address" text,
	"phone" text,
	"about" text,
	"stack" text,
	"region" text,
	"open_roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enriched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"company" text,
	"name" text NOT NULL,
	"title" text,
	"email" text,
	"email_status" text,
	"phone" text,
	"linkedin" text,
	"timezone" text,
	"status" text DEFAULT 'To contact' NOT NULL,
	"opted_out" boolean DEFAULT false NOT NULL,
	"source" text,
	"notes" text,
	"last_contacted" text,
	"next_follow_up" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"company" text NOT NULL,
	"role" text NOT NULL,
	"link" text,
	"status" text DEFAULT 'Found' NOT NULL,
	"fit" text,
	"score" integer,
	"source" text,
	"source_id" text,
	"pay" text,
	"tier" text,
	"mode" text,
	"location" text,
	"description" text,
	"found" text,
	"applied" text,
	"follow_up" text,
	"contact" text,
	"next" text,
	"notes" text,
	"cover" text,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"company_id" text,
	"cv_variant" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text,
	"contact_id" text,
	"company_id" text,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"cv_variant" jsonb,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"message_id" text,
	"follow_up_of" text,
	"sent_at" timestamp with time zone,
	"replied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"step" text,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"log" text DEFAULT '' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spend" (
	"id" text PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"items" integer DEFAULT 0 NOT NULL,
	"usd" real DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
