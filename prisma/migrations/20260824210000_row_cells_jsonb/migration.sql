-- Valores da planilha passam a viver na linha (1 JSONB) em vez de 1 row por célula.
ALTER TABLE "action_plan_rows"
  ADD COLUMN IF NOT EXISTS "cells" JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF to_regclass('public.action_field_values') IS NOT NULL THEN
    UPDATE "action_plan_rows" AS r
    SET "cells" = COALESCE(agg.cells, '{}'::jsonb)
    FROM (
      SELECT
        fv.action_row_id,
        jsonb_object_agg(fv.column_id::text, fv.value) FILTER (
          WHERE fv.value IS NOT NULL
            AND jsonb_typeof(fv.value) <> 'null'
            AND NOT (
              jsonb_typeof(fv.value) = 'string'
              AND (fv.value #>> '{}') = ''
            )
        ) AS cells
      FROM action_field_values fv
      GROUP BY fv.action_row_id
    ) AS agg
    WHERE r.id = agg.action_row_id;

    DROP TABLE "action_field_values";
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "action_plan_rows_cells_gin_idx"
  ON "action_plan_rows" USING GIN ("cells");
