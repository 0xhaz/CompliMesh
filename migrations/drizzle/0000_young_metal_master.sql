CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"seq" bigserial NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"prev_hash" char(64) NOT NULL,
	"row_hash" char(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_event_type_ck" CHECK (event_type IN ('RUN_CREATED', 'CLASSIFY', 'SCREEN', 'RESOLVE', 'VERDICT'))
);
--> statement-breakpoint
CREATE TABLE "control_hits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_ref_id" uuid,
	"dimension" text NOT NULL,
	"rule_type" text NOT NULL,
	"match_score" numeric,
	"reason" text NOT NULL,
	"snapshot_id" uuid,
	CONSTRAINT "control_hits_source_type_ck" CHECK (source_type IN ('RESTRICTED_PARTY', 'DESTINATION_RULE', 'CLASSIFICATION')),
	CONSTRAINT "control_hits_dimension_ck" CHECK (dimension IN ('ENTITY', 'HS_COUNTRY', 'CONFIDENCE')),
	CONSTRAINT "control_hits_rule_type_ck" CHECK (rule_type IN ('PROHIBITED', 'FUZZY_MATCH', 'LICENSE_REQUIRED', 'LOW_CONFIDENCE'))
);
--> statement-breakpoint
CREATE TABLE "destination_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hs_code_prefix" text,
	"country" text NOT NULL,
	"rule_type" text NOT NULL,
	"notes" text,
	"snapshot_id" uuid NOT NULL,
	CONSTRAINT "destination_rules_rule_type_ck" CHECK (rule_type IN ('PROHIBITED', 'LICENSE_REQUIRED', 'ALLOWED'))
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"country" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hs_reference" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hs_code" text NOT NULL,
	"description" text NOT NULL,
	"control_flags" jsonb,
	"snapshot_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"description" text NOT NULL,
	"hs_code" text,
	"hs_confidence" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ref_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ref_snapshots_source_type_ck" CHECK (source_type IN ('RESTRICTED_PARTY', 'HS', 'DESTINATION_RULE'))
);
--> statement-breakpoint
CREATE TABLE "restricted_parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_source" text NOT NULL,
	"name" text NOT NULL,
	"aliases" jsonb,
	"country" text,
	"snapshot_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "screening_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid,
	"entity_id" uuid,
	"destination" text NOT NULL,
	"rp_snapshot_id" uuid NOT NULL,
	"hs_snapshot_id" uuid NOT NULL,
	"dr_snapshot_id" uuid NOT NULL,
	"verdict" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "screening_runs_verdict_ck" CHECK (verdict IN ('GO', 'REVIEW', 'NO_GO'))
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_run_id_screening_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."screening_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_hits" ADD CONSTRAINT "control_hits_run_id_screening_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."screening_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_hits" ADD CONSTRAINT "control_hits_snapshot_id_ref_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."ref_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "destination_rules" ADD CONSTRAINT "destination_rules_snapshot_id_ref_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."ref_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hs_reference" ADD CONSTRAINT "hs_reference_snapshot_id_ref_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."ref_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restricted_parties" ADD CONSTRAINT "restricted_parties_snapshot_id_ref_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."ref_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_runs" ADD CONSTRAINT "screening_runs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_runs" ADD CONSTRAINT "screening_runs_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_runs" ADD CONSTRAINT "screening_runs_rp_snapshot_id_ref_snapshots_id_fk" FOREIGN KEY ("rp_snapshot_id") REFERENCES "public"."ref_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_runs" ADD CONSTRAINT "screening_runs_hs_snapshot_id_ref_snapshots_id_fk" FOREIGN KEY ("hs_snapshot_id") REFERENCES "public"."ref_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_runs" ADD CONSTRAINT "screening_runs_dr_snapshot_id_ref_snapshots_id_fk" FOREIGN KEY ("dr_snapshot_id") REFERENCES "public"."ref_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_log_seq" ON "audit_log" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "idx_control_hits_run" ON "control_hits" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_destination_rules_lookup" ON "destination_rules" USING btree ("country","hs_code_prefix");