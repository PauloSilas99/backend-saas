CREATE TYPE "EvidenceKind" AS ENUM ('LINK', 'TEXTO', 'ARQUIVO');

CREATE TABLE "action_evidences" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "action_row_id" TEXT NOT NULL,
  "kind" "EvidenceKind" NOT NULL,
  "value" TEXT,
  "public_id" TEXT,
  "file_name" TEXT,
  "mime_type" TEXT,
  "size_bytes" INTEGER,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "action_evidences_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "action_evidences_action_row_id_idx" ON "action_evidences"("action_row_id");
CREATE INDEX "action_evidences_tenant_id_idx" ON "action_evidences"("tenant_id");

ALTER TABLE "action_evidences"
  ADD CONSTRAINT "action_evidences_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "action_evidences"
  ADD CONSTRAINT "action_evidences_action_row_id_fkey"
  FOREIGN KEY ("action_row_id") REFERENCES "action_plan_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "action_evidences"
  ADD CONSTRAINT "action_evidences_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "action_evidences" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON action_evidences;
CREATE POLICY tenant_isolation ON action_evidences
  USING (
    app_current_tenant_id() IS NULL
    OR tenant_id::text = app_current_tenant_id()
  );
