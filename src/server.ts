import { app } from './app';
import { env } from '@config/env';
import { logger } from '@shared/logger';
import { startImportsWorker, stopImportsWorker } from '@modules/imports/imports.worker';
import { closeImportsQueue } from '@modules/imports/imports.queue';
import { startSheetJobsWorker, stopSheetJobsWorker } from '@modules/action-plan-sheets/sheet-jobs.worker';
import { closeSheetJobsQueue } from '@modules/action-plan-sheets/sheet-import.jobs';

const server = app.listen(env.PORT, () => {
  logger.info(`Server running on http://localhost:${env.PORT}${env.API_PREFIX}`);
  logger.info(`Swagger docs at http://localhost:${env.PORT}/docs`);

  if (env.NODE_ENV !== 'test') {
    startImportsWorker();
    startSheetJobsWorker();
  }
});

server.timeout = 10 * 60 * 1000;
server.headersTimeout = 10 * 60 * 1000;
server.requestTimeout = 10 * 60 * 1000;
server.keepAliveTimeout = 70 * 1000;

async function shutdown() {
  await stopSheetJobsWorker();
  await closeSheetJobsQueue();
  await stopImportsWorker();
  await closeImportsQueue();
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
