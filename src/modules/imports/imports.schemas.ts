import { z } from 'zod';

export const importJobIdParamsSchema = z.object({
  jobId: z.string().uuid(),
});

export const listImportsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const previewQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  status: z.enum(['OK', 'WARNING', 'ERROR']).optional(),
});

export const columnMappingSchema = z.object({
  mapping: z
    .record(z.string().min(1), z.string().min(1))
    .refine((mapping) => Object.keys(mapping).length > 0, {
      message: 'Mapeamento não pode ser vazio',
    }),
});

export const confirmImportSchema = z.object({
  actionPlanId: z.string().uuid().optional(),
  actionPlanTitle: z.string().min(2).max(200).optional(),
});

/** Compatibilidade com rota legada /spreadsheet/confirm */
export const legacyConfirmImportSchema = confirmImportSchema.extend({
  importId: z.string().uuid(),
});

export type ColumnMappingInput = z.infer<typeof columnMappingSchema>;
export type ConfirmImportInput = z.infer<typeof confirmImportSchema>;
export type LegacyConfirmImportInput = z.infer<typeof legacyConfirmImportSchema>;
export type ListImportsQuery = z.infer<typeof listImportsQuerySchema>;
export type PreviewQuery = z.infer<typeof previewQuerySchema>;

export const REQUIRED_COLUMNS = [
  'titulo',
  'status',
  'prioridade',
  'responsavel',
  'unidade',
] as const;

export type SpreadsheetRow = {
  line: number;
  titulo: string;
  descricao?: string;
  status: string;
  prioridade: string;
  responsavel: string;
  unidade: string;
  prazo?: string;
  chave?: string;
};
