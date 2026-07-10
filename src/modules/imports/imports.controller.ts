import { Request, Response, NextFunction } from 'express';
import { container } from 'tsyringe';
import { ImportsService } from './imports.service';
import { ValidationError } from '@shared/errors/AppError';

export class ImportsController {
  async upload(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.file) {
        throw new ValidationError('Arquivo obrigatório');
      }
      const service = container.resolve(ImportsService);
      const data = await service.upload(req.user!, req.file);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async confirm(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(ImportsService);
      const data = await service.confirm(req.user!, req.body);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async status(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(ImportsService);
      const data = await service.getStatus(req.user!, req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
}
