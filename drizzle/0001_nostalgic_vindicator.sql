CREATE TYPE "public"."cost_applies_to" AS ENUM('resi_hard', 'commercial_hard', 'hard', 'soft', 'total');--> statement-breakpoint
CREATE TYPE "public"."cost_category" AS ENUM('hard', 'soft', 'other');--> statement-breakpoint
ALTER TYPE "public"."cost_basis" ADD VALUE 'per_acre' BEFORE 'pct_hard';--> statement-breakpoint
ALTER TYPE "public"."cost_basis" ADD VALUE 'pct_soft' BEFORE 'pct_total';--> statement-breakpoint
ALTER TABLE "cost_library" ADD COLUMN "category" "cost_category" NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_library" ADD COLUMN "applies_to" "cost_applies_to";--> statement-breakpoint
ALTER TABLE "cost_library" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;