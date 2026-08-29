ALTER TABLE "action_plan_rows" ADD COLUMN "tenant_id" TEXT;

UPDATE "action_plan_rows" AS r
SET "tenant_id" = p."tenant_id"
FROM "action_plans" AS p
WHERE p."id" = r."action_plan_id";

DELETE FROM "action_plan_rows" WHERE "tenant_id" IS NULL;

ALTER TABLE "action_plan_rows" ALTER COLUMN "tenant_id" SET NOT NULL;

ALTER TABLE "action_plan_rows"
  ADD CONSTRAINT "action_plan_rows_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "action_plan_rows_tenant_id_idx" ON "action_plan_rows"("tenant_id");
CREATE INDEX "action_plan_rows_tenant_id_action_plan_id_idx"
  ON "action_plan_rows"("tenant_id", "action_plan_id");

DROP POLICY IF EXISTS tenant_isolation ON action_plan_rows;
CREATE POLICY tenant_isolation ON action_plan_rows
  USING (
    app_current_tenant_id() IS NULL
    OR tenant_id::text = app_current_tenant_id()
  );
