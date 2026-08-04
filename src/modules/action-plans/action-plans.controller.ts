import { Request, Response, NextFunction } from 'express';
import { container } from 'tsyringe';
import { ActionPlansService } from './action-plans.service';

export class ActionPlansController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(ActionPlansService);
      const data = await service.listPlans(req.user!);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async listActions(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(ActionPlansService);
      const data = await service.listActions(req.user!, req.query as never);
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

  async getRow(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(ActionPlansService);
      const data = await service.getRow(req.user!, req.params.rowId);
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

  async requestCompletion(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(ActionPlansService);
      const data = await service.requestCompletion(req.user!, req.params.rowId, req.body);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async approve(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(ActionPlansService);
      const data = await service.approve(req.user!, req.params.rowId, req.body);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async reject(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(ActionPlansService);
      const data = await service.reject(req.user!, req.params.rowId, req.body);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async resolve(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(ActionPlansService);
      const data = await service.resolve(req.user!, req.params.rowId, req.body);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async duplicate(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(ActionPlansService);
      const data = await service.duplicate(req.user!, req.params.rowId);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(ActionPlansService);
      const data = await service.remove(req.user!, req.params.rowId);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async calendar(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(ActionPlansService);
      const from = String(req.query.from);
      const to = String(req.query.to);
      const data = await service.calendar(req.user!, from, to);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
}
