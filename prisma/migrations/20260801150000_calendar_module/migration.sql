-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "CalendarActivityStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE', 'CANCELED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "CalendarOverrideType" AS ENUM ('BLOCKED', 'NOTE', 'HOLIDAY', 'CUSTOM');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "calendar_activities" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "assignee_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "all_day" BOOLEAN NOT NULL DEFAULT false,
    "status" "CalendarActivityStatus" NOT NULL DEFAULT 'PENDING',
    "location" TEXT,
    "color" TEXT,
    "metadata" JSONB,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "calendar_activities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "calendar_overrides" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "type" "CalendarOverrideType" NOT NULL DEFAULT 'NOTE',
    "title" TEXT,
    "note" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "calendar_overrides_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "calendar_activities_tenant_id_starts_at_idx" ON "calendar_activities"("tenant_id", "starts_at");
CREATE INDEX IF NOT EXISTS "calendar_activities_tenant_id_status_idx" ON "calendar_activities"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "calendar_activities_assignee_id_starts_at_idx" ON "calendar_activities"("assignee_id", "starts_at");
CREATE INDEX IF NOT EXISTS "calendar_overrides_tenant_id_date_idx" ON "calendar_overrides"("tenant_id", "date");

CREATE UNIQUE INDEX IF NOT EXISTS "calendar_overrides_tenant_id_date_key" ON "calendar_overrides"("tenant_id", "date");

DO $$ BEGIN
  ALTER TABLE "calendar_activities" ADD CONSTRAINT "calendar_activities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "calendar_activities" ADD CONSTRAINT "calendar_activities_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "calendar_activities" ADD CONSTRAINT "calendar_activities_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "calendar_overrides" ADD CONSTRAINT "calendar_overrides_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "calendar_overrides" ADD CONSTRAINT "calendar_overrides_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
