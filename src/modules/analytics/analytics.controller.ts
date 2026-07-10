import { Request, Response, NextFunction } from 'express';
import { container } from 'tsyringe';
import { AnalyticsService } from './analytics.service';

export class AnalyticsController {
  async kpis(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(AnalyticsService);
      const data = await service.kpis(req.user!, req.query as never);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async monthly(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(AnalyticsService);
      const data = await service.monthly(req.user!, req.query as never);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async byUnit(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(AnalyticsService);
      const data = await service.byUnit(req.user!, req.query as never);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async byResponsible(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(AnalyticsService);
      const data = await service.byResponsible(req.user!, req.query as never);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async adherence(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(AnalyticsService);
      const data = await service.adherence(req.user!, req.query as never);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
}
