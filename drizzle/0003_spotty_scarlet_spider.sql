CREATE TABLE "dismissed_jobs" (
	"key" text PRIMARY KEY NOT NULL,
	"company" text,
	"role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
