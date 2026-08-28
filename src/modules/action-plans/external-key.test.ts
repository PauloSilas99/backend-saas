import { describe, expect, it } from 'vitest';
import { createExternalKeyAllocator } from './external-key';

describe('createExternalKeyAllocator', () => {
  it('começa em A-0001 num plano vazio', () => {
    expect(createExternalKeyAllocator([])()).toBe('A-0001');
  });

  it('continua a partir da maior existente', () => {
    expect(createExternalKeyAllocator(['A-0001', 'A-0002'])()).toBe('A-0003');
  });

  it('usa a maior, não a contagem — senão colidiria após exclusões', () => {
    expect(createExternalKeyAllocator(['A-0010'])()).toBe('A-0011');
  });

  it('incrementa a cada chamada', () => {
    const next = createExternalKeyAllocator([]);
    expect([next(), next(), next()]).toEqual(['A-0001', 'A-0002', 'A-0003']);
  });

  it('ignora chave própria do cliente, que não segue o padrão', () => {
    expect(createExternalKeyAllocator(['OS-2024-77', 'A-0005'])()).toBe('A-0006');
  });

  it('não quebra com lista só de chaves fora do padrão', () => {
    expect(createExternalKeyAllocator(['abc', ''])()).toBe('A-0001');
  });

  it('passa de quatro dígitos sem truncar', () => {
    expect(createExternalKeyAllocator(['A-9999'])()).toBe('A-10000');
  });
});
