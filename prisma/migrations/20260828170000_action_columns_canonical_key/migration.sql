ALTER TABLE "action_columns" ADD COLUMN "canonical_key" TEXT;

CREATE UNIQUE INDEX "action_columns_action_plan_id_canonical_key_key"
  ON "action_columns"("action_plan_id", "canonical_key");

CREATE INDEX "action_columns_action_plan_id_canonical_key_idx"
  ON "action_columns"("action_plan_id", "canonical_key");
