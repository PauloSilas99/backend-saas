import { Request, Response, NextFunction } from 'express';
import { container } from 'tsyringe';
import { ActionPlansService } from './action-plans.service';

export class ActionPlansController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(ActionPlansService);
      const data = await service.list(req.user!);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(ActionPlansService);
      const data = await service.getById(req.user!, req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(ActionPlansService);
      const data = await service.create(req.user!, req.body);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async addRow(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(ActionPlansService);
      const data = await service.addRow(req.user!, req.params.id, req.body);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async updateRow(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(ActionPlansService);
      const data = await service.updateRow(req.user!, req.params.rowId, req.body);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
}
