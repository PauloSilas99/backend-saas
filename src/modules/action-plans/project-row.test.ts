import { ActionPriority, ActionStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { projectRow } from './project-row';

function build(values: Record<string, string>) {
  const columns = Object.keys(values).map((key, i) => ({
    id: `col-${i}`,
    canonicalKey: key,
  }));
  const cells = Object.fromEntries(
    columns.map((col) => [col.id, values[col.canonicalKey]]),
  );
  return { cells, columns };
}

const NOW = new Date('2026-08-28T12:00:00Z');

describe('projectRow — origem dos campos', () => {
  it('tira o título de AÇÕES (AF), não de AÇÕES / MEDIDA(S) DE CONTROLE (S)', () => {
    const result = projectRow({
      ...build({
        medidas_controle: 'Guarda-corpo instalado',
        acoes: 'Substituir guarda-corpo corroído',
      }),
      now: NOW,
    });
    expect(result.title).toBe('Substituir guarda-corpo corroído');
  });

  it('tira o responsável de RESPONSÁVEL PELA SOLUÇÃO (AJ), não de AH nem AI', () => {
    const result = projectRow({
      ...build({
        resp_verificacao: 'Carlos',
        gestor: 'Marina',
        responsavel_solucao: 'Ana',
      }),
      now: NOW,
    });
    expect(result.responsibleName).toBe('Ana');
  });

  it('tira a unidade de UNIDADE (F)', () => {
    const result = projectRow({ ...build({ unidade: 'Filial Norte' }), now: NOW });
    expect(result.unitName).toBe('Filial Norte');
  });
});

describe('projectRow — regra de status_atual', () => {
  it('respeita cancelado digitado, mesmo com prazo vencido', () => {
    const result = projectRow({
      ...build({ status_atual: 'cancelado', prazo: '2020-01-01' }),
      now: NOW,
    });
    expect(result.statusAtual).toBe('cancelado');
  });

  it('marca concluído quando há data de conclusão, ignorando o que veio digitado', () => {
    const result = projectRow({
      ...build({ status_atual: 'em atraso', data_conclusao: '2026-08-20', prazo: '2026-08-10' }),
      now: NOW,
    });
    expect(result.statusAtual).toBe('concluído');
  });

  it('marca sem prazo quando AM está vazia', () => {
    const result = projectRow({ ...build({ acoes: 'Fazer algo' }), now: NOW });
    expect(result.statusAtual).toBe('sem prazo');
  });

  it('marca em atraso quando o prazo já passou', () => {
    const result = projectRow({ ...build({ prazo: '2026-08-27' }), now: NOW });
    expect(result.statusAtual).toBe('em atraso');
  });

  it('marca no prazo quando o prazo está no futuro', () => {
    const result = projectRow({ ...build({ prazo: '2026-09-15' }), now: NOW });
    expect(result.statusAtual).toBe('no prazo');
  });

  it('não considera atrasada a ação que vence hoje', () => {
    const result = projectRow({ ...build({ prazo: '2026-08-28' }), now: NOW });
    expect(result.statusAtual).toBe('no prazo');
  });

  it('trata prazo ilegível como sem prazo', () => {
    const result = projectRow({ ...build({ prazo: 'a combinar' }), now: NOW });
    expect(result.statusAtual).toBe('sem prazo');
  });

  it('sobrescreve valor digitado que não seja cancelado', () => {
    const result = projectRow({
      ...build({ status_atual: 'no prazo', prazo: '2020-01-01' }),
      now: NOW,
    });
    expect(result.statusAtual).toBe('em atraso');
  });
});

describe('projectRow — status_final', () => {
  it('marca concluída no prazo quando a conclusão veio antes do prazo', () => {
    const result = projectRow({
      ...build({ prazo: '2026-08-20', data_conclusao: '2026-08-18' }),
      now: NOW,
    });
    expect(result.statusFinal).toBe('concluída no prazo');
  });

  it('marca concluída em atraso quando a conclusão passou do prazo', () => {
    const result = projectRow({
      ...build({ prazo: '2026-08-10', data_conclusao: '2026-08-20' }),
      now: NOW,
    });
    expect(result.statusFinal).toBe('concluída em atraso');
  });

  it('conclusão no dia do prazo conta como no prazo', () => {
    const result = projectRow({
      ...build({ prazo: '2026-08-20', data_conclusao: '2026-08-20' }),
      now: NOW,
    });
    expect(result.statusFinal).toBe('concluída no prazo');
  });

  it('sem prazo não julga pontualidade', () => {
    const result = projectRow({ ...build({ data_conclusao: '2026-08-20' }), now: NOW });
    expect(result.statusFinal).toBe('concluída');
  });

  it('marca cancelada quando a ação foi cancelada', () => {
    const result = projectRow({ ...build({ status_atual: 'cancelado' }), now: NOW });
    expect(result.statusFinal).toBe('cancelada');
  });

  it('deixa status_final nulo enquanto a ação está aberta', () => {
    const result = projectRow({ ...build({ prazo: '2026-09-15' }), now: NOW });
    expect(result.statusFinal).toBeNull();
  });
});

describe('projectRow — projeção para os campos nativos', () => {
  it('mapeia o vocabulário para o enum', () => {
    expect(projectRow({ ...build({ prazo: '2026-09-15' }), now: NOW }).status).toBe(
      ActionStatus.PENDING,
    );
    expect(projectRow({ ...build({ prazo: '2020-01-01' }), now: NOW }).status).toBe(
      ActionStatus.DELAYED,
    );
    expect(
      projectRow({ ...build({ data_conclusao: '2026-08-20' }), now: NOW }).status,
    ).toBe(ActionStatus.COMPLETED);
    expect(projectRow({ ...build({ status_atual: 'cancelado' }), now: NOW }).status).toBe(
      ActionStatus.CANCELED,
    );
  });

  it('não rebaixa uma ação que aguarda aprovação', () => {
    const result = projectRow({
      ...build({ prazo: '2026-09-15' }),
      currentStatus: ActionStatus.WAITING_APPROVAL,
      now: NOW,
    });
    expect(result.status).toBe(ActionStatus.WAITING_APPROVAL);
  });

  it('mas conclui uma ação que aguardava aprovação quando a conclusão é registrada', () => {
    const result = projectRow({
      ...build({ data_conclusao: '2026-08-20' }),
      currentStatus: ActionStatus.WAITING_APPROVAL,
      now: NOW,
    });
    expect(result.status).toBe(ActionStatus.COMPLETED);
  });

  it('converte prazo e data de conclusão em Date', () => {
    const result = projectRow({
      ...build({ prazo: '2026-09-15', data_conclusao: '2026-08-20' }),
      now: NOW,
    });
    expect(result.dueDate?.toISOString().slice(0, 10)).toBe('2026-09-15');
    expect(result.completedAt?.toISOString().slice(0, 10)).toBe('2026-08-20');
  });

  it('mapeia a prioridade do vocabulário', () => {
    expect(projectRow({ ...build({ prioridade: 'crítica' }), now: NOW }).priority).toBe(
      ActionPriority.CRITICAL,
    );
    expect(projectRow({ ...build({ prioridade: 'BAIXA' }), now: NOW }).priority).toBe(
      ActionPriority.LOW,
    );
  });

  it('usa prioridade média quando a coluna está vazia', () => {
    expect(projectRow({ ...build({ acoes: 'x' }), now: NOW }).priority).toBe(
      ActionPriority.MEDIUM,
    );
  });
});

describe('projectRow — colunas fora do catálogo', () => {
  it('ignora coluna sem canonicalKey sem quebrar', () => {
    const result = projectRow({
      cells: { 'col-0': 'Instalar sinalização', 'col-9': 'valor livre' },
      columns: [
        { id: 'col-0', canonicalKey: 'acoes' },
        { id: 'col-9', canonicalKey: null },
      ],
      now: NOW,
    });
    expect(result.title).toBe('Instalar sinalização');
  });
});
