import { z } from 'zod';
import { ColumnFieldType, ColumnSemanticRole } from '@prisma/client';

const CHOICE_FIELD_TYPES: ColumnFieldType[] = [
  ColumnFieldType.SELECT,
  ColumnFieldType.MULTI_SELECT,
];

function isChoiceFieldType(fieldType: ColumnFieldType) {
  return CHOICE_FIELD_TYPES.includes(fieldType);
}

function hasChoiceOptions(options?: string[]) {
  return (options ?? []).some((option) => option.trim().length > 0);
}

export const createColumnSchema = z
  .object({
    name: z
      .string()
      .min(2)
      .max(60)
      .regex(/^[a-z][a-z0-9_]*$/),
    label: z.string().min(2).max(120),
    fieldType: z.nativeEnum(ColumnFieldType),
    semanticRole: z.nativeEnum(ColumnSemanticRole).optional(),
    required: z.boolean().optional().default(false),
    options: z.array(z.string()).optional(),
    sortOrder: z.number().int().optional().default(0),
    actionPlanId: z.string().uuid().optional(),
  })
  .superRefine((data, ctx) => {
    if (isChoiceFieldType(data.fieldType) && !hasChoiceOptions(data.options)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Select precisa de pelo menos uma opção',
        path: ['options'],
      });
    }
  });

export const updateColumnSchema = z
  .object({
    label: z.string().min(2).max(120).optional(),
    fieldType: z.nativeEnum(ColumnFieldType).optional(),
    required: z.boolean().optional(),
    options: z.array(z.string()).optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
    semanticRole: z.nativeEnum(ColumnSemanticRole).optional(),
  })
  .superRefine((data, ctx) => {
    if (
      data.fieldType &&
      isChoiceFieldType(data.fieldType) &&
      data.options !== undefined &&
      !hasChoiceOptions(data.options)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Select precisa de pelo menos uma opção',
        path: ['options'],
      });
    }
  });

export const deleteColumnSchema = z.object({
  reason: z.string().min(2).max(500).optional(),
});

export type CreateColumnInput = z.infer<typeof createColumnSchema>;
export type UpdateColumnInput = z.infer<typeof updateColumnSchema>;
export type DeleteColumnInput = z.infer<typeof deleteColumnSchema>;
