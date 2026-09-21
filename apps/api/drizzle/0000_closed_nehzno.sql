CREATE TYPE "public"."quiz_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TABLE "exam_answers" (
	"session_id" uuid NOT NULL,
	"question_id" text NOT NULL,
	"value" jsonb NOT NULL,
	"client_seq" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_answers_session_id_question_id_pk" PRIMARY KEY("session_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "exam_links" (
	"token" varchar(128) PRIMARY KEY NOT NULL,
	"quiz_id" uuid NOT NULL,
	"opens_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" varchar(128) NOT NULL,
	"version_id" uuid NOT NULL,
	"student_ref" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"receipt_id" text,
	"idempotency_key" text,
	"client_version" text,
	"platform" text,
	"strikes" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proctor_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"kind" text NOT NULL,
	"at_client" bigint NOT NULL,
	"at_server" timestamp with time zone DEFAULT now() NOT NULL,
	"detail" text
);
--> statement-breakpoint
CREATE TABLE "quiz_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quiz_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"manifest" jsonb NOT NULL,
	"answer_key" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" uuid
);
--> statement-breakpoint
CREATE TABLE "quizzes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"status" "quiz_status" DEFAULT 'draft' NOT NULL,
	"draft_doc" jsonb NOT NULL,
	"active_version_id" uuid,
	"doc_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "teachers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teachers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "exam_answers" ADD CONSTRAINT "exam_answers_session_id_exam_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."exam_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_links" ADD CONSTRAINT "exam_links_quiz_id_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_token_exam_links_token_fk" FOREIGN KEY ("token") REFERENCES "public"."exam_links"("token") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_version_id_quiz_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."quiz_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proctor_events" ADD CONSTRAINT "proctor_events_session_id_exam_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."exam_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_versions" ADD CONSTRAINT "quiz_versions_quiz_id_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_versions" ADD CONSTRAINT "quiz_versions_published_by_teachers_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."teachers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_owner_id_teachers_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."teachers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_active_version_id_quiz_versions_id_fk" FOREIGN KEY ("active_version_id") REFERENCES "public"."quiz_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exam_links_quiz_idx" ON "exam_links" USING btree ("quiz_id");--> statement-breakpoint
CREATE INDEX "exam_sessions_token_idx" ON "exam_sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "exam_sessions_version_idx" ON "exam_sessions" USING btree ("version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "proctor_events_session_seq_idx" ON "proctor_events" USING btree ("session_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_versions_quiz_no_idx" ON "quiz_versions" USING btree ("quiz_id","version_no");--> statement-breakpoint
CREATE INDEX "quizzes_owner_updated_idx" ON "quizzes" USING btree ("owner_id","updated_at");