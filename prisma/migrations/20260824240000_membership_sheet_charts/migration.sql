-- Gráficos pessoais do usuário por empresa (JSONB leve, sem tabela extra).
ALTER TABLE "memberships"
  ADD COLUMN IF NOT EXISTS "sheet_charts" JSONB NOT NULL DEFAULT '{}';
