CREATE TABLE "ats_boards" (
	"id" text PRIMARY KEY NOT NULL,
	"ats" text NOT NULL,
	"slug" text NOT NULL,
	"company" text,
	"checked_at" timestamp with time zone,
	"failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "kind" text DEFAULT 'listing' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "also_on" jsonb DEFAULT '[]'::jsonb NOT NULL;