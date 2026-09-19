import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/** Generate/migrate no CI não conecta; só precisa de uma URL com formato válido. */
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://build:build@127.0.0.1:5432/build?schema=public';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: DATABASE_URL,
  },
});
