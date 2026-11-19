CREATE TABLE "academy_xp_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"xp" integer NOT NULL,
	"lesson_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academy_xp_events_xp_check" CHECK ("academy_xp_events"."xp" > 0)
);
--> statement-breakpoint
ALTER TABLE "academy_xp_events" ADD CONSTRAINT "academy_xp_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_xp_events" ADD CONSTRAINT "academy_xp_events_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "academy_xp_events_created_idx" ON "academy_xp_events" USING btree ("created_at","user_id");--> statement-breakpoint
CREATE INDEX "academy_xp_events_user_idx" ON "academy_xp_events" USING btree ("user_id","created_at");--> statement-breakpoint
-- Lessons completed before this migration count as XP earned when they were completed.
INSERT INTO "academy_xp_events" ("user_id", "xp", "lesson_id", "created_at")
SELECT p."user_id", l."xp_reward", p."lesson_id", p."completed_at"
FROM "lesson_progress" p JOIN "lessons" l ON l."id" = p."lesson_id"
WHERE p."status" = 'completed' AND p."completed_at" IS NOT NULL AND l."xp_reward" > 0;
