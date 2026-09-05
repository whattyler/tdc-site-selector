ALTER TABLE "deals" ADD COLUMN "incentives" numeric(16, 2);--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "incentives_note" text;--> statement-breakpoint
ALTER TABLE "first_look_results" ADD COLUMN "fl_incentives" numeric(16, 2);--> statement-breakpoint
ALTER TABLE "first_look_results" ADD COLUMN "net_cost_ex_land" numeric(16, 2);