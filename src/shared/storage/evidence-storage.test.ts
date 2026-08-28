import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalEvidenceStorage, selectEvidenceStorage } from './evidence-storage';

describe('LocalEvidenceStorage', () => {
  let root: string;
  let storage: LocalEvidenceStorage;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'evid-'));
    storage = new LocalEvidenceStorage(root);
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const upload = () =>
    storage.upload({
      buffer: Buffer.from('conteudo do laudo'),
      fileName: 'laudo.pdf',
      mimeType: 'application/pdf',
      tenantId: 'tenant-1',
      planId: 'plan-1',
    });

  it('devolve o conteúdo gravado', async () => {
    const { publicId } = await upload();
    const result = await storage.download(publicId);
    expect('body' in result && result.body.toString()).toBe('conteudo do laudo');
  });

  it('preserva o tipo do arquivo', async () => {
    const { publicId } = await upload();
    const result = await storage.download(publicId);
    expect('mimeType' in result && result.mimeType).toBe('application/pdf');
  });

  it('separa por empresa e plano', async () => {
    const { publicId } = await upload();
    expect(publicId.startsWith('tenant-1/plan-1/')).toBe(true);
  });

  it('não repete identificador entre dois envios do mesmo arquivo', async () => {
    const [a, b] = [await upload(), await upload()];
    expect(a.publicId).not.toBe(b.publicId);
  });

  it('remove o arquivo', async () => {
    const { publicId } = await upload();
    await storage.destroy(publicId);
    await expect(storage.download(publicId)).rejects.toThrow();
  });

  it('recusa identificador que tenta sair da pasta', async () => {
    await expect(storage.download('../../../etc/passwd')).rejects.toThrow();
  });
});

describe('selectEvidenceStorage', () => {
  it('usa Cloudinary quando as três credenciais existem', () => {
    expect(
      selectEvidenceStorage({
        CLOUDINARY_CLOUD_NAME: 'demo',
        CLOUDINARY_API_KEY: 'k',
        CLOUDINARY_API_SECRET: 's',
        UPLOAD_DIR: 'uploads',
      }).name,
    ).toBe('cloudinary');
  });

  it('cai para disco quando falta credencial', () => {
    expect(
      selectEvidenceStorage({ CLOUDINARY_CLOUD_NAME: 'demo', UPLOAD_DIR: 'uploads' }).name,
    ).toBe('local');
  });
});
