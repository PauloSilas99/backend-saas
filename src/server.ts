import { app } from './app';
import { env } from '@config/env';
import { logger } from '@shared/logger';
import { startImportsWorker } from '@modules/imports/imports.worker';
import { closeImportsQueue } from '@modules/imports/imports.queue';
import { stopImportsWorker } from '@modules/imports/imports.worker';

const server = app.listen(env.PORT, () => {
  logger.info(`Server running on http://localhost:${env.PORT}${env.API_PREFIX}`);
  logger.info(`Swagger docs at http://localhost:${env.PORT}/docs`);

  if (env.NODE_ENV !== 'test') {
    startImportsWorker();
  }
});

async function shutdown() {
  await stopImportsWorker();
  await closeImportsQueue();
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
