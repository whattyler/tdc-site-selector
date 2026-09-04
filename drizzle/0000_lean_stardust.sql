CREATE TYPE "public"."comp_type" AS ENUM('apartment', 'retail', 'office');--> statement-breakpoint
CREATE TYPE "public"."cost_basis" AS ENUM('per_resi_gsf', 'per_retail_sf', 'per_office_sf', 'per_space', 'per_unit', 'pct_hard', 'pct_total', 'lump');--> statement-breakpoint
CREATE TYPE "public"."cost_source" AS ENUM('medley', 'ccc', 'custom');--> statement-breakpoint
CREATE TYPE "public"."deal_status" AS ENUM('draft', 'screened', 'pursuing', 'passed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."demographic_band" AS ENUM('GO', 'WATCH', 'NO-GO');--> statement-breakpoint
CREATE TYPE "public"."demographics_source" AS ENUM('api', 'manual');--> statement-breakpoint
CREATE TYPE "public"."ko_result" AS ENUM('PASS', 'FAIL');--> statement-breakpoint
CREATE TYPE "public"."product_type" AS ENUM('auto', 'mixed_use', 'multifamily');--> statement-breakpoint
CREATE TYPE "public"."screen_answer" AS ENUM('yes', 'maybe', 'no');--> statement-breakpoint
CREATE TYPE "public"."verdict" AS ENUM('GO', 'WATCH', 'NO-GO', 'INCOMPLETE', 'NOT SCORED');--> statement-breakpoint
CREATE TABLE "assumptions" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text,
	"source" text,
	"asof" date
);
--> statement-breakpoint
CREATE TABLE "comps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"place_id" text,
	"name" text NOT NULL,
	"type" "comp_type" NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"distance_mi" numeric(8, 3),
	"year_built" integer,
	"units" integer,
	"rent_psf" numeric(10, 4),
	"rent_source" text,
	"ai_draft" boolean DEFAULT false NOT NULL,
	"include" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_library" (
	"line_key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"basis" "cost_basis" NOT NULL,
	"medley_rate" numeric(14, 4),
	"medley_asof" date,
	"ccc_rate" numeric(14, 4),
	"ccc_asof" date,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "cost_library_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"who" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"line_key" text NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text
);
--> statement-breakpoint
CREATE TABLE "cost_lines" (
	"deal_id" uuid NOT NULL,
	"line_key" text NOT NULL,
	"source" "cost_source" NOT NULL,
	"multiplier" numeric(6, 4) DEFAULT 1 NOT NULL,
	"custom_rate" numeric(14, 4),
	"resolved_rate" numeric(14, 4),
	"resolved_amount" numeric(16, 2),
	CONSTRAINT "cost_lines_deal_id_line_key_pk" PRIMARY KEY("deal_id","line_key")
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"lat" double precision,
	"lng" double precision,
	"geohash7" text,
	"acreage" numeric(12, 4),
	"jurisdiction" text,
	"submarket" text,
	"product_type" "product_type" DEFAULT 'auto' NOT NULL,
	"asking_price" numeric(16, 2),
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "deal_status" DEFAULT 'draft' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demographics" (
	"deal_id" uuid PRIMARY KEY NOT NULL,
	"mu_score" double precision,
	"mf_score" double precision,
	"population_3mi" integer,
	"radius_mi" numeric(5, 2),
	"metrics" jsonb,
	"pulled_at" timestamp with time zone,
	"dashboard_version" text,
	"source" "demographics_source" DEFAULT 'api' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"deal_id" uuid PRIMARY KEY NOT NULL,
	"resi_units" integer,
	"unit_mix" jsonb,
	"resi_nrsf" integer,
	"resi_gsf" integer,
	"retail_sf" integer,
	"office_sf" integer,
	"parking_spaces" integer,
	"parking_type" text,
	"hotel_keys" integer,
	"th_lots" integer,
	"outparcels" integer,
	"stories" integer,
	"construction_type" text
);
--> statement-breakpoint
CREATE TABLE "revenue" (
	"deal_id" uuid PRIMARY KEY NOT NULL,
	"resi_rent_psf_mo" numeric(10, 4),
	"retail_rent_psf" numeric(10, 4),
	"office_rent_psf" numeric(10, 4),
	"vacancy" jsonb,
	"opex_per_unit" numeric(12, 2),
	"nonrecov_psf" numeric(10, 4),
	"rent_source" text
);
--> statement-breakpoint
CREATE TABLE "screen_answers" (
	"deal_id" uuid NOT NULL,
	"criterion_key" text NOT NULL,
	"answer" "screen_answer",
	"note" text,
	"answered_by" text,
	CONSTRAINT "screen_answers_deal_id_criterion_key_pk" PRIMARY KEY("deal_id","criterion_key")
);
--> statement-breakpoint
CREATE TABLE "screen_results" (
	"deal_id" uuid PRIMARY KEY NOT NULL,
	"weighted_score" double precision NOT NULL,
	"unknown_share" double precision NOT NULL,
	"ko_pass" "ko_result" NOT NULL,
	"demo_band" "demographic_band",
	"verdict" "verdict" NOT NULL,
	"prob" double precision NOT NULL,
	"prob_weighted" double precision NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comps" ADD CONSTRAINT "comps_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_lines" ADD CONSTRAINT "cost_lines_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demographics" ADD CONSTRAINT "demographics_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue" ADD CONSTRAINT "revenue_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screen_answers" ADD CONSTRAINT "screen_answers_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screen_results" ADD CONSTRAINT "screen_results_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comps_deal_id_idx" ON "comps" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "cost_library_log_line_key_idx" ON "cost_library_log" USING btree ("line_key");--> statement-breakpoint
CREATE INDEX "deals_geohash7_idx" ON "deals" USING btree ("geohash7");--> statement-breakpoint
CREATE INDEX "deals_created_by_idx" ON "deals" USING btree ("created_by");