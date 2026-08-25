import { app } from './app';
import { env } from '@config/env';
import { prisma } from '@config/database';
import { logger } from '@shared/logger';
import { startSheetJobsWorker, stopSheetJobsWorker } from '@modules/action-plan-sheets/sheet-jobs.worker';
import { closeSheetJobsQueue } from '@modules/action-plan-sheets/sheet-import.jobs';
import { purgeStaleData } from '@shared/retention/purge-stale-data';

const server = app.listen(env.PORT, () => {
  logger.info(`Server running on http://localhost:${env.PORT}${env.API_PREFIX}`);
  logger.info(`Swagger docs at http://localhost:${env.PORT}/docs`);

  if (env.NODE_ENV !== 'test') {
    startSheetJobsWorker();
    void purgeStaleData(prisma).catch((err) => {
      logger.warn({ err }, 'retention.purge.startup_failed');
    });
  }
});

server.timeout = 10 * 60 * 1000;
server.headersTimeout = 10 * 60 * 1000;
server.requestTimeout = 10 * 60 * 1000;
server.keepAliveTimeout = 70 * 1000;

async function shutdown() {
  await stopSheetJobsWorker();
  await closeSheetJobsQueue();
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
