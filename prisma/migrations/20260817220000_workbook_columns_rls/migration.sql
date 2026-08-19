-- AlterEnum
CREATE TYPE "ColumnSemanticRole" AS ENUM ('NONE', 'DUE_DATE', 'ASSIGNEE', 'TITLE', 'STATUS', 'PRIORITY');

-- AlterTable: colunas passam a pertencer ao plano (workbook)
ALTER TABLE "action_columns" ADD COLUMN "action_plan_id" TEXT;
ALTER TABLE "action_columns" ADD COLUMN "semantic_role" "ColumnSemanticRole" NOT NULL DEFAULT 'NONE';

UPDATE "action_columns" AS c
SET "action_plan_id" = (
  SELECT p.id
  FROM "action_plans" p
  WHERE p.tenant_id = c.tenant_id
  ORDER BY p.created_at ASC
  LIMIT 1
);

DELETE FROM "action_columns" WHERE "action_plan_id" IS NULL;

ALTER TABLE "action_columns" ALTER COLUMN "action_plan_id" SET NOT NULL;

DROP INDEX IF EXISTS "action_columns_tenant_id_name_key";
CREATE UNIQUE INDEX "action_columns_action_plan_id_name_key" ON "action_columns"("action_plan_id", "name");
CREATE INDEX "action_columns_action_plan_id_is_active_deleted_at_idx" ON "action_columns"("action_plan_id", "is_active", "deleted_at");

ALTER TABLE "action_columns"
  ADD CONSTRAINT "action_columns_action_plan_id_fkey"
  FOREIGN KEY ("action_plan_id") REFERENCES "action_plans"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Refresh tokens lembram o tenant da sessão (switch-tenant)
ALTER TABLE "refresh_tokens" ADD COLUMN "tenant_id" TEXT;

-- RLS (defesa em profundidade). Sem FORCE: o role dono das tabelas continua
-- enxergando tudo; o Prisma extension injeta tenantId nas queries da API.
-- Quando app.tenant_id está setado (transação de import), as policies filtram.
CREATE OR REPLACE FUNCTION app_current_tenant_id() RETURNS text AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '');
$$ LANGUAGE sql STABLE;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenants',
    'memberships',
    'units',
    'action_plans',
    'action_columns',
    'imports',
    'risks',
    'calendar_activities',
    'calendar_overrides',
    'calendar_action_overlays',
    'subscriptions',
    'payments',
    'audit_logs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
  END LOOP;
END $$;

CREATE POLICY tenant_isolation ON tenants
  USING (id::text = app_current_tenant_id() OR app_current_tenant_id() IS NULL);

CREATE POLICY tenant_isolation ON memberships
  USING (tenant_id::text = app_current_tenant_id() OR app_current_tenant_id() IS NULL);

CREATE POLICY tenant_isolation ON units
  USING (tenant_id::text = app_current_tenant_id() OR app_current_tenant_id() IS NULL);

CREATE POLICY tenant_isolation ON action_plans
  USING (tenant_id::text = app_current_tenant_id() OR app_current_tenant_id() IS NULL);

CREATE POLICY tenant_isolation ON action_columns
  USING (tenant_id::text = app_current_tenant_id() OR app_current_tenant_id() IS NULL);

CREATE POLICY tenant_isolation ON imports
  USING (tenant_id::text = app_current_tenant_id() OR app_current_tenant_id() IS NULL);

CREATE POLICY tenant_isolation ON risks
  USING (tenant_id::text = app_current_tenant_id() OR app_current_tenant_id() IS NULL);

CREATE POLICY tenant_isolation ON calendar_activities
  USING (tenant_id::text = app_current_tenant_id() OR app_current_tenant_id() IS NULL);

CREATE POLICY tenant_isolation ON calendar_overrides
  USING (tenant_id::text = app_current_tenant_id() OR app_current_tenant_id() IS NULL);

CREATE POLICY tenant_isolation ON calendar_action_overlays
  USING (tenant_id::text = app_current_tenant_id() OR app_current_tenant_id() IS NULL);

CREATE POLICY tenant_isolation ON subscriptions
  USING (tenant_id::text = app_current_tenant_id() OR app_current_tenant_id() IS NULL);

CREATE POLICY tenant_isolation ON payments
  USING (tenant_id::text = app_current_tenant_id() OR app_current_tenant_id() IS NULL);

CREATE POLICY tenant_isolation ON audit_logs
  USING (tenant_id IS NULL OR tenant_id::text = app_current_tenant_id() OR app_current_tenant_id() IS NULL);

-- Linhas e valores não têm tenant_id próprio: isolam via o plano.
ALTER TABLE action_plan_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_field_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_histories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON action_plan_rows;
DROP POLICY IF EXISTS tenant_isolation ON action_field_values;
DROP POLICY IF EXISTS tenant_isolation ON action_histories;

CREATE POLICY tenant_isolation ON action_plan_rows
  USING (
    app_current_tenant_id() IS NULL
    OR EXISTS (
      SELECT 1 FROM action_plans p
      WHERE p.id = action_plan_id
        AND p.tenant_id::text = app_current_tenant_id()
    )
  );

CREATE POLICY tenant_isolation ON action_field_values
  USING (
    app_current_tenant_id() IS NULL
    OR EXISTS (
      SELECT 1
      FROM action_plan_rows r
      JOIN action_plans p ON p.id = r.action_plan_id
      WHERE r.id = action_row_id
        AND p.tenant_id::text = app_current_tenant_id()
    )
  );

CREATE POLICY tenant_isolation ON action_histories
  USING (
    app_current_tenant_id() IS NULL
    OR EXISTS (
      SELECT 1
      FROM action_plan_rows r
      JOIN action_plans p ON p.id = r.action_plan_id
      WHERE r.id = action_row_id
        AND p.tenant_id::text = app_current_tenant_id()
    )
  );
