import { inject, injectable } from 'tsyringe';
import { EvidenceKind } from '@prisma/client';
import { env } from '@config/env';
import { ForbiddenError, NotFoundError } from '@shared/errors/AppError';
import { isOperacional, isPlatformAdmin } from '@shared/helpers/rbac';
import { AuthUser } from '@/types/auth';
import { ActionPlansRepository } from '@modules/action-plans/action-plans.repository';
import { EvidenceStorage, selectEvidenceStorage } from '@shared/storage/evidence-storage';
import { assertEvidenceFile } from './evidence-file';
import { EvidencesRepository } from './evidences.repository';

@injectable()
export class EvidencesService {
  private readonly storage: EvidenceStorage = selectEvidenceStorage(env);

  constructor(
    @inject(EvidencesRepository) private readonly evidencesRepo: EvidencesRepository,
    @inject(ActionPlansRepository) private readonly plansRepo: ActionPlansRepository,
  ) {}

  get storageName(): string {
    return this.storage.name;
  }

  private async assertRowAccess(actor: AuthUser, sheetId: string, rowId: string) {
    if (isPlatformAdmin(actor)) throw new ForbiddenError();
    const row = await this.plansRepo.findRow(rowId, actor.tenantId);
    if (!row || row.actionPlanId !== sheetId) throw new NotFoundError('Ação não encontrada');
    if (isOperacional(actor) && row.responsibleId !== actor.id) throw new ForbiddenError();
    return row;
  }

  async attachFile(
    actor: AuthUser,
    sheetId: string,
    rowId: string,
    file: { buffer: Buffer; originalname: string; size: number },
  ) {
    await this.assertRowAccess(actor, sheetId, rowId);
    const mimeType = await assertEvidenceFile({
      buffer: file.buffer,
      fileName: file.originalname,
      size: file.size,
    });

    const { publicId } = await this.storage.upload({
      buffer: file.buffer,
      fileName: file.originalname,
      mimeType,
      tenantId: actor.tenantId,
      planId: sheetId,
    });

    const evidence = await this.evidencesRepo.create({
      tenantId: actor.tenantId,
      actionRowId: rowId,
      kind: EvidenceKind.ARQUIVO,
      publicId,
      fileName: file.originalname,
      mimeType,
      sizeBytes: file.size,
      createdById: actor.id,
    });

    return this.toDto(evidence);
  }

  async attachValue(
    actor: AuthUser,
    sheetId: string,
    rowId: string,
    input: { kind: 'LINK' | 'TEXTO'; value: string },
  ) {
    await this.assertRowAccess(actor, sheetId, rowId);
    const evidence = await this.evidencesRepo.create({
      tenantId: actor.tenantId,
      actionRowId: rowId,
      kind: input.kind === 'LINK' ? EvidenceKind.LINK : EvidenceKind.TEXTO,
      value: input.value,
      createdById: actor.id,
    });
    return this.toDto(evidence);
  }

  async list(actor: AuthUser, sheetId: string, rowId: string) {
    await this.assertRowAccess(actor, sheetId, rowId);
    return this.evidencesRepo.listByRow(rowId, actor.tenantId);
  }

  async download(actor: AuthUser, sheetId: string, rowId: string, evidenceId: string) {
    await this.assertRowAccess(actor, sheetId, rowId);
    const evidence = await this.evidencesRepo.findById(evidenceId, actor.tenantId);
    if (!evidence || evidence.actionRowId !== rowId) {
      throw new NotFoundError('Evidência não encontrada');
    }
    if (evidence.kind !== EvidenceKind.ARQUIVO || !evidence.publicId) {
      throw new NotFoundError('Esta evidência não é um arquivo');
    }
    return {
      fileName: evidence.fileName ?? 'evidencia',
      result: await this.storage.download(evidence.publicId),
    };
  }

  async remove(actor: AuthUser, sheetId: string, rowId: string, evidenceId: string) {
    await this.assertRowAccess(actor, sheetId, rowId);
    const evidence = await this.evidencesRepo.findById(evidenceId, actor.tenantId);
    if (!evidence || evidence.actionRowId !== rowId) {
      throw new NotFoundError('Evidência não encontrada');
    }
    if (evidence.publicId) await this.storage.destroy(evidence.publicId);
    await this.evidencesRepo.remove(evidenceId);
    return { removed: true };
  }

  private toDto(evidence: {
    id: string;
    kind: EvidenceKind;
    value: string | null;
    fileName: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
    createdAt: Date;
  }) {
    return {
      id: evidence.id,
      kind: evidence.kind,
      value: evidence.value,
      fileName: evidence.fileName,
      mimeType: evidence.mimeType,
      sizeBytes: evidence.sizeBytes,
      createdAt: evidence.createdAt,
    };
  }
}
