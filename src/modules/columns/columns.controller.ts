import { Request, Response, NextFunction } from 'express';
import { container } from 'tsyringe';
import { ColumnsService } from './columns.service';

export class ColumnsController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(ColumnsService);
      const includeDeleted = req.query.includeDeleted === 'true';
      const data = await service.list(req.user!, includeDeleted);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(ColumnsService);
      const data = await service.create(req.user!, req.body);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(ColumnsService);
      const data = await service.update(req.user!, req.params.id, req.body);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(ColumnsService);
      const data = await service.remove(req.user!, req.params.id, req.body ?? {});
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async history(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(ColumnsService);
      const data = await service.history(req.user!, req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
}
