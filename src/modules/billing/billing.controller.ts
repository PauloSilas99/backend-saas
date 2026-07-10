import { Request, Response, NextFunction } from 'express';
import { container } from 'tsyringe';
import { BillingService } from './billing.service';

export class BillingController {
  async plans(_req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(BillingService);
      const data = await service.listPlans();
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async subscription(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(BillingService);
      const data = await service.getSubscription(req.user!.tenantId);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async checkout(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(BillingService);
      const data = await service.checkout(req.user!, req.body);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async portal(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(BillingService);
      const data = await service.portal(req.user!, req.body);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async webhook(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(BillingService);
      const signature = req.headers['stripe-signature'] as string | undefined;
      const data = await service.handleWebhook(req.body, signature);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
}
