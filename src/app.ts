import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import pinoHttp from 'pino-http';
import { env } from '@config/env';
import { swaggerSpec } from '@config/app';
import { registerDependencies } from '@shared/container';
import { errorHandler } from '@middlewares/errorHandler';
import { apiRateLimiter } from '@middlewares/rateLimit';
import { logger } from '@shared/logger';
import routes from './routes';

registerDependencies();

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','),
    credentials: true,
  }),
);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(
  pinoHttp({
    logger,
    autoLogging: env.NODE_ENV !== 'test',
  }),
);
app.use(apiRateLimiter);

app.use('/uploads', express.static(path.resolve(process.cwd(), env.UPLOAD_DIR)));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/docs.json', (_req, res) => res.json(swaggerSpec));

app.use(env.API_PREFIX, routes);

app.use(errorHandler);

export { app };
