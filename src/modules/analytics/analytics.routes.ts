import { Router } from 'express';
import { authenticate } from '@middlewares/authenticate';
import { subscriptionGate } from '@middlewares/subscriptionGate';
import { validate } from '@middlewares/validate';
import { AnalyticsController } from './analytics.controller';
import { analyticsFilterSchema } from './analytics.schemas';

const controller = new AnalyticsController();
const router = Router();

router.use(authenticate, subscriptionGate);

router.get('/kpis', validate({ query: analyticsFilterSchema }), (req, res, next) =>
  controller.kpis(req, res, next),
);

router.get('/monthly', validate({ query: analyticsFilterSchema }), (req, res, next) =>
  controller.monthly(req, res, next),
);

router.get('/by-unit', validate({ query: analyticsFilterSchema }), (req, res, next) =>
  controller.byUnit(req, res, next),
);

router.get('/by-responsible', validate({ query: analyticsFilterSchema }), (req, res, next) =>
  controller.byResponsible(req, res, next),
);

router.get('/adherence', validate({ query: analyticsFilterSchema }), (req, res, next) =>
  controller.adherence(req, res, next),
);

export default router;
