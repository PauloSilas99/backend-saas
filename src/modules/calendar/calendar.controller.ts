import { Request, Response, NextFunction } from 'express';
import { container } from 'tsyringe';
import { CalendarService } from './calendar.service';

export class CalendarController {
  async agenda(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(CalendarService);
      const data = await service.getAgenda(req.user!, req.query as never);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async listActivities(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(CalendarService);
      const data = await service.listActivities(req.user!, req.query as never);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async getActivity(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(CalendarService);
      const data = await service.getActivity(req.user!, req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async createActivity(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(CalendarService);
      const data = await service.createActivity(req.user!, req.body);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async updateActivity(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(CalendarService);
      const data = await service.updateActivity(req.user!, req.params.id, req.body);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async removeActivity(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(CalendarService);
      const data = await service.removeActivity(req.user!, req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async listOverrides(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(CalendarService);
      const data = await service.listOverrides(
        req.user!,
        req.query.from as string | undefined,
        req.query.to as string | undefined,
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async putOverrides(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(CalendarService);
      const data = await service.putOverrides(req.user!, req.body);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async upsertOverride(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(CalendarService);
      const data = await service.upsertOverride(req.user!, req.body);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async removeOverride(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(CalendarService);
      const data = await service.removeOverride(req.user!, req.params.date);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async upsertActionOverlay(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(CalendarService);
      const data = await service.upsertActionOverlay(
        req.user!,
        req.params.actionRowId,
        req.body,
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async removeActionOverlay(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(CalendarService);
      const data = await service.removeActionOverlay(req.user!, req.params.actionRowId);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
}
