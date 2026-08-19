import { Queue } from 'bullmq';
import { getRedisConnection } from '@config/redis';
import { IMPORT_JOB_TYPES, IMPORT_QUEUE_NAME } from './imports.constants';

export type ParseJobData = {
  importJobId: string;
  tenantId: string;
};

export type ValidateJobData = {
  importJobId: string;
  tenantId: string;
};

export type CommitJobData = {
  importJobId: string;
  tenantId: string;
  userId: string;
  actionPlanId?: string;
  actionPlanTitle?: string;
};

let queue: Queue | null = null;

export function getImportsQueue(): Queue {
  if (!queue) {
    queue = new Queue(IMPORT_QUEUE_NAME, { connection: getRedisConnection() });
  }
  return queue;
}

export async function enqueueParseJob(data: ParseJobData): Promise<void> {
  await getImportsQueue().add(IMPORT_JOB_TYPES.PARSE, data, {
    removeOnComplete: 100,
    removeOnFail: 200,
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  });
}

export async function enqueueValidateJob(data: ValidateJobData): Promise<void> {
  await getImportsQueue().add(IMPORT_JOB_TYPES.VALIDATE, data, {
    removeOnComplete: 100,
    removeOnFail: 200,
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  });
}

export async function enqueueCommitJob(data: CommitJobData): Promise<void> {
  await getImportsQueue().add(IMPORT_JOB_TYPES.COMMIT, data, {
    removeOnComplete: 100,
    removeOnFail: 200,
    attempts: 2,
    backoff: { type: 'exponential', delay: 3000 },
  });
}

export async function closeImportsQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
}
