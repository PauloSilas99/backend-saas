import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3333),
  API_PREFIX: z.string().default('/api/v1'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  ADMIN_EMAIL: z.string().email().default('admin@saas.local'),
  ADMIN_PASSWORD: z.string().default('Admin@123456'),
  ADMIN_NAME: z.string().default('Platform Admin'),
  GESTOR_EMAIL: z.string().email().default('gestor@saas.local'),
  GESTOR_PASSWORD: z.string().default('Gestor@123456'),
  OPERACIONAL_EMAIL: z.string().email().default('operacional@saas.local'),
  OPERACIONAL_PASSWORD: z.string().default('Operacional@123456'),
  CORS_ORIGIN: z.string().default('*'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  BILLING_PROVIDER: z.enum(['mock', 'stripe', 'asaas']).default('mock'),
  STRIPE_SECRET_KEY: z.string().optional().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(''),
  ASAAS_API_KEY: z.string().optional().default(''),
  ASAAS_WEBHOOK_TOKEN: z.string().optional().default(''),
  UPLOAD_MAX_SIZE_MB: z.coerce.number().default(50),
  UPLOAD_DIR: z.string().default('uploads'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
