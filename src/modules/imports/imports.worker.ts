import { Worker, Job } from 'bullmq';
import { ImportRowStatus, ImportStatus, Prisma } from '@prisma/client';
import { prisma } from '@config/database';
import { env } from '@config/env';
import { logger } from '@shared/logger';
import { AuditService } from '@shared/audit/audit.service';
import { commitImportRows } from './imports.committer';
import { IMPORT_JOB_TYPES, IMPORT_QUEUE_NAME } from './imports.constants';
import { parseSpreadsheetFile } from './imports.parser';
import { ColumnMapping } from './imports.mapping';
import { validateMappedRow } from './imports.validator';
import {
  CommitJobData,
  ParseJobData,
  ValidateJobData,
} from './imports.queue';

let worker: Worker | null = null;

async function handleParse(job: Job<ParseJobData>): Promise<void> {
  const { importJobId, tenantId } = job.data;
  logger.info({ importJobId, tenantId }, 'imports.parse.started');

  const record = await prisma.import.findFirst({
    where: { id: importJobId, tenantId },
  });
  if (!record) {
    throw new Error('Import job não encontrado');
  }

  await prisma.import.update({
    where: { id: importJobId },
    data: { status: ImportStatus.PROCESSING, statusMessage: null },
  });

  try {
    const parsed = await parseSpreadsheetFile(record.filePath);

    await prisma.$transaction(async (tx) => {
      await tx.importRow.deleteMany({ where: { importId: importJobId } });
      await tx.importRow.createMany({
        data: parsed.rows.map((row) => ({
          importId: importJobId,
          lineNumber: row.lineNumber,
          rawData: row.rawData,
          status: ImportRowStatus.OK,
        })),
      });

      await tx.import.update({
        where: { id: importJobId },
        data: {
          status: ImportStatus.READY_FOR_MAPPING,
          headers: parsed.headers,
          totalRows: parsed.rows.length,
          errorRows: 0,
          warningRows: 0,
        },
      });
    });

    logger.info({ importJobId, totalRows: parsed.rows.length }, 'imports.parse.completed');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro ao processar planilha';
    await prisma.import.update({
      where: { id: importJobId },
      data: {
        status: ImportStatus.FAILED,
        statusMessage: message,
        errorReport: [{ message }],
      },
    });
    logger.error({ importJobId, err: error }, 'imports.parse.failed');
    throw error;
  }
}

async function handleValidate(job: Job<ValidateJobData>): Promise<void> {
  const { importJobId, tenantId } = job.data;
  logger.info({ importJobId, tenantId }, 'imports.validate.started');

  const record = await prisma.import.findFirst({
    where: { id: importJobId, tenantId },
  });
  if (!record) {
    throw new Error('Import job não encontrado');
  }

  const mapping = record.columnMapping as ColumnMapping | null;
  if (!mapping || Object.keys(mapping).length === 0) {
    throw new Error('Mapeamento de colunas não definido');
  }

  await prisma.import.update({
    where: { id: importJobId },
    data: { status: ImportStatus.PROCESSING, statusMessage: null },
  });

  const rows = await prisma.importRow.findMany({
    where: { importId: importJobId },
    orderBy: { lineNumber: 'asc' },
  });

  const existingRows = await prisma.actionPlanRow.findMany({
    where: { actionPlan: { tenantId } },
    select: { externalKey: true, title: true },
  });

  const context = {
    existingExternalKeys: new Set(
      existingRows.map((r) => r.externalKey).filter((k): k is string => Boolean(k)),
    ),
    existingTitles: new Set(existingRows.map((r) => r.title.toLowerCase().trim())),
  };

  const sheetDuplicateTracker = new Map<string, number[]>();
  let errorCount = 0;
  let warningCount = 0;

  for (const row of rows) {
    const validated = validateMappedRow(
      row.lineNumber,
      row.rawData as Record<string, string>,
      mapping,
      context,
      sheetDuplicateTracker,
    );

    if (validated.status === ImportRowStatus.ERROR) errorCount += 1;
    if (validated.status === ImportRowStatus.WARNING) warningCount += 1;

    await prisma.importRow.update({
      where: { id: row.id },
      data: {
        mappedData: validated.mappedData as Prisma.InputJsonValue,
        status: validated.status,
        messages: validated.messages,
      },
    });
  }

  await prisma.import.update({
    where: { id: importJobId },
    data: {
      status: ImportStatus.READY_FOR_PREVIEW,
      errorRows: errorCount,
      warningRows: warningCount,
    },
  });

  logger.info(
    { importJobId, errorCount, warningCount },
    'imports.validate.completed',
  );
}

async function handleCommit(job: Job<CommitJobData>): Promise<void> {
  const { importJobId, tenantId, userId, actionPlanId, actionPlanTitle } = job.data;
  logger.info({ importJobId, tenantId }, 'imports.commit.started');

  await prisma.import.update({
    where: { id: importJobId },
    data: { status: ImportStatus.PROCESSING_COMMIT },
  });

  try {
    const result = await commitImportRows(prisma, {
      importId: importJobId,
      tenantId,
      ownerId: userId,
      input: { actionPlanId, actionPlanTitle },
    });

    const auditService = new AuditService(prisma);
    await auditService.log({
      tenantId,
      userId,
      action: 'imports.confirm',
      resource: 'import',
      resourceId: importJobId,
      metadata: {
        successRows: result.successRows,
        errorRows: result.errorRows,
        status: result.status,
      },
    });

    logger.info({ importJobId, result }, 'imports.commit.completed');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro ao confirmar importação';
    await prisma.import.update({
      where: { id: importJobId },
      data: {
        status: ImportStatus.FAILED,
        statusMessage: message,
      },
    });
    logger.error({ importJobId, err: error }, 'imports.commit.failed');
    throw error;
  }
}

export function startImportsWorker(): Worker {
  if (worker) return worker;

  const url = new URL(env.REDIS_URL);
  const connection = {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    maxRetriesPerRequest: null,
  };

  worker = new Worker(
    IMPORT_QUEUE_NAME,
    async (job) => {
      switch (job.name) {
        case IMPORT_JOB_TYPES.PARSE:
          await handleParse(job as Job<ParseJobData>);
          break;
        case IMPORT_JOB_TYPES.VALIDATE:
          await handleValidate(job as Job<ValidateJobData>);
          break;
        case IMPORT_JOB_TYPES.COMMIT:
          await handleCommit(job as Job<CommitJobData>);
          break;
        default:
          throw new Error(`Tipo de job desconhecido: ${job.name}`);
      }
    },
    { connection, concurrency: 2 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, jobName: job?.name, err }, 'imports.worker.failed');
  });

  logger.info('Imports worker started');
  return worker;
}

export async function stopImportsWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
}
