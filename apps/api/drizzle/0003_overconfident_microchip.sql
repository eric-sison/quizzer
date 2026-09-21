ALTER TABLE "quiz_media" DROP CONSTRAINT "quiz_media_uploaded_by_teachers_id_fk";
--> statement-breakpoint
ALTER TABLE "quiz_media" ADD CONSTRAINT "quiz_media_uploaded_by_teachers_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."teachers"("id") ON DELETE cascade ON UPDATE no action;