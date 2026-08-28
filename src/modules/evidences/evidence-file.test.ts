import { describe, expect, it } from 'vitest';
import { MAX_EVIDENCE_BYTES, assertEvidenceFile } from './evidence-file';

const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(600, 0x20)]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(600).fill(0)]);
const exe = Buffer.from([0x4d, 0x5a, ...Array(600).fill(0)]);

describe('assertEvidenceFile', () => {
  it('aceita PDF', async () => {
    await expect(
      assertEvidenceFile({ buffer: pdf, fileName: 'laudo.pdf', size: pdf.length }),
    ).resolves.toBe('application/pdf');
  });

  it('aceita imagem', async () => {
    await expect(
      assertEvidenceFile({ buffer: png, fileName: 'foto.png', size: png.length }),
    ).resolves.toBe('image/png');
  });

  it('recusa executável renomeado para .pdf', async () => {
    await expect(
      assertEvidenceFile({ buffer: exe, fileName: 'virus.pdf', size: exe.length }),
    ).rejects.toThrow(/tipo/i);
  });

  it('recusa arquivo acima do limite', async () => {
    await expect(
      assertEvidenceFile({ buffer: pdf, fileName: 'laudo.pdf', size: MAX_EVIDENCE_BYTES + 1 }),
    ).rejects.toThrow(/1,5 MB/);
  });

  it('recusa arquivo vazio', async () => {
    await expect(
      assertEvidenceFile({ buffer: Buffer.alloc(0), fileName: 'vazio.pdf', size: 0 }),
    ).rejects.toThrow();
  });

  it('aceita texto puro, que não tem assinatura binária', async () => {
    const txt = Buffer.from('anotacoes da inspecao');
    await expect(
      assertEvidenceFile({ buffer: txt, fileName: 'nota.txt', size: txt.length }),
    ).resolves.toBe('text/plain');
  });

  it('recusa extensão fora da lista', async () => {
    await expect(
      assertEvidenceFile({ buffer: pdf, fileName: 'script.sh', size: pdf.length }),
    ).rejects.toThrow(/extens/i);
  });
});
