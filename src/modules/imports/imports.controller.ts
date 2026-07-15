import { Request, Response, NextFunction } from 'express';
import { container } from 'tsyringe';
import { ValidationError } from '@shared/errors/AppError';
import { ImportsService } from './imports.service';

export class ImportsController {
  async upload(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.file) {
        throw new ValidationError('Arquivo obrigatório');
      }
      const service = container.resolve(ImportsService);
      const data = await service.upload(req.user!, req.file);
      res.status(202).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(ImportsService);
      const data = await service.list(req.user!, req.query as never);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(ImportsService);
      const data = await service.getById(req.user!, req.params.jobId);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async getColumns(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(ImportsService);
      const data = await service.getColumns(req.user!, req.params.jobId);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async saveMapping(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(ImportsService);
      const data = await service.saveMapping(req.user!, req.params.jobId, req.body);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async preview(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(ImportsService);
      const data = await service.getPreview(req.user!, req.params.jobId, req.query as never);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async confirm(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(ImportsService);
      const data = await service.confirm(req.user!, req.params.jobId, req.body);
      res.status(202).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async legacyConfirm(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(ImportsService);
      const { importId, ...input } = req.body;
      const data = await service.confirm(req.user!, importId, input);
      res.status(202).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async status(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(ImportsService);
      const id = req.params.jobId ?? req.params.id;
      const data = await service.getStatus(req.user!, id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
}
