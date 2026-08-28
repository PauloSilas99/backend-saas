import path from 'path';
import fileType from 'file-type';
import { ValidationError } from '@shared/errors/AppError';

export const MAX_EVIDENCE_BYTES = 1_500_000;

const SIGNATURELESS_TYPES: Record<string, string> = {
  '.txt': 'text/plain',
  '.csv': 'text/csv',
};

const MIME_BY_EXTENSION: Record<string, string[]> = {
  '.pdf': ['application/pdf'],
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.webp': ['image/webp'],
  '.heic': ['image/heic'],
  '.doc': ['application/msword', 'application/x-cfb'],
  '.docx': [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/zip',
  ],
  '.xls': ['application/vnd.ms-excel', 'application/x-cfb'],
  '.xlsx': [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip',
  ],
};

export async function assertEvidenceFile(input: {
  buffer: Buffer;
  fileName: string;
  size: number;
}): Promise<string> {
  if (input.size <= 0) {
    throw new ValidationError('Arquivo vazio.');
  }
  if (input.size > MAX_EVIDENCE_BYTES) {
    throw new ValidationError('Arquivo muito grande. O limite é 1,5 MB.');
  }

  const extension = path.extname(input.fileName).toLowerCase();
  const signatureless = SIGNATURELESS_TYPES[extension];
  const expected = MIME_BY_EXTENSION[extension];

  if (!signatureless && !expected) {
    throw new ValidationError(
      'Extensão não aceita. Envie imagem, PDF, documento do Office ou texto.',
    );
  }

  if (signatureless) return signatureless;

  const detected = await fileType.fromBuffer(input.buffer);
  if (!detected || !expected.includes(detected.mime)) {
    throw new ValidationError(
      `O tipo real do arquivo não confere com a extensão ${extension}.`,
    );
  }
  return expected[0];
}
