CREATE TYPE "public"."pad_parcel" AS ENUM('hotel', 'townhome', 'outparcel');--> statement-breakpoint
CREATE TYPE "public"."pad_source" AS ENUM('convention', 'custom');--> statement-breakpoint
CREATE TABLE "pad_lines" (
	"deal_id" uuid NOT NULL,
	"parcel" "pad_parcel" NOT NULL,
	"source" "pad_source" DEFAULT 'convention' NOT NULL,
	"custom_rate" numeric(14, 4),
	"note" text,
	CONSTRAINT "pad_lines_deal_id_parcel_pk" PRIMARY KEY("deal_id","parcel")
);
--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "cost_pricing_date" date;--> statement-breakpoint
ALTER TABLE "pad_lines" ADD CONSTRAINT "pad_lines_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;