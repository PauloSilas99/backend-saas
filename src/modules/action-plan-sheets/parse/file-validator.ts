import fs from 'fs';
import path from 'path';
import fileType from 'file-type';
import yauzl from 'yauzl';
import { ValidationError } from '@shared/errors/AppError';
import {
  FILE_TYPE_SAMPLE_BYTES,
  MAX_XLSX_DATA_ENTRY_BYTES,
  MAX_XLSX_ZIP_RATIO,
} from './constants';

const ALLOWED_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
]);

const ALLOWED_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv']);

const MIME_BY_EXTENSION: Record<string, string[]> = {
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip'],
  '.xls': ['application/vnd.ms-excel', 'application/x-cfb'],
  '.csv': ['text/csv', 'text/plain', 'application/csv'],
};

export function assertAllowedUploadMime(mimetype: string): void {
  if (!ALLOWED_MIME_TYPES.has(mimetype)) {
    throw new ValidationError('Formato inválido. Envie xlsx, xls ou csv.');
  }
}

export function assertAllowedExtension(filename: string): void {
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new ValidationError('Extensão inválida. Use .xlsx, .xls ou .csv.');
  }
}

export async function assertRealFileType(filePath: string, originalName: string): Promise<string> {
  const buffer = fs.readFileSync(filePath).subarray(0, FILE_TYPE_SAMPLE_BYTES);
  const detected = await fileType.fromBuffer(buffer);
  const ext = path.extname(originalName).toLowerCase();

  if (!detected) {
    if (ext === '.csv') {
      return 'text/csv';
    }
    throw new ValidationError('Não foi possível identificar o tipo real do arquivo.');
  }

  const allowedForExt = MIME_BY_EXTENSION[ext] ?? [];
  const isAllowed =
    ALLOWED_MIME_TYPES.has(detected.mime) ||
    allowedForExt.includes(detected.mime) ||
    (ext === '.xlsx' && detected.mime === 'application/zip');

  if (!isAllowed) {
    throw new ValidationError(
      `Tipo de arquivo real não permitido (${detected.mime}). Envie xlsx, xls ou csv.`,
    );
  }

  if (ext === '.xlsx' || detected.mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    await assertXlsxNotZipBomb(filePath);
  }

  return detected.mime;
}

function isXlsxDataEntry(name: string): boolean {
  const normalized = name.replace(/\\/g, '/');
  if (/xl\/sharedStrings\.xml$/i.test(normalized)) return true;
  if (/xl\/worksheets\/_rels\//i.test(normalized)) return false;
  return /xl\/worksheets\/[^/]+\.xml$/i.test(normalized);
}

function isZipBombEntry(entry: yauzl.Entry): boolean {
  const compressed = Math.max(entry.compressedSize || 1, 1);
  const uncompressed = entry.uncompressedSize || 0;
  if (uncompressed <= 0) return false;
  const ratio = uncompressed / compressed;
  if (uncompressed > MAX_XLSX_DATA_ENTRY_BYTES && ratio > MAX_XLSX_ZIP_RATIO) return true;
  if (uncompressed > 512 * 1024 * 1024) return true;
  return false;
}

/**
 * Não soma o zip inteiro (estilos/imagens incham o Excel).
 * Só recusa bomb em entradas de dados que de fato serão lidas.
 */
function assertXlsxNotZipBomb(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (openError, zipfile) => {
      if (openError || !zipfile) {
        reject(new ValidationError('Arquivo xlsx inválido ou corrompido.'));
        return;
      }

      zipfile.on('entry', (entry) => {
        if (isXlsxDataEntry(entry.fileName) && isZipBombEntry(entry)) {
          zipfile.close();
          reject(new ValidationError('Arquivo xlsx recusado: compactação anômala na aba de dados.'));
          return;
        }
        zipfile.readEntry();
      });

      zipfile.on('end', () => resolve());
      zipfile.on('error', () => {
        reject(new ValidationError('Arquivo xlsx inválido ou corrompido.'));
      });

      zipfile.readEntry();
    });
  });
}
