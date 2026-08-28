import { describe, expect, it } from 'vitest';
import { decodeEvidenceRef, encodeEvidenceRef, normalizeEvidenceInput } from './evidence-ref';

describe('encodeEvidenceRef', () => {
  it('codifica link', () => {
    expect(encodeEvidenceRef({ kind: 'LINK', value: 'https://x.com/a?b=1' })).toBe(
      'link:https://x.com/a?b=1',
    );
  });

  it('codifica arquivo pelo id da evidência', () => {
    expect(encodeEvidenceRef({ kind: 'ARQUIVO', evidenceId: 'abc-123' })).toBe('arquivo:abc-123');
  });

  it('resume o texto longo, que a célula da planilha não deve carregar inteiro', () => {
    const encoded = encodeEvidenceRef({ kind: 'TEXTO', value: 'x'.repeat(900) });
    expect(encoded.length).toBeLessThanOrEqual(300);
    expect(encoded.startsWith('texto:')).toBe(true);
  });

  it('mantém texto curto intacto', () => {
    expect(encodeEvidenceRef({ kind: 'TEXTO', value: 'Foto do reparo' })).toBe(
      'texto:Foto do reparo',
    );
  });
});

describe('decodeEvidenceRef', () => {
  it('lê link preservando os dois-pontos da URL', () => {
    expect(decodeEvidenceRef('link:https://x.com/a')).toEqual({
      kind: 'LINK',
      value: 'https://x.com/a',
    });
  });

  it('lê arquivo', () => {
    expect(decodeEvidenceRef('arquivo:abc-123')).toEqual({
      kind: 'ARQUIVO',
      evidenceId: 'abc-123',
    });
  });

  it('lê texto', () => {
    expect(decodeEvidenceRef('texto:Foto do reparo')).toEqual({
      kind: 'TEXTO',
      value: 'Foto do reparo',
    });
  });

  it('devolve null para célula preenchida à mão pelo usuário', () => {
    expect(decodeEvidenceRef('anexei no whatsapp')).toBeNull();
  });

  it('devolve null para célula vazia', () => {
    expect(decodeEvidenceRef('')).toBeNull();
  });

  it('devolve null quando o prefixo vem sem conteúdo', () => {
    expect(decodeEvidenceRef('arquivo:')).toBeNull();
  });
});

describe('normalizeEvidenceInput', () => {
  it('ignora ausência de evidência', () => {
    expect(normalizeEvidenceInput(undefined)).toBeNull();
    expect(normalizeEvidenceInput('   ')).toBeNull();
  });

  it('reconhece link em texto solto', () => {
    expect(normalizeEvidenceInput('https://drive.google.com/x')).toEqual({
      kind: 'LINK',
      value: 'https://drive.google.com/x',
    });
  });

  it('trata texto solto como descrição', () => {
    expect(normalizeEvidenceInput('Foto arquivada na pasta da obra')).toEqual({
      kind: 'TEXTO',
      value: 'Foto arquivada na pasta da obra',
    });
  });

  it('recusa data URL, que é o formato antigo que nunca coube no canal', () => {
    expect(() => normalizeEvidenceInput('data:application/pdf;base64,JVBER')).toThrow(
      /anexe o arquivo/i,
    );
  });

  it('aceita a forma estruturada de arquivo', () => {
    expect(normalizeEvidenceInput({ kind: 'ARQUIVO', evidenceId: 'abc' })).toEqual({
      kind: 'ARQUIVO',
      evidenceId: 'abc',
    });
  });

  it('aceita a forma estruturada de link', () => {
    expect(normalizeEvidenceInput({ kind: 'LINK', value: 'https://x.com' })).toEqual({
      kind: 'LINK',
      value: 'https://x.com',
    });
  });
});
