import { app } from './app';
import { env } from '@config/env';
import { logger } from '@shared/logger';

const server = app.listen(env.PORT, () => {
  logger.info(`Server running on http://localhost:${env.PORT}${env.API_PREFIX}`);
  logger.info(`Swagger docs at http://localhost:${env.PORT}/docs`);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
