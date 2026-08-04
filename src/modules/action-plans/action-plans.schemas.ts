import { z } from 'zod';
import { ActionPriority, ActionStatus, ColumnFieldType } from '@prisma/client';

export const createActionPlanSchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().optional(),
  unitId: z.string().uuid().optional(),
  year: z.number().int().optional(),
  month: z.number().int().min(1).max(12).optional(),
});

export const createActionRowSchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().optional(),
  unitId: z.string().uuid().optional(),
  responsibleId: z.string().uuid().optional(),
  status: z.nativeEnum(ActionStatus).optional(),
  priority: z.nativeEnum(ActionPriority).optional(),
  dueDate: z.string().datetime().optional(),
  externalKey: z.string().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

export const updateActionRowSchema = createActionRowSchema.partial().extend({
  comment: z.string().max(2000).optional(),
});

export const resolveActionSchema = z.object({
  evidence: z.string().max(5000).optional(),
  completedAt: z.string().datetime().optional(),
  comment: z.string().max(2000).optional(),
});

export const bulkSheetSchema = z.object({
  title: z.string().min(2).max(200).optional(),
  columns: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(60),
        label: z.string().min(1).max(120),
        fieldType: z.nativeEnum(ColumnFieldType).optional(),
        required: z.boolean().optional(),
        options: z.array(z.string()).optional(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .optional(),
  rows: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        title: z.string().min(1).max(200),
        description: z.string().optional(),
        status: z.nativeEnum(ActionStatus).optional(),
        priority: z.nativeEnum(ActionPriority).optional(),
        dueDate: z.string().datetime().optional(),
        responsibleId: z.string().uuid().optional(),
        unitId: z.string().uuid().optional(),
        values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
      }),
    )
    .optional(),
});

export const importSheetJsonSchema = z.object({
  empresaId: z.string().uuid().optional(),
  title: z.string().min(2).max(200),
  columns: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        label: z.string().min(1).max(120),
        fieldType: z.nativeEnum(ColumnFieldType).optional(),
        required: z.boolean().optional(),
        options: z.array(z.string()).optional(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .default([]),
  rows: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        description: z.string().optional(),
        status: z.string().optional(),
        priority: z.string().optional(),
        dueDate: z.string().optional(),
        responsibleId: z.string().uuid().optional(),
        unitId: z.string().uuid().optional(),
        values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
      }),
    )
    .default([]),
  options: z
    .object({
      replaceExisting: z.boolean().optional(),
    })
    .optional(),
});

export const columnsOrderSchema = z.object({
  order: z.array(z.string().uuid()).min(1),
});

export const listActionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().optional(),
  status: z.nativeEnum(ActionStatus).optional(),
  priority: z.nativeEnum(ActionPriority).optional(),
  unitId: z.string().uuid().optional(),
  responsibleId: z.string().uuid().optional(),
  actionPlanId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  includeDeleted: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === 'true'),
});

export const transitionActionSchema = z.object({
  comment: z.string().max(2000).optional(),
});

export const approveActionSchema = z.object({
  comment: z.string().max(2000).optional(),
});

export const rejectActionSchema = z.object({
  comment: z.string().min(2).max(2000),
});

export type CreateActionPlanInput = z.infer<typeof createActionPlanSchema>;
export type CreateActionRowInput = z.infer<typeof createActionRowSchema>;
export type UpdateActionRowInput = z.infer<typeof updateActionRowSchema>;
export type ListActionsQuery = z.infer<typeof listActionsQuerySchema>;
export type TransitionActionInput = z.infer<typeof transitionActionSchema>;
export type ApproveActionInput = z.infer<typeof approveActionSchema>;
export type RejectActionInput = z.infer<typeof rejectActionSchema>;
export type ResolveActionInput = z.infer<typeof resolveActionSchema>;
export type BulkSheetInput = z.infer<typeof bulkSheetSchema>;
export type ImportSheetJsonInput = z.infer<typeof importSheetJsonSchema>;
export type ColumnsOrderInput = z.infer<typeof columnsOrderSchema>;
