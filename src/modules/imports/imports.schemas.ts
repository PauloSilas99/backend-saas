import { z } from 'zod';

export const confirmImportSchema = z.object({
  importId: z.string().uuid(),
  actionPlanId: z.string().uuid().optional(),
  actionPlanTitle: z.string().min(2).max(200).optional(),
});

export type ConfirmImportInput = z.infer<typeof confirmImportSchema>;

export const REQUIRED_COLUMNS = [
  'titulo',
  'status',
  'prioridade',
  'responsavel',
  'unidade',
  'prazo',
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
