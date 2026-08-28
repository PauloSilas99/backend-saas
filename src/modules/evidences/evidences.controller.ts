import { NextFunction, Request, Response } from 'express';
import { container } from 'tsyringe';
import { ValidationError } from '@shared/errors/AppError';
import { EvidencesService } from './evidences.service';

export class EvidencesController {
  async attachFile(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.file) throw new ValidationError('Envie um arquivo no campo "file".');
      const service = container.resolve(EvidencesService);
      const data = await service.attachFile(req.user!, req.params.id, req.params.rowId, req.file);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async attachValue(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(EvidencesService);
      const data = await service.attachValue(
        req.user!,
        req.params.id,
        req.params.rowId,
        req.body,
      );
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(EvidencesService);
      const data = await service.list(req.user!, req.params.id, req.params.rowId);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async download(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(EvidencesService);
      const { fileName, result } = await service.download(
        req.user!,
        req.params.id,
        req.params.rowId,
        req.params.evidenceId,
      );
      if ('redirectTo' in result) {
        res.redirect(302, result.redirectTo);
        return;
      }
      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.end(result.body);
    } catch (error) {
      next(error);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(EvidencesService);
      const data = await service.remove(
        req.user!,
        req.params.id,
        req.params.rowId,
        req.params.evidenceId,
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
}
