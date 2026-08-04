import { z } from 'zod';
import { CalendarActivityStatus, CalendarOverrideType } from '@prisma/client';

export const calendarRangeQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  assigneeId: z.string().uuid().optional(),
  status: z.nativeEnum(CalendarActivityStatus).optional(),
});

export const createActivitySchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(5000).optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional(),
  allDay: z.boolean().optional().default(false),
  status: z.nativeEnum(CalendarActivityStatus).optional(),
  assigneeId: z.string().uuid().optional().nullable(),
  location: z.string().max(200).optional(),
  color: z.string().max(30).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const updateActivitySchema = createActivitySchema.partial();

export const upsertOverrideSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  type: z.nativeEnum(CalendarOverrideType).optional().default(CalendarOverrideType.NOTE),
  title: z.string().max(200).optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const putOverridesSchema = z.object({
  overrides: z.array(upsertOverrideSchema).min(1),
});

export const overridesQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** Overlay pessoal sobre ação da base — NÃO altera dueDate da planilha. */
export const upsertActionOverlaySchema = z.object({
  displayStartsAt: z.string().datetime().optional().nullable(),
  displayEndsAt: z.string().datetime().optional().nullable(),
  hidden: z.boolean().optional(),
  note: z.string().max(2000).optional().nullable(),
  color: z.string().max(30).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const actionRowIdParamsSchema = z.object({
  actionRowId: z.string().uuid(),
});

export type CalendarRangeQuery = z.infer<typeof calendarRangeQuerySchema>;
export type CreateActivityInput = z.infer<typeof createActivitySchema>;
export type UpdateActivityInput = z.infer<typeof updateActivitySchema>;
export type UpsertOverrideInput = z.infer<typeof upsertOverrideSchema>;
export type PutOverridesInput = z.infer<typeof putOverridesSchema>;
export type UpsertActionOverlayInput = z.infer<typeof upsertActionOverlaySchema>;
