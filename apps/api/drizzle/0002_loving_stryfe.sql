CREATE TABLE "quiz_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quiz_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quiz_media" ADD CONSTRAINT "quiz_media_quiz_id_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_media" ADD CONSTRAINT "quiz_media_uploaded_by_teachers_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."teachers"("id") ON DELETE no action ON UPDATE no action;