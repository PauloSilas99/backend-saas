-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified_at" TIMESTAMP(3);

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "AuthTokenType" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "auth_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "AuthTokenType" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "auth_tokens_token_hash_idx" ON "auth_tokens"("token_hash");
CREATE INDEX IF NOT EXISTS "auth_tokens_user_id_type_idx" ON "auth_tokens"("user_id", "type");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Seeded / existing users: treat as already verified
UPDATE "users" SET "email_verified_at" = COALESCE("email_verified_at", "created_at")
WHERE "email_verified_at" IS NULL;
