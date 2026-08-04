import { Request, Response, NextFunction } from 'express';
import { container } from 'tsyringe';
import { RisksService } from './risks.service';

export class RisksController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(RisksService);
      const data = await service.list(req.user!, req.query as never);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(RisksService);
      const data = await service.getById(req.user!, req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(RisksService);
      const data = await service.create(req.user!, req.body);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(RisksService);
      const data = await service.update(req.user!, req.params.id, req.body);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(RisksService);
      const data = await service.remove(req.user!, req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async stats(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(RisksService);
      const data = await service.stats(req.user!);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async matrix(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(RisksService);
      const data = await service.matrix(req.user!);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async listControls(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(RisksService);
      const data = await service.listControls(req.user!, req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async createControl(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(RisksService);
      const data = await service.createControl(req.user!, req.params.id, req.body);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async updateControl(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(RisksService);
      const data = await service.updateControl(
        req.user!,
        req.params.id,
        req.params.controlId,
        req.body,
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async removeControl(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(RisksService);
      const data = await service.removeControl(
        req.user!,
        req.params.id,
        req.params.controlId,
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
}
