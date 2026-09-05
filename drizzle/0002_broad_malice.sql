CREATE TYPE "public"."combined_verdict" AS ENUM('DOUBLE GO', 'GO — LAND FAIL', 'WATCH', 'INCOMPLETE', 'NO-GO', 'NOT SCORED');--> statement-breakpoint
CREATE TABLE "demographics_cache" (
	"geohash7" text NOT NULL,
	"radius_mi" numeric(5, 2) NOT NULL,
	"version" text NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demographics_cache_geohash7_radius_mi_version_pk" PRIMARY KEY("geohash7","radius_mi","version")
);
--> statement-breakpoint
CREATE TABLE "first_look_results" (
	"deal_id" uuid PRIMARY KEY NOT NULL,
	"total_noi" numeric(16, 2),
	"total_cost_ex_land" numeric(16, 2),
	"max_land_price" numeric(16, 2),
	"headroom_pct_of_ask" double precision,
	"yoc_on_cost" double precision,
	"blended_yoc" double precision,
	"retail_share_of_noi" double precision,
	"land_test" "ko_result",
	"combined_verdict" "combined_verdict" NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Hand-edited: Postgres will not cast text to jsonb without being told how.
-- The column is empty, so the cast is a formality; the USING clause keeps it
-- correct if a valid-JSON string ever sat there.
ALTER TABLE "revenue" ALTER COLUMN "rent_source" SET DATA TYPE jsonb USING "rent_source"::jsonb;--> statement-breakpoint
ALTER TABLE "comps" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "comps" ADD COLUMN "rating" double precision;--> statement-breakpoint
ALTER TABLE "comps" ADD COLUMN "rating_count" integer;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "cost_global_multiplier" numeric(6, 4) DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "avg_nsf" integer;--> statement-breakpoint
ALTER TABLE "first_look_results" ADD CONSTRAINT "first_look_results_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue" DROP COLUMN "nonrecov_psf";