import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImportRowStatus, ImportStatus, Role } from '@prisma/client';
import { ValidationError, NotFoundError } from '@shared/errors/AppError';
import { AuthUser } from '@/types/auth';
import {
  assertAllowedUploadMime,
  assertRealFileType,
} from './imports.file-validator';
import { suggestColumnMapping, validateMappingCompleteness } from './imports.mapping';
import { parseSpreadsheetFile } from './imports.parser';
import { validateMappedRow } from './imports.validator';
import { ImportsService } from './imports.service';
import { ImportsRepository } from './imports.repository';
import { AuditService } from '@shared/audit/audit.service';

vi.mock('./imports.queue', () => ({
  enqueueParseJob: vi.fn(),
  enqueueValidateJob: vi.fn(),
  enqueueCommitJob: vi.fn(),
}));

const tempFiles: string[] = [];

function writeTempFile(name: string, content: Buffer | string): string {
  const filePath = path.join(os.tmpdir(), `import-test-${Date.now()}-${name}`);
  fs.writeFileSync(filePath, content);
  tempFiles.push(filePath);
  return filePath;
}

afterEach(() => {
  for (const file of tempFiles.splice(0)) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

describe('imports.file-validator', () => {
  it('rejeita mimetype forjado quando magic bytes não correspondem', async () => {
    const filePath = writeTempFile('fake.xlsx', Buffer.from('not-a-real-xlsx-file-content'));

    await expect(assertRealFileType(filePath, 'planilha.xlsx')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('aceita csv com conteúdo textual válido', async () => {
    const filePath = writeTempFile(
      'valid.csv',
      'titulo,status,prioridade,responsavel,unidade\nA,pendente,alta,Joao,Matriz\n',
    );

    const mime = await assertRealFileType(filePath, 'valid.csv');
    expect(mime).toBe('text/csv');
  });

  it('rejeita mimetype não permitido no fileFilter', () => {
    expect(() => assertAllowedUploadMime('application/pdf')).toThrow(ValidationError);
  });
});

describe('imports.parser', () => {
  it('falha com planilha corrompida', async () => {
    const filePath = writeTempFile('broken.xlsx', Buffer.from('PK\x03\x04corrupted'));

    await expect(parseSpreadsheetFile(filePath)).rejects.toBeInstanceOf(ValidationError);
  });

  it('faz parse de csv válido com cabeçalho e dados', async () => {
    const filePath = writeTempFile(
      'sample.csv',
      [
        'titulo,status,prioridade,responsavel,unidade,prazo',
        'Ação 1,pendente,alta,João,Matriz,2026-08-01',
      ].join('\n'),
    );

    const parsed = await parseSpreadsheetFile(filePath);
    expect(parsed.headers).toContain('titulo');
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].rawData.titulo).toBe('Ação 1');
  });
});

describe('imports.mapping', () => {
  it('exige campos obrigatórios no mapeamento', () => {
    const headers = ['titulo', 'status'];
    const suggested = suggestColumnMapping(headers);
    const missing = validateMappingCompleteness(suggested);

    expect(missing).toContain('priority');
    expect(missing).toContain('responsibleName');
    expect(missing).toContain('unitName');
  });

  it('sugere mapeamento automático para cabeçalhos conhecidos', () => {
    const headers = [
      'titulo',
      'status',
      'prioridade',
      'responsavel',
      'unidade',
      'prazo',
      'descricao',
      'chave',
    ];
    const mapping = suggestColumnMapping(headers);

    expect(mapping.titulo).toBe('title');
    expect(mapping.status).toBe('status');
    expect(mapping.prioridade).toBe('priority');
    expect(validateMappingCompleteness(mapping)).toHaveLength(0);
  });
});

describe('imports.validator', () => {
  it('marca linha inválida como ERROR no preview', () => {
    const mapping = {
      titulo: 'title',
      status: 'status',
      prioridade: 'priority',
      responsavel: 'responsibleName',
      unidade: 'unitName',
    };

    const result = validateMappedRow(
      2,
      {
        titulo: '',
        status: 'invalido',
        prioridade: 'alta',
        responsavel: 'João',
        unidade: 'Matriz',
      },
      mapping,
      { existingExternalKeys: new Set(), existingTitles: new Set() },
      new Map(),
    );

    expect(result.status).toBe(ImportRowStatus.ERROR);
    expect(result.messages.some((m) => m.includes('Título obrigatório'))).toBe(true);
    expect(result.messages.some((m) => m.includes('Status inválido'))).toBe(true);
  });
});

describe('ImportsService tenant isolation', () => {
  const actor: AuthUser = {
    id: 'user-1',
    email: 'gestor@test.com',
    name: 'Gestor',
    role: Role.GERENTE,
    tenantId: 'tenant-a',
    tokenVersion: 0,
  };

  it('impede acesso a job de outra empresa', async () => {
    const repository = {
      findById: vi.fn().mockResolvedValue(null),
    } as unknown as ImportsRepository;

    const audit = { log: vi.fn() } as unknown as AuditService;
    const service = new ImportsService(repository, audit);

    await expect(service.getById(actor, 'job-outra-empresa')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(repository.findById).toHaveBeenCalledWith('job-outra-empresa', 'tenant-a');
  });

  it('bloqueia confirmação quando job não pertence ao tenant', async () => {
    const repository = {
      findById: vi.fn().mockResolvedValue(null),
    } as unknown as ImportsRepository;

    const audit = { log: vi.fn() } as unknown as AuditService;
    const service = new ImportsService(repository, audit);

    await expect(service.confirm(actor, 'job-x', {})).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejeita mapeamento sem campos obrigatórios', async () => {
    const repository = {
      findById: vi.fn().mockResolvedValue({
        id: 'job-1',
        tenantId: 'tenant-a',
        createdById: 'user-1',
        status: ImportStatus.READY_FOR_MAPPING,
        headers: ['titulo'],
      }),
      saveMapping: vi.fn(),
      update: vi.fn(),
    } as unknown as ImportsRepository;

    const audit = { log: vi.fn() } as unknown as AuditService;
    const service = new ImportsService(repository, audit);

    await expect(
      service.saveMapping(actor, 'job-1', { mapping: { titulo: 'title' } }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
