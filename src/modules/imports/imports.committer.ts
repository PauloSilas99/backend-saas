import {
  ActionPriority,
  ActionStatus,
  ImportRowStatus,
  ImportStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { generateIdempotencyKey } from '@shared/helpers/crypto';
import { logger } from '@shared/logger';
import { DEFAULT_COMMIT_POLICY, CommitPolicy } from './imports.constants';
import { ColumnMapping } from './imports.mapping';

type CommitInput = {
  actionPlanId?: string;
  actionPlanTitle?: string;
};

type CommitRow = {
  lineNumber: number;
  mappedData: Prisma.JsonValue;
  status: ImportRowStatus;
};

export type CommitResult = {
  status: ImportStatus;
  successRows: number;
  errorRows: number;
  skippedRows: number;
  actionPlanId: string;
};

export async function commitImportRows(
  prisma: PrismaClient,
  params: {
    importId: string;
    tenantId: string;
    ownerId: string;
    input: CommitInput;
    policy?: CommitPolicy;
  },
): Promise<CommitResult> {
  const policy = params.policy ?? DEFAULT_COMMIT_POLICY;

  return prisma.$transaction(async (tx) => {
    const importRecord = await tx.import.findFirst({
      where: { id: params.importId, tenantId: params.tenantId },
    });
    if (!importRecord) {
      throw new Error('Importação não encontrada');
    }

    const rows = await tx.importRow.findMany({
      where: { importId: params.importId },
      orderBy: { lineNumber: 'asc' },
    });

    const blockingErrors = rows.filter((r) => r.status === ImportRowStatus.ERROR);
    if (policy === 'block_on_errors' && blockingErrors.length > 0) {
      throw new Error(
        `Confirmação bloqueada: ${blockingErrors.length} linha(s) com erro. Corrija ou altere a política.`,
      );
    }

    let actionPlanId = params.input.actionPlanId;
    if (!actionPlanId) {
      const plan = await tx.actionPlan.create({
        data: {
          tenantId: params.tenantId,
          ownerId: params.ownerId,
          title: params.input.actionPlanTitle ?? `Importação ${importRecord.originalName}`,
        },
      });
      actionPlanId = plan.id;
    } else {
      const plan = await tx.actionPlan.findFirst({
        where: { id: actionPlanId, tenantId: params.tenantId },
      });
      if (!plan) {
        throw new Error('Plano de ação não encontrado');
      }
    }

    const units = await tx.unit.findMany({ where: { tenantId: params.tenantId } });
    const users = await tx.user.findMany({
      where: { memberships: { some: { tenantId: params.tenantId } } },
    });

    let success = 0;
    let skipped = 0;

    for (const row of rows as CommitRow[]) {
      if (row.status === ImportRowStatus.ERROR) {
        skipped += 1;
        continue;
      }

      const data = row.mappedData as Record<string, unknown>;
      const title = String(data.title ?? '').trim();
      const status = data.status as ActionStatus;
      const priority = data.priority as ActionPriority;
      const responsibleName = String(data.responsibleName ?? '').trim();
      const unitName = String(data.unitName ?? '').trim();
      const dueDateRaw = data.dueDate ? String(data.dueDate) : undefined;
      const description = data.description ? String(data.description) : undefined;

      const unit = units.find(
        (u) => u.name.toLowerCase().trim() === unitName.toLowerCase().trim(),
      );
      const responsible = users.find(
        (u) =>
          u.name.toLowerCase().trim() === responsibleName.toLowerCase().trim() ||
          u.email.toLowerCase().trim() === responsibleName.toLowerCase().trim(),
      );

      const externalKey =
        (data.externalKey ? String(data.externalKey).trim() : '') ||
        generateIdempotencyKey([
          actionPlanId,
          title,
          responsibleName,
          unitName,
          dueDateRaw ?? '',
        ]).slice(0, 32);

      await tx.actionPlanRow.upsert({
        where: {
          actionPlanId_externalKey: {
            actionPlanId,
            externalKey,
          },
        },
        update: {
          title,
          description,
          status,
          priority,
          dueDate: dueDateRaw ? new Date(dueDateRaw) : null,
          unitId: unit?.id,
          responsibleId: responsible?.id,
          responsibleName,
          unitName,
        },
        create: {
          actionPlanId,
          externalKey,
          title,
          description,
          status,
          priority,
          dueDate: dueDateRaw ? new Date(dueDateRaw) : null,
          unitId: unit?.id,
          responsibleId: responsible?.id,
          responsibleName,
          unitName,
        },
      });

      success += 1;
    }

    const finalStatus =
      skipped === 0
        ? ImportStatus.COMPLETED
        : success > 0
          ? ImportStatus.PARTIAL
          : ImportStatus.FAILED;

    await tx.import.update({
      where: { id: params.importId },
      data: {
        status: finalStatus,
        actionPlanId,
        successRows: success,
        errorRows: skipped,
        confirmedAt: new Date(),
      },
    });

    logger.info(
      {
        importId: params.importId,
        successRows: success,
        skippedRows: skipped,
        status: finalStatus,
      },
      'imports.commit.completed',
    );

    return {
      status: finalStatus,
      successRows: success,
      errorRows: skipped,
      skippedRows: skipped,
      actionPlanId,
    };
  });
}
