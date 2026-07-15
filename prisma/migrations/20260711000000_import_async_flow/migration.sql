-- AlterEnum
ALTER TYPE "ImportStatus" ADD VALUE IF NOT EXISTS 'READY_FOR_MAPPING';
ALTER TYPE "ImportStatus" ADD VALUE IF NOT EXISTS 'READY_FOR_PREVIEW';
ALTER TYPE "ImportStatus" ADD VALUE IF NOT EXISTS 'PROCESSING_COMMIT';

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('OK', 'WARNING', 'ERROR');

-- AlterTable
ALTER TABLE "imports" ADD COLUMN IF NOT EXISTS "file_path" TEXT NOT NULL DEFAULT '';
ALTER TABLE "imports" ADD COLUMN IF NOT EXISTS "warning_rows" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "imports" ADD COLUMN IF NOT EXISTS "headers" JSONB;
ALTER TABLE "imports" ADD COLUMN IF NOT EXISTS "column_mapping" JSONB;
ALTER TABLE "imports" ADD COLUMN IF NOT EXISTS "status_message" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "imports_tenant_id_created_at_idx" ON "imports"("tenant_id", "created_at");

-- CreateTable
CREATE TABLE IF NOT EXISTS "import_rows" (
    "id" TEXT NOT NULL,
    "import_id" TEXT NOT NULL,
    "line_number" INTEGER NOT NULL,
    "raw_data" JSONB NOT NULL,
    "mapped_data" JSONB,
    "status" "ImportRowStatus" NOT NULL DEFAULT 'OK',
    "messages" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "import_rows_import_id_line_number_key" ON "import_rows"("import_id", "line_number");
CREATE INDEX IF NOT EXISTS "import_rows_import_id_status_idx" ON "import_rows"("import_id", "status");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'import_rows_import_id_fkey'
  ) THEN
    ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_import_id_fkey"
      FOREIGN KEY ("import_id") REFERENCES "imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
