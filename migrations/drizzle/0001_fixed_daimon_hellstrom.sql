CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"country" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"country" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fp_clearances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"party_name" text NOT NULL,
	"reason" text NOT NULL,
	"cleared_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_kind_ck" CHECK (kind IN ('EXPORTER', 'FORWARDER', 'BROKER'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_role_ck" CHECK (role IN ('INITIATOR', 'REVIEWER', 'APPROVER', 'ADMIN', 'AUDITOR'))
);
--> statement-breakpoint
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_event_type_ck";--> statement-breakpoint
ALTER TABLE "screening_runs" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "screening_runs" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "screening_runs" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "screening_runs" ADD COLUMN "initiated_by" uuid;--> statement-breakpoint
ALTER TABLE "screening_runs" ADD COLUMN "trigger" text DEFAULT 'MANUAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "screening_runs" ADD COLUMN "status" text DEFAULT 'CLEARED' NOT NULL;--> statement-breakpoint
ALTER TABLE "screening_runs" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "screening_runs" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fp_clearances" ADD CONSTRAINT "fp_clearances_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fp_clearances" ADD CONSTRAINT "fp_clearances_cleared_by_users_id_fk" FOREIGN KEY ("cleared_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_clients_org" ON "clients" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_customers_client" ON "customers" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_fp_customer" ON "fp_clearances" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_users_org" ON "users" USING btree ("org_id");--> statement-breakpoint
ALTER TABLE "screening_runs" ADD CONSTRAINT "screening_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_runs" ADD CONSTRAINT "screening_runs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_runs" ADD CONSTRAINT "screening_runs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_runs" ADD CONSTRAINT "screening_runs_initiated_by_users_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_runs" ADD CONSTRAINT "screening_runs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_runs_client" ON "screening_runs" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_runs_customer" ON "screening_runs" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_runs_status" ON "screening_runs" USING btree ("status");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_event_type_ck" CHECK (event_type IN ('RUN_CREATED', 'CLASSIFY', 'SCREEN', 'RESOLVE', 'VERDICT', 'RESCREEN', 'APPROVE', 'REJECT', 'CLEAR_FALSE_POSITIVE'));--> statement-breakpoint
ALTER TABLE "screening_runs" ADD CONSTRAINT "screening_runs_trigger_ck" CHECK (trigger IN ('MANUAL', 'BATCH', 'RESCREEN'));--> statement-breakpoint
ALTER TABLE "screening_runs" ADD CONSTRAINT "screening_runs_status_ck" CHECK (status IN ('CLEARED', 'PENDING_REVIEW', 'BLOCKED', 'APPROVED', 'REJECTED'));