import { Queue, Job } from 'bullmq';
import { randomUUID } from 'crypto';
import { getRedisConnection } from '@config/redis';
import { NotFoundError } from '@shared/errors/AppError';
import type { AuthUser } from '@/types/auth';
import type { ImportFromParseInput } from '@modules/action-plans/action-plans.schemas';
import type { SheetParseMeta } from './sheet-parse.store';

export const SHEET_QUEUE_NAME = 'sheet-jobs';

export const SHEET_JOB_TYPES = {
  PARSE: 'parse',
  IMPORT: 'import',
} as const;

export type SheetJobStatus = 'queued' | 'running' | 'done' | 'failed';
export type SheetJobType = 'parse' | 'import';

export type SheetJobProgress = {
  current: number;
  total: number;
  phase: 'parse' | 'import';
};

export type SheetParsePeekRow = {
  line: number;
  values: string[];
};

export type SheetParseJobResult = {
  parseId: string;
  fileName: string;
  sheetName: string;
  headers: string[];
  totalRows: number;
  sampleRows: Record<string, string>[];
  emptyColumns: string[];
  distincts: Record<string, string[]>;
  truncated?: boolean;
  suggestedHeaderRow: number;
  peekRows: SheetParsePeekRow[];
  columnCount: number;
};

export type SheetImportJobResult = {
  planId: string;
  imported: number;
  skipped: number;
  issues: Array<{ line?: number; message: string }>;
};

export type SheetJob = {
  jobId: string;
  tenantId: string;
  actorId: string;
  type: SheetJobType;
  status: SheetJobStatus;
  progress: SheetJobProgress;
  error?: string;
  result?: SheetParseJobResult | SheetImportJobResult;
  createdAt: string;
};

export type SheetParseJobData = {
  tenantId: string;
  actor: AuthUser;
  filePath: string;
  originalName: string;
};

export type SheetImportJobData = {
  tenantId: string;
  actor: AuthUser;
  input: ImportFromParseInput;
};

const JOB_TTL_SECONDS = 6 * 60 * 60;

let queue: Queue<SheetParseJobData | SheetImportJobData> | null = null;

function jobOpts() {
  return {
    removeOnComplete: { age: JOB_TTL_SECONDS },
    removeOnFail: { age: JOB_TTL_SECONDS },
    attempts: 1,
  };
}

export function getSheetJobsQueue() {
  if (!queue) {
    queue = new Queue(SHEET_QUEUE_NAME, { connection: getRedisConnection() });
  }
  return queue;
}

export async function enqueueSheetParseJob(data: SheetParseJobData): Promise<string> {
  const jobId = randomUUID();
  await getSheetJobsQueue().add(SHEET_JOB_TYPES.PARSE, data, { jobId, ...jobOpts() });
  return jobId;
}

export async function enqueueSheetImportJob(data: SheetImportJobData): Promise<string> {
  const jobId = randomUUID();
  await getSheetJobsQueue().add(SHEET_JOB_TYPES.IMPORT, data, { jobId, ...jobOpts() });
  return jobId;
}

export async function getSheetJob(tenantId: string, jobId: string): Promise<SheetJob> {
  const bullJob = await getSheetJobsQueue().getJob(jobId);
  if (!bullJob || bullJob.data.tenantId !== tenantId) {
    throw new NotFoundError('Processamento não encontrado. Envie a planilha novamente.');
  }
  return toSheetJob(bullJob);
}

export async function closeSheetJobsQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
}

export function toParseJobResult(
  meta: SheetParseMeta,
  sampleRows: Record<string, string>[],
): SheetParseJobResult {
  return {
    parseId: meta.parseId,
    fileName: meta.fileName,
    sheetName: meta.sheetName,
    headers: meta.headers,
    totalRows: meta.totalRows,
    sampleRows,
    emptyColumns: meta.emptyColumns,
    distincts: meta.distincts ?? {},
    truncated: meta.truncated ?? false,
    suggestedHeaderRow: meta.suggestedHeaderRow ?? 1,
    peekRows: meta.peekRows ?? [],
    columnCount: meta.columnCount ?? meta.headers.length,
  };
}

async function toSheetJob(
  job: Job<SheetParseJobData | SheetImportJobData>,
): Promise<SheetJob> {
  const state = await job.getState();
  const progress = normalizeProgress(job.progress, job.name === SHEET_JOB_TYPES.IMPORT ? 'import' : 'parse');
  const result = job.returnvalue as SheetParseJobResult | SheetImportJobResult | undefined;

  return {
    jobId: String(job.id),
    tenantId: job.data.tenantId,
    actorId: job.data.actor.id,
    type: job.name === SHEET_JOB_TYPES.IMPORT ? 'import' : 'parse',
    status: mapBullState(state),
    progress,
    error: job.failedReason || undefined,
    result,
    createdAt: new Date(job.timestamp).toISOString(),
  };
}

function mapBullState(state: string): SheetJobStatus {
  if (state === 'completed') return 'done';
  if (state === 'failed') return 'failed';
  if (state === 'active') return 'running';
  return 'queued';
}

function normalizeProgress(raw: unknown, fallbackPhase: SheetJobProgress['phase']): SheetJobProgress {
  if (raw && typeof raw === 'object' && 'phase' in (raw as object)) {
    const value = raw as SheetJobProgress;
    return {
      current: Number(value.current) || 0,
      total: Number(value.total) || 0,
      phase: value.phase === 'import' ? 'import' : 'parse',
    };
  }
  return { current: 0, total: 0, phase: fallbackPhase };
}
