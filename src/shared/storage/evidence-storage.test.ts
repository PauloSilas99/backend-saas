import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CloudinaryEvidenceStorage,
  LocalEvidenceStorage,
  evidenceResourceTypeFor,
  storedResourceType,
  selectEvidenceStorage,
} from './evidence-storage';

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

describe('evidenceResourceTypeFor', () => {
  it('trata imagem como image', () => {
    expect(evidenceResourceTypeFor('image/png')).toBe('image');
    expect(evidenceResourceTypeFor('image/jpeg')).toBe('image');
  });

  it('trata vídeo como video', () => {
    expect(evidenceResourceTypeFor('video/mp4')).toBe('video');
  });

  it('trata todo o resto como raw, que é o que o Cloudinary faz', () => {
    expect(evidenceResourceTypeFor('application/pdf')).toBe('raw');
    expect(evidenceResourceTypeFor('text/plain')).toBe('raw');
    expect(evidenceResourceTypeFor('application/vnd.ms-excel')).toBe('raw');
    expect(evidenceResourceTypeFor(undefined)).toBe('raw');
  });
});

describe('CloudinaryEvidenceStorage — URL assinada', () => {
  const storage = new CloudinaryEvidenceStorage({
    cloudName: 'demo',
    apiKey: '123',
    apiSecret: 'segredo',
  });

  it('aponta para raw quando o arquivo foi guardado como raw', async () => {
    const result = await storage.download('pasta/arquivo.pdf', 'raw');
    expect('redirectTo' in result && result.redirectTo).toContain('/raw/authenticated/');
  });

  it('aponta para image quando o arquivo é imagem', async () => {
    const result = await storage.download('pasta/foto.png', 'image');
    expect('redirectTo' in result && result.redirectTo).toContain('/image/authenticated/');
  });

  it('nunca gera URL de imagem para um PDF', async () => {
    const result = await storage.download('pasta/laudo.pdf', 'raw');
    expect('redirectTo' in result && result.redirectTo).not.toContain('/image/');
  });
});

describe('storedResourceType', () => {
  it('respeita o tipo que o Cloudinary devolveu no upload', () => {
    expect(storedResourceType({ resourceType: 'raw', mimeType: 'image/png' })).toBe('raw');
    expect(storedResourceType({ resourceType: 'image', mimeType: 'image/png' })).toBe('image');
  });

  it('infere pelo mime quando a evidência é anterior ao campo', () => {
    expect(storedResourceType({ resourceType: null, mimeType: 'application/pdf' })).toBe('raw');
    expect(storedResourceType({ resourceType: null, mimeType: 'image/jpeg' })).toBe('image');
  });

  it('cai em raw quando não há informação nenhuma', () => {
    expect(storedResourceType({ resourceType: null, mimeType: null })).toBe('raw');
  });

  it('ignora valor gravado fora do vocabulário do Cloudinary', () => {
    expect(storedResourceType({ resourceType: 'lixo', mimeType: 'image/png' })).toBe('image');
  });
});
