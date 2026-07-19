-- Recreate Role enum with new labels
ALTER TYPE "Role" RENAME TO "Role_old";
CREATE TYPE "Role" AS ENUM ('PLATFORM_ADMIN', 'GERENTE', 'GESTOR', 'OPERACIONAL');

ALTER TABLE "memberships"
  ALTER COLUMN "role" TYPE "Role"
  USING (
    CASE "role"::text
      WHEN 'ADMIN' THEN 'PLATFORM_ADMIN'
      WHEN 'GESTOR' THEN 'GERENTE'
      WHEN 'OPERACIONAL' THEN 'OPERACIONAL'
      ELSE 'OPERACIONAL'
    END
  )::"Role";

DROP TYPE "Role_old";

-- Recreate ActionStatus enum with approval states
ALTER TYPE "ActionStatus" RENAME TO "ActionStatus_old";
CREATE TYPE "ActionStatus" AS ENUM (
  'PENDING',
  'IN_PROGRESS',
  'WAITING_APPROVAL',
  'COMPLETED',
  'REJECTED',
  'DELAYED',
  'CANCELED'
);

ALTER TABLE "action_plan_rows"
  ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "action_plan_rows"
  ALTER COLUMN "status" TYPE "ActionStatus"
  USING (
    CASE "status"::text
      WHEN 'PENDING' THEN 'PENDING'
      WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'
      WHEN 'COMPLETED' THEN 'COMPLETED'
      WHEN 'DELAYED' THEN 'DELAYED'
      WHEN 'CANCELED' THEN 'CANCELED'
      ELSE 'PENDING'
    END
  )::"ActionStatus";

ALTER TABLE "action_plan_rows"
  ALTER COLUMN "status" SET DEFAULT 'PENDING'::"ActionStatus";

DROP TYPE "ActionStatus_old";

CREATE TYPE "ColumnFieldType" AS ENUM (
  'TEXT', 'LONG_TEXT', 'NUMBER', 'DATE', 'BOOLEAN',
  'SELECT', 'MULTI_SELECT', 'USER', 'UNIT', 'CURRENCY', 'PERCENTAGE'
);
CREATE TYPE "ColumnHistoryAction" AS ENUM ('CREATED', 'UPDATED', 'DELETED', 'RESTORED');
CREATE TYPE "RiskStatus" AS ENUM ('OPEN', 'MITIGATING', 'CLOSED', 'ACCEPTED');
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

ALTER TABLE "action_plan_rows" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "action_plan_rows_deleted_at_idx" ON "action_plan_rows"("deleted_at");
CREATE INDEX IF NOT EXISTS "memberships_tenant_id_role_is_active_idx" ON "memberships"("tenant_id", "role", "is_active");

CREATE TABLE IF NOT EXISTS "action_histories" (
    "id" TEXT NOT NULL,
    "action_row_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "from_status" "ActionStatus",
    "to_status" "ActionStatus",
    "comment" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "action_histories_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "action_histories_action_row_id_created_at_idx"
  ON "action_histories"("action_row_id", "created_at");
ALTER TABLE "action_histories"
  ADD CONSTRAINT "action_histories_action_row_id_fkey"
  FOREIGN KEY ("action_row_id") REFERENCES "action_plan_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "action_histories"
  ADD CONSTRAINT "action_histories_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "action_columns" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "field_type" "ColumnFieldType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by_id" TEXT,
    "delete_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "action_columns_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "action_columns_tenant_id_name_key" ON "action_columns"("tenant_id", "name");
CREATE INDEX IF NOT EXISTS "action_columns_tenant_id_is_active_deleted_at_idx"
  ON "action_columns"("tenant_id", "is_active", "deleted_at");
ALTER TABLE "action_columns"
  ADD CONSTRAINT "action_columns_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "action_columns"
  ADD CONSTRAINT "action_columns_deleted_by_id_fkey"
  FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "action_column_histories" (
    "id" TEXT NOT NULL,
    "column_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" "ColumnHistoryAction" NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "action_column_histories_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "action_column_histories_column_id_created_at_idx"
  ON "action_column_histories"("column_id", "created_at");
ALTER TABLE "action_column_histories"
  ADD CONSTRAINT "action_column_histories_column_id_fkey"
  FOREIGN KEY ("column_id") REFERENCES "action_columns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "action_column_histories"
  ADD CONSTRAINT "action_column_histories_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "action_field_values" (
    "id" TEXT NOT NULL,
    "action_row_id" TEXT NOT NULL,
    "column_id" TEXT NOT NULL,
    "value" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "action_field_values_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "action_field_values_action_row_id_column_id_key"
  ON "action_field_values"("action_row_id", "column_id");
CREATE INDEX IF NOT EXISTS "action_field_values_column_id_idx" ON "action_field_values"("column_id");
ALTER TABLE "action_field_values"
  ADD CONSTRAINT "action_field_values_action_row_id_fkey"
  FOREIGN KEY ("action_row_id") REFERENCES "action_plan_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "action_field_values"
  ADD CONSTRAINT "action_field_values_column_id_fkey"
  FOREIGN KEY ("column_id") REFERENCES "action_columns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "risks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "action_row_id" TEXT,
    "owner_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "probability" "RiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "impact" "RiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "severity" "RiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "status" "RiskStatus" NOT NULL DEFAULT 'OPEN',
    "mitigation_plan" TEXT,
    "due_date" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "risks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "risks_tenant_id_status_idx" ON "risks"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "risks_tenant_id_due_date_idx" ON "risks"("tenant_id", "due_date");
ALTER TABLE "risks"
  ADD CONSTRAINT "risks_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "risks"
  ADD CONSTRAINT "risks_action_row_id_fkey"
  FOREIGN KEY ("action_row_id") REFERENCES "action_plan_rows"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "risks"
  ADD CONSTRAINT "risks_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
