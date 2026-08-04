-- CreateTable
CREATE TABLE IF NOT EXISTS "calendar_action_overlays" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "action_row_id" TEXT NOT NULL,
    "display_starts_at" TIMESTAMP(3),
    "display_ends_at" TIMESTAMP(3),
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "color" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "calendar_action_overlays_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "calendar_action_overlays_user_id_action_row_id_key"
  ON "calendar_action_overlays"("user_id", "action_row_id");

CREATE INDEX IF NOT EXISTS "calendar_action_overlays_tenant_id_user_id_idx"
  ON "calendar_action_overlays"("tenant_id", "user_id");

CREATE INDEX IF NOT EXISTS "calendar_action_overlays_action_row_id_idx"
  ON "calendar_action_overlays"("action_row_id");

DO $$ BEGIN
  ALTER TABLE "calendar_action_overlays"
    ADD CONSTRAINT "calendar_action_overlays_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "calendar_action_overlays"
    ADD CONSTRAINT "calendar_action_overlays_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "calendar_action_overlays"
    ADD CONSTRAINT "calendar_action_overlays_action_row_id_fkey"
    FOREIGN KEY ("action_row_id") REFERENCES "action_plan_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
