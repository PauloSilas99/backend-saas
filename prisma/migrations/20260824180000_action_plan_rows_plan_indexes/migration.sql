-- Caminho quente: listagem, analytics e calendário filtram por plano.
CREATE INDEX IF NOT EXISTS "action_plan_rows_action_plan_id_deleted_at_created_at_idx"
  ON "action_plan_rows"("action_plan_id", "deleted_at", "created_at");

CREATE INDEX IF NOT EXISTS "action_plan_rows_action_plan_id_due_date_idx"
  ON "action_plan_rows"("action_plan_id", "due_date");
