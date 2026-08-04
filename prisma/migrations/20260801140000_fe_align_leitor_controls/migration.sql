-- AlterEnum
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'LEITOR';

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ControlStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE', 'CANCELED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "action_controls" (
    "id" TEXT NOT NULL,
    "risk_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "ControlStatus" NOT NULL DEFAULT 'PENDING',
    "responsible_id" TEXT,
    "due_date" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "evidence" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_controls_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "action_controls_risk_id_status_idx" ON "action_controls"("risk_id", "status");

DO $$ BEGIN
  ALTER TABLE "action_controls" ADD CONSTRAINT "action_controls_risk_id_fkey" FOREIGN KEY ("risk_id") REFERENCES "risks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "action_controls" ADD CONSTRAINT "action_controls_responsible_id_fkey" FOREIGN KEY ("responsible_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
