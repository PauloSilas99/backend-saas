import { ColumnFieldType } from '@prisma/client';

export const TEMPLATE_VERSION = 1;

export type CanonicalRole =
  | 'EXTERNAL_KEY'
  | 'TENANT_HINT'
  | 'UNIT'
  | 'TITLE'
  | 'PRIORITY'
  | 'ASSIGNEE'
  | 'DUE_DATE'
  | 'COMPLETED_AT'
  | 'STATUS'
  | 'STATUS_FINAL'
  | 'EVIDENCE';

export type CanonicalBlock =
  | 'identificacao'
  | 'perigo'
  | 'avaliacao'
  | 'controles'
  | 'verificacao'
  | 'calculo_risco'
  | 'plano_acao'
  | 'prazos_custo'
  | 'status'
  | 'evidencia_validacao'
  | 'equipe_campo'
  | 'reavaliacao';

export type CanonicalColumn = {
  key: string;
  column: string;
  label: string;
  aliases: string[];
  fieldType: ColumnFieldType;
  block: CanonicalBlock;
  role?: CanonicalRole;
  vocabulary?: string[];
  systemManaged?: boolean;
};

const T = ColumnFieldType.TEXT;
const LONG = ColumnFieldType.LONG_TEXT;
const NUM = ColumnFieldType.NUMBER;
const DATE = ColumnFieldType.DATE;
const SELECT = ColumnFieldType.SELECT;
const MONEY = ColumnFieldType.CURRENCY;

export const STATUS_ATUAL_VOCABULARY = [
  'no prazo',
  'em atraso',
  'concluído',
  'cancelado',
  'sem prazo',
] as const;

export const STATUS_FINAL_VOCABULARY = [
  'concluída no prazo',
  'concluída em atraso',
  'concluída',
  'cancelada',
] as const;

export const PRIORIDADE_VOCABULARY = ['crítica', 'alta', 'média', 'baixa'] as const;

export const CANONICAL_COLUMNS: CanonicalColumn[] = [
  { key: 'id', column: 'A', label: 'ID', aliases: ['codigo', 'external_key'], fieldType: T, block: 'identificacao', role: 'EXTERNAL_KEY', systemManaged: true },
  { key: 'tema', column: 'B', label: 'TEMA', aliases: ['indicador', 'programa'], fieldType: T, block: 'identificacao' },
  { key: 'data_criacao', column: 'C', label: 'DATA CRIAÇÃO', aliases: ['data_de_criacao'], fieldType: DATE, block: 'identificacao' },
  { key: 'empresa', column: 'D', label: 'EMPRESA', aliases: [], fieldType: T, block: 'identificacao', role: 'TENANT_HINT' },
  { key: 'regional', column: 'E', label: 'REGIONAL', aliases: [], fieldType: T, block: 'identificacao' },
  { key: 'unidade', column: 'F', label: 'UNIDADE', aliases: ['filial', 'local'], fieldType: T, block: 'identificacao', role: 'UNIT' },
  { key: 'diretoria', column: 'G', label: 'DIRETORIA', aliases: [], fieldType: T, block: 'identificacao' },
  { key: 'gerencia', column: 'H', label: 'GERÊNCIA', aliases: [], fieldType: T, block: 'identificacao' },
  { key: 'ges', column: 'I', label: 'GES', aliases: ['grupo_homogeneo_de_exposicao'], fieldType: T, block: 'identificacao' },

  { key: 'processo_area_setor', column: 'J', label: 'PROCESSO, ÁREA OU SETOR', aliases: ['setor', 'area'], fieldType: T, block: 'perigo' },
  { key: 'atividade_tarefa_posto', column: 'K', label: 'ATIVIDADE / TAREFA OU POSTO DE TRABALHO', aliases: ['atividade', 'tarefa'], fieldType: T, block: 'perigo' },
  { key: 'perigo', column: 'L', label: 'PERIGO', aliases: [], fieldType: T, block: 'perigo' },
  { key: 'fontes_circunstancias', column: 'M', label: 'FONTES / CIRCUNSTÂNCIAS', aliases: [], fieldType: T, block: 'perigo' },
  { key: 'possiveis_lesoes', column: 'N', label: 'POSÍVEIS LESÕES / AGRAVOS À SAÚDE', aliases: ['possiveis_lesoes_agravos_a_saude'], fieldType: T, block: 'perigo' },
  { key: 'tempo_exposicao_min', column: 'O', label: 'TEMPO DE EXPOSIÇÃO (EM  MINUTOS)', aliases: ['tempo_de_exposicao', 'tempo_exposicao'], fieldType: NUM, block: 'perigo' },
  { key: 'frequencia_exposicao', column: 'P', label: 'FREQUENCIA DE EXPOSIÇÃO', aliases: ['frequencia_de_exposicao'], fieldType: T, block: 'perigo' },

  { key: 'tipo_avaliacao', column: 'Q', label: 'TIPO DE AVALIAÇÃO', aliases: [], fieldType: T, block: 'avaliacao' },
  { key: 'dados_analise', column: 'R', label: 'DADOS DA ANÁLISE / RESULTADO DO MONITORAMENTO', aliases: ['dados_da_analise'], fieldType: LONG, block: 'avaliacao' },

  { key: 'medidas_controle', column: 'S', label: 'AÇÕES / MEDIDA(S) DE CONTROLE', aliases: ['medidas_de_controle', 'medida_de_controle'], fieldType: LONG, block: 'controles' },
  { key: 'eliminara_perigo', column: 'T', label: 'ELININARÁ O PERIGO?', aliases: ['eliminara_o_perigo', 'elininara_o_perigo'], fieldType: T, block: 'controles' },
  { key: 'rgi_regra_ouro', column: 'U', label: 'RGI / REGRA DE OURO?', aliases: ['regra_de_ouro', 'rgi'], fieldType: T, block: 'controles' },
  { key: 'hierarquia_controle', column: 'V', label: 'HIERARQUIA DE CONTROLE', aliases: [], fieldType: T, block: 'controles' },
  { key: 'forma_acompanhamento', column: 'W', label: 'FORMA DE ACOMPANHAMENTO', aliases: [], fieldType: T, block: 'controles' },

  { key: 'data_verificacao', column: 'X', label: 'DATA VERIFICAÇÃO', aliases: ['data_da_verificacao'], fieldType: DATE, block: 'verificacao' },
  { key: 'avaliacao_controle', column: 'Y', label: 'AVALIAÇÃO DO CONTROLE', aliases: [], fieldType: T, block: 'verificacao' },

  { key: 'probabilidade', column: 'Z', label: 'PROBABILIDADE', aliases: [], fieldType: T, block: 'calculo_risco' },
  { key: 'valor_probabilidade', column: 'AA', label: 'VALOR PROR', aliases: ['valor_prob', 'valor_probabilidade'], fieldType: NUM, block: 'calculo_risco' },
  { key: 'severidade', column: 'AB', label: 'SEVERIDADE', aliases: [], fieldType: T, block: 'calculo_risco' },
  { key: 'valor_severidade', column: 'AC', label: 'VALOR SEV', aliases: [], fieldType: NUM, block: 'calculo_risco' },
  { key: 'total_nivel_risco', column: 'AD', label: 'TOTAL NÍVEL DE RISCO', aliases: ['total_nr'], fieldType: NUM, block: 'calculo_risco' },
  { key: 'nivel_risco', column: 'AE', label: 'NÍVEL DE RISCO', aliases: ['nr'], fieldType: T, block: 'calculo_risco' },

  { key: 'acoes', column: 'AF', label: 'AÇÕES', aliases: ['acao', 'acao_corretiva', 'titulo', 'title'], fieldType: T, block: 'plano_acao', role: 'TITLE' },
  { key: 'prioridade', column: 'AG', label: 'PRIORIDADE', aliases: ['priority'], fieldType: SELECT, block: 'plano_acao', role: 'PRIORITY', vocabulary: [...PRIORIDADE_VOCABULARY] },
  { key: 'resp_verificacao', column: 'AH', label: 'RESP PELA VERIFICAÇÃO', aliases: ['responsavel_pela_verificacao'], fieldType: T, block: 'plano_acao' },
  { key: 'gestor', column: 'AI', label: 'GESTOR(A)', aliases: [], fieldType: T, block: 'plano_acao' },
  { key: 'responsavel_solucao', column: 'AJ', label: 'RESPONSÁVEL PELA SOLUÇÃO', aliases: ['responsavel', 'responsible', 'assignee', 'executor'], fieldType: T, block: 'plano_acao', role: 'ASSIGNEE' },

  { key: 'periodicidade_verificacao', column: 'AK', label: 'PERIODICIDADE DE VERIFICAÇÃO', aliases: [], fieldType: T, block: 'prazos_custo' },
  { key: 'data_prox_verificacao', column: 'AL', label: 'DATA PROX VERIFICAÇÃO', aliases: ['data_proxima_verificacao'], fieldType: DATE, block: 'prazos_custo' },
  { key: 'prazo', column: 'AM', label: 'PRAZO (AÇÕES DE MELHORIA OU IMPLEMENTAÇÃO)', aliases: ['data_fim', 'data_limite', 'vencimento', 'deadline', 'due_date'], fieldType: DATE, block: 'prazos_custo', role: 'DUE_DATE' },
  { key: 'data_conclusao', column: 'AN', label: 'DATA CONCLUSÃO', aliases: ['data_de_conclusao', 'concluido_em'], fieldType: DATE, block: 'prazos_custo', role: 'COMPLETED_AT' },
  { key: 'valor_rs', column: 'AO', label: 'VALOR R$', aliases: ['valor', 'custo'], fieldType: MONEY, block: 'prazos_custo' },

  { key: 'status_atual', column: 'AP', label: 'STATUS ATUAL', aliases: ['status', 'situacao'], fieldType: SELECT, block: 'status', role: 'STATUS', vocabulary: [...STATUS_ATUAL_VOCABULARY], systemManaged: true },
  { key: 'status_final', column: 'AQ', label: 'STATUS FINAL', aliases: [], fieldType: SELECT, block: 'status', role: 'STATUS_FINAL', vocabulary: [...STATUS_FINAL_VOCABULARY], systemManaged: true },
  { key: 'fase_acao', column: 'AR', label: 'FASE DA AÇÃO', aliases: ['fase'], fieldType: T, block: 'status' },

  { key: 'evidencia', column: 'AS', label: 'EVIDÊNCIA', aliases: ['evidencias'], fieldType: T, block: 'evidencia_validacao', role: 'EVIDENCE' },
  { key: 'valido', column: 'AT', label: 'VÁLIDO?', aliases: [], fieldType: T, block: 'evidencia_validacao' },
  { key: 'validado_por', column: 'AU', label: 'VALIDADO POR', aliases: [], fieldType: T, block: 'evidencia_validacao' },
  { key: 'comentarios', column: 'AV', label: 'COMENTÁRIOS', aliases: ['observacoes'], fieldType: LONG, block: 'evidencia_validacao' },

  { key: 'supervisor', column: 'AW', label: 'SUPERVISOR', aliases: [], fieldType: T, block: 'equipe_campo' },
  { key: 'encarregado_lider', column: 'AX', label: 'ENCARREGADO / LÍDER', aliases: ['encarregado', 'lider'], fieldType: T, block: 'equipe_campo' },
  { key: 'turma', column: 'AY', label: 'TURMA', aliases: [], fieldType: T, block: 'equipe_campo' },
  { key: 'turno', column: 'AZ', label: 'TURNO', aliases: [], fieldType: T, block: 'equipe_campo' },
  { key: 'sugestao_correcao', column: 'BA', label: 'SUGESTÃO PARA CORREÇÃO', aliases: [], fieldType: LONG, block: 'equipe_campo' },

  { key: 'nova_probabilidade', column: 'BB', label: 'NOVA PROBABILIDADE', aliases: [], fieldType: T, block: 'reavaliacao' },
  { key: 'nova_severidade', column: 'BC', label: 'NOVA SEVERIDADE', aliases: [], fieldType: T, block: 'reavaliacao' },
  { key: 'novo_nr', column: 'BD', label: 'NOVO NR', aliases: ['novo_nivel_de_risco'], fieldType: NUM, block: 'reavaliacao' },
];

export function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

const LOOKUP: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  const register = (token: string, key: string) => {
    const normalized = normalizeHeader(token);
    if (normalized && !map.has(normalized)) map.set(normalized, key);
  };
  for (const col of CANONICAL_COLUMNS) register(col.key, col.key);
  for (const col of CANONICAL_COLUMNS) register(col.label, col.key);
  for (const col of CANONICAL_COLUMNS) {
    for (const alias of col.aliases) register(alias, col.key);
  }
  return map;
})();

export function matchCanonical(header: string): string | null {
  return LOOKUP.get(normalizeHeader(header)) ?? null;
}

const BY_KEY: ReadonlyMap<string, CanonicalColumn> = new Map(
  CANONICAL_COLUMNS.map((col) => [col.key, col]),
);

export function canonicalByKey(key: string): CanonicalColumn | undefined {
  return BY_KEY.get(key);
}

export function canonicalByRole(role: CanonicalRole): CanonicalColumn | undefined {
  return CANONICAL_COLUMNS.find((col) => col.role === role);
}
