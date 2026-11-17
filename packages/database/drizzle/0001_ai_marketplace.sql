CREATE TABLE "agent_conversation_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"is_group" boolean DEFAULT false NOT NULL,
	"memory_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_type" varchar(8) NOT NULL,
	"sender_user_id" uuid,
	"content" text NOT NULL,
	"token_count" integer DEFAULT 0 NOT NULL,
	"moderation_status" varchar(8) DEFAULT 'ok' NOT NULL,
	"client_message_id" uuid,
	"reply_to_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_messages_sender_check" CHECK ("agent_messages"."sender_type" in ('user', 'agent', 'system')),
	CONSTRAINT "agent_messages_moderation_check" CHECK ("agent_messages"."moderation_status" in ('ok', 'flagged', 'blocked'))
);
--> statement-breakpoint
CREATE TABLE "agent_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"product_id" uuid,
	"period_start" date NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "agent_usage_period_unique" UNIQUE NULLS NOT DISTINCT("user_id","agent_id","product_id","period_start")
);
--> statement-breakpoint
CREATE TABLE "agent_user_memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"memory" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"persona" jsonb NOT NULL,
	"system_prompt" text NOT NULL,
	"model_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"voice_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"allowed_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"safety_profile" varchar(32) DEFAULT 'standard' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"slug" varchar(40) NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"product_type" varchar(16) DEFAULT 'chat' NOT NULL,
	"free_quota" integer DEFAULT 0 NOT NULL,
	"price_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_products_type_check" CHECK ("ai_products"."product_type" in ('chat', 'tool', 'subscription')),
	CONSTRAINT "ai_products_free_quota_check" CHECK ("ai_products"."free_quota" >= 0)
);
--> statement-breakpoint
CREATE TABLE "market_shops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_id" varchar(40) NOT NULL,
	"slug" varchar(40) NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"position" jsonb NOT NULL,
	"interior_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"owner_type" varchar(16) DEFAULT 'platform' NOT NULL,
	"owner_id" uuid,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_shops_slug_unique" UNIQUE("slug"),
	CONSTRAINT "market_shops_status_check" CHECK ("market_shops"."status" in ('draft', 'in_review', 'active', 'suspended')),
	CONSTRAINT "market_shops_owner_type_check" CHECK ("market_shops"."owner_type" in ('platform', 'partner'))
);
--> statement-breakpoint
CREATE TABLE "product_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_reviews_rating_check" CHECK ("product_reviews"."rating" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "moderation_reports" DROP CONSTRAINT "moderation_reports_target_check";--> statement-breakpoint
ALTER TABLE "agent_conversation_members" ADD CONSTRAINT "agent_conversation_members_conversation_id_agent_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_conversation_members" ADD CONSTRAINT "agent_conversation_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_conversation_id_agent_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_reply_to_id_agent_messages_id_fk" FOREIGN KEY ("reply_to_id") REFERENCES "public"."agent_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_usage" ADD CONSTRAINT "agent_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_usage" ADD CONSTRAINT "agent_usage_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_usage" ADD CONSTRAINT "agent_usage_product_id_ai_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."ai_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_user_memory" ADD CONSTRAINT "agent_user_memory_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_user_memory" ADD CONSTRAINT "agent_user_memory_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_shop_id_market_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."market_shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_products" ADD CONSTRAINT "ai_products_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_shops" ADD CONSTRAINT "market_shops_zone_id_world_zones_slug_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."world_zones"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_shops" ADD CONSTRAINT "market_shops_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_product_id_ai_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."ai_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_conversation_members_unique" ON "agent_conversation_members" USING btree ("conversation_id","user_id");--> statement-breakpoint
CREATE INDEX "agent_conversation_members_user_idx" ON "agent_conversation_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_conversations_user_idx" ON "agent_conversations" USING btree ("user_id","last_message_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agent_conversations_agent_idx" ON "agent_conversations" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_messages_conversation_idx" ON "agent_messages" USING btree ("conversation_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "agent_messages_client_id_idx" ON "agent_messages" USING btree ("conversation_id","client_message_id");--> statement-breakpoint
CREATE INDEX "agent_messages_reply_idx" ON "agent_messages" USING btree ("reply_to_id");--> statement-breakpoint
CREATE INDEX "agent_usage_agent_period_idx" ON "agent_usage" USING btree ("agent_id","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_user_memory_unique" ON "agent_user_memory" USING btree ("agent_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agents_shop_idx" ON "ai_agents" USING btree ("shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_products_agent_slug_idx" ON "ai_products" USING btree ("agent_id","slug");--> statement-breakpoint
CREATE INDEX "market_shops_zone_idx" ON "market_shops" USING btree ("zone_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_reviews_unique" ON "product_reviews" USING btree ("product_id","user_id");--> statement-breakpoint
ALTER TABLE "moderation_reports" ADD CONSTRAINT "moderation_reports_target_check" CHECK ("moderation_reports"."target_type" in ('user', 'post', 'comment', 'agent_message'));