CREATE TABLE "party_ownership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_name" text NOT NULL,
	"owner_name" text NOT NULL,
	"owner_pct" numeric NOT NULL,
	"snapshot_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_hits" DROP CONSTRAINT "control_hits_source_type_ck";--> statement-breakpoint
ALTER TABLE "control_hits" DROP CONSTRAINT "control_hits_dimension_ck";--> statement-breakpoint
ALTER TABLE "control_hits" DROP CONSTRAINT "control_hits_rule_type_ck";--> statement-breakpoint
ALTER TABLE "ref_snapshots" DROP CONSTRAINT "ref_snapshots_source_type_ck";--> statement-breakpoint
ALTER TABLE "party_ownership" ADD CONSTRAINT "party_ownership_snapshot_id_ref_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."ref_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ownership_subject" ON "party_ownership" USING btree ("subject_name");--> statement-breakpoint
ALTER TABLE "control_hits" ADD CONSTRAINT "control_hits_source_type_ck" CHECK (source_type IN ('RESTRICTED_PARTY', 'DESTINATION_RULE', 'CLASSIFICATION', 'OWNERSHIP'));--> statement-breakpoint
ALTER TABLE "control_hits" ADD CONSTRAINT "control_hits_dimension_ck" CHECK (dimension IN ('ENTITY', 'HS_COUNTRY', 'CONFIDENCE', 'OWNERSHIP'));--> statement-breakpoint
ALTER TABLE "control_hits" ADD CONSTRAINT "control_hits_rule_type_ck" CHECK (rule_type IN ('PROHIBITED', 'FUZZY_MATCH', 'LICENSE_REQUIRED', 'LOW_CONFIDENCE', 'OWNERSHIP_RISK'));--> statement-breakpoint
ALTER TABLE "ref_snapshots" ADD CONSTRAINT "ref_snapshots_source_type_ck" CHECK (source_type IN ('RESTRICTED_PARTY', 'HS', 'DESTINATION_RULE', 'OWNERSHIP'));