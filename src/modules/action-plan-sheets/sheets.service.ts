import { inject, injectable } from 'tsyringe';
import {
  ActionPriority,
  ActionStatus,
  ColumnFieldType,
  ColumnHistoryAction,
} from '@prisma/client';
import { ForbiddenError, NotFoundError } from '@shared/errors/AppError';
import { AuthUser } from '@/types/auth';
import {
  canCreateActions,
  canImportSpreadsheet,
  canManageColumns,
  isPlatformAdmin,
} from '@shared/helpers/rbac';
import { ActionPlansRepository } from '@modules/action-plans/action-plans.repository';
import { ActionPlansService } from '@modules/action-plans/action-plans.service';
import { ColumnsRepository } from '@modules/columns/columns.repository';
import {
  BulkSheetInput,
  ColumnsOrderInput,
  ImportSheetJsonInput,
} from '@modules/action-plans/action-plans.schemas';
import { CreateColumnInput } from '@modules/columns/columns.schemas';

const STATUS_MAP: Record<string, ActionStatus> = {
  pending: ActionStatus.PENDING,
  pendente: ActionStatus.PENDING,
  in_progress: ActionStatus.IN_PROGRESS,
  'em andamento': ActionStatus.IN_PROGRESS,
  completed: ActionStatus.COMPLETED,
  concluido: ActionStatus.COMPLETED,
  delayed: ActionStatus.DELAYED,
  atrasado: ActionStatus.DELAYED,
};

const PRIORITY_MAP: Record<string, ActionPriority> = {
  low: ActionPriority.LOW,
  baixa: ActionPriority.LOW,
  medium: ActionPriority.MEDIUM,
  media: ActionPriority.MEDIUM,
  high: ActionPriority.HIGH,
  alta: ActionPriority.HIGH,
  critical: ActionPriority.CRITICAL,
  critica: ActionPriority.CRITICAL,
};

@injectable()
export class SheetsService {
  constructor(
    @inject(ActionPlansRepository) private readonly plansRepo: ActionPlansRepository,
    @inject(ActionPlansService) private readonly plansService: ActionPlansService,
    @inject(ColumnsRepository) private readonly columnsRepo: ColumnsRepository,
  ) {}

  async list(actor: AuthUser) {
    return this.plansService.listPlans(actor);
  }

  async getById(actor: AuthUser, id: string) {
    const plan = await this.plansService.getById(actor, id);
    const columns = await this.columnsRepo.listActive(actor.tenantId);
    return { ...plan, columns };
  }

  async getOrCreateForEmpresa(actor: AuthUser, empresaId?: string) {
    if (isPlatformAdmin(actor)) throw new ForbiddenError();
    const tenantId = empresaId ?? actor.tenantId;
    if (tenantId !== actor.tenantId) throw new ForbiddenError();

    let plan = await this.plansRepo.findPrimaryPlan(tenantId);
    if (!plan) {
      if (!canCreateActions(actor)) throw new ForbiddenError();
      plan = await this.plansRepo.createPlan({
        tenantId,
        ownerId: actor.id,
        title: 'Planilha principal',
      });
    }
    return this.getById(actor, plan.id);
  }

  async createColumn(actor: AuthUser, sheetId: string, input: CreateColumnInput) {
    await this.assertSheet(actor, sheetId);
    if (!canManageColumns(actor)) throw new ForbiddenError();
    const column = await this.columnsRepo.create(actor.tenantId, input);
    await this.columnsRepo.addHistory({
      columnId: column.id,
      actorId: actor.id,
      action: ColumnHistoryAction.CREATED,
      snapshot: column,
    });
    return column;
  }

  async updateColumn(
    actor: AuthUser,
    sheetId: string,
    columnId: string,
    input: { label?: string; required?: boolean; options?: string[]; sortOrder?: number },
  ) {
    await this.assertSheet(actor, sheetId);
    if (!canManageColumns(actor)) throw new ForbiddenError();
    const existing = await this.columnsRepo.findById(columnId, actor.tenantId);
    if (!existing || existing.deletedAt) throw new NotFoundError('Coluna não encontrada');
    return this.columnsRepo.update(columnId, input);
  }

  async deleteColumn(actor: AuthUser, sheetId: string, columnId: string) {
    await this.assertSheet(actor, sheetId);
    if (!canManageColumns(actor)) throw new ForbiddenError();
    return this.columnsRepo.softDelete(columnId, actor.id);
  }

  async orderColumns(actor: AuthUser, sheetId: string, input: ColumnsOrderInput) {
    await this.assertSheet(actor, sheetId);
    if (!canManageColumns(actor)) throw new ForbiddenError();
    await Promise.all(
      input.order.map((id, index) => this.columnsRepo.update(id, { sortOrder: index })),
    );
    return this.columnsRepo.listActive(actor.tenantId);
  }

  async resetColumns(actor: AuthUser, sheetId: string) {
    await this.assertSheet(actor, sheetId);
    if (!canManageColumns(actor)) throw new ForbiddenError();
    const columns = await this.columnsRepo.listActive(actor.tenantId);
    for (const col of columns) {
      await this.columnsRepo.softDelete(col.id, actor.id, 'reset');
    }
    return { reset: columns.length };
  }

  async resolveRow(
    actor: AuthUser,
    sheetId: string,
    rowId: string,
    input: { evidence?: string; completedAt?: string; comment?: string },
  ) {
    await this.assertSheet(actor, sheetId);
    return this.plansService.resolve(actor, rowId, input);
  }

  async bulkSave(actor: AuthUser, sheetId: string, input: BulkSheetInput) {
    const plan = await this.assertSheet(actor, sheetId);
    if (!canCreateActions(actor) && !canManageColumns(actor)) {
      throw new ForbiddenError();
    }

    if (input.title) {
      await this.plansRepo.updatePlan(plan.id, { title: input.title });
    }

    if (input.columns && canManageColumns(actor)) {
      for (const [index, col] of input.columns.entries()) {
        if (col.id) {
          await this.columnsRepo.update(col.id, {
            label: col.label,
            required: col.required,
            options: col.options,
            sortOrder: col.sortOrder ?? index,
          });
        } else {
          const name = col.name
            .toLowerCase()
            .replace(/[^a-z0-9_]+/g, '_')
            .replace(/^[^a-z]/, 'c_')
            .slice(0, 60);
          try {
            await this.columnsRepo.create(actor.tenantId, {
              name,
              label: col.label,
              fieldType: col.fieldType ?? ColumnFieldType.TEXT,
              required: col.required ?? false,
              options: col.options,
              sortOrder: col.sortOrder ?? index,
            });
          } catch {
            // ignore duplicates on autosave
          }
        }
      }
    }

    if (input.rows && canCreateActions(actor)) {
      for (const row of input.rows) {
        if (row.id) {
          await this.plansService.updateRow(actor, row.id, {
            title: row.title,
            description: row.description,
            status: row.status,
            priority: row.priority,
            dueDate: row.dueDate,
            responsibleId: row.responsibleId,
            unitId: row.unitId,
            values: row.values,
          });
        } else {
          await this.plansService.addRow(actor, sheetId, {
            title: row.title,
            description: row.description,
            status: row.status,
            priority: row.priority,
            dueDate: row.dueDate,
            responsibleId: row.responsibleId,
            unitId: row.unitId,
            values: row.values,
          });
        }
      }
    }

    return this.getById(actor, sheetId);
  }

  async importJson(actor: AuthUser, input: ImportSheetJsonInput) {
    if (!canImportSpreadsheet(actor)) throw new ForbiddenError();
    if (isPlatformAdmin(actor)) throw new ForbiddenError();

    const tenantId = input.empresaId ?? actor.tenantId;
    if (tenantId !== actor.tenantId) throw new ForbiddenError();

    const issues: Array<{ line?: number; message: string }> = [];
    let imported = 0;
    let skipped = 0;

    let plan = await this.plansRepo.findPrimaryPlan(tenantId);
    if (!plan || input.options?.replaceExisting === false) {
      plan = await this.plansRepo.createPlan({
        tenantId,
        ownerId: actor.id,
        title: input.title,
      });
    } else {
      await this.plansRepo.updatePlan(plan.id, { title: input.title });
    }

    for (const [index, col] of input.columns.entries()) {
      const name = col.name
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^[^a-z]/, 'c_')
        .slice(0, 60);
      try {
        await this.columnsRepo.create(tenantId, {
          name,
          label: col.label,
          fieldType: col.fieldType ?? ColumnFieldType.TEXT,
          required: col.required ?? false,
          options: col.options,
          sortOrder: col.sortOrder ?? index,
        });
      } catch {
        // column may already exist
      }
    }

    for (const [index, row] of input.rows.entries()) {
      try {
        if (!row.title?.trim()) {
          skipped += 1;
          issues.push({ line: index + 1, message: 'Título vazio' });
          continue;
        }
        const status = row.status
          ? STATUS_MAP[row.status.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')]
          : ActionStatus.PENDING;
        const priority = row.priority
          ? PRIORITY_MAP[
              row.priority.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            ]
          : ActionPriority.MEDIUM;

        if (row.status && !status) {
          skipped += 1;
          issues.push({ line: index + 1, message: `Status inválido: ${row.status}` });
          continue;
        }

        await this.plansService.addRow(actor, plan.id, {
          title: row.title,
          description: row.description,
          status: status ?? ActionStatus.PENDING,
          priority: priority ?? ActionPriority.MEDIUM,
          dueDate: row.dueDate ? new Date(row.dueDate).toISOString() : undefined,
          responsibleId: row.responsibleId,
          unitId: row.unitId,
          values: row.values,
        });
        imported += 1;
      } catch (error) {
        skipped += 1;
        issues.push({
          line: index + 1,
          message: error instanceof Error ? error.message : 'Erro ao importar linha',
        });
      }
    }

    return {
      planId: plan.id,
      imported,
      skipped,
      issues,
    };
  }

  private async assertSheet(actor: AuthUser, sheetId: string) {
    if (isPlatformAdmin(actor)) throw new ForbiddenError();
    const plan = await this.plansRepo.findPlan(sheetId, actor.tenantId);
    if (!plan) throw new NotFoundError('Planilha não encontrada');
    return plan;
  }
}
