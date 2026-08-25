import { Worker, Job } from 'bullmq';
import { Role } from '@prisma/client';
import { container } from 'tsyringe';
import { getRedisConnection } from '@config/redis';
import { logger } from '@shared/logger';
import { runWithTenant } from '@shared/tenancy/tenant-context';
import { toJobFailure } from '@shared/errors/job-error';
import { SheetsService } from './sheets.service';
import {
  SHEET_JOB_TYPES,
  SHEET_QUEUE_NAME,
  type SheetImportJobData,
  type SheetParseJobData,
} from './sheet-import.jobs';

let worker: Worker | null = null;

async function handleParse(job: Job<SheetParseJobData>) {
  const service = container.resolve(SheetsService);
  await job.updateProgress({ current: 0, total: 0, phase: 'parse' });
  return service.executeParseJob(
    job.data.actor,
    { path: job.data.filePath, originalname: job.data.originalName },
    (progress) => job.updateProgress(progress),
  );
}

async function handleImport(job: Job<SheetImportJobData>) {
  const service = container.resolve(SheetsService);
  await job.updateProgress({ current: 0, total: 0, phase: 'import' });
  return service.executeImportJob(job.data.actor, job.data.input, (progress) =>
    job.updateProgress(progress),
  );
}

export function startSheetJobsWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(
    SHEET_QUEUE_NAME,
    async (job) => {
      const data = job.data as SheetParseJobData | SheetImportJobData;
      return runWithTenant(
        {
          tenantId: data.tenantId,
          bypass: data.actor.role === Role.PLATFORM_ADMIN,
        },
        async () => {
          try {
            switch (job.name) {
              case SHEET_JOB_TYPES.PARSE:
                return await handleParse(job as Job<SheetParseJobData>);
              case SHEET_JOB_TYPES.IMPORT:
                return await handleImport(job as Job<SheetImportJobData>);
              default:
                throw new Error(`Tipo de job desconhecido: ${job.name}`);
            }
          } catch (err) {
            throw toJobFailure(err);
          }
        },
      );
    },
    { connection: getRedisConnection(), concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, jobName: job?.name, err }, 'sheet-jobs.worker.failed');
  });

  logger.info('Sheet jobs worker started');
  return worker;
}

export async function stopSheetJobsWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
}
