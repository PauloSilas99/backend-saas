ALTER TABLE "action_evidences" ADD COLUMN "resource_type" TEXT;

UPDATE "action_evidences"
SET "resource_type" = CASE
  WHEN "mime_type" LIKE 'image/%' THEN 'image'
  WHEN "mime_type" LIKE 'video/%' THEN 'video'
  ELSE 'raw'
END
WHERE "public_id" IS NOT NULL;
