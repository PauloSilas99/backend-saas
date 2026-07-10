import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate } from '@middlewares/authenticate';
import { roleGuard } from '@middlewares/roleGuard';
import { validate } from '@middlewares/validate';
import { BillingController } from './billing.controller';
import { checkoutSchema, portalSchema } from './billing.schemas';

const controller = new BillingController();
const router = Router();

router.get('/plans', (req, res, next) => controller.plans(req, res, next));

router.post('/webhook', (req, res, next) => controller.webhook(req, res, next));

router.use(authenticate);

router.get('/subscription', (req, res, next) => controller.subscription(req, res, next));

router.post(
  '/checkout',
  roleGuard(Role.ADMIN, Role.GESTOR),
  validate({ body: checkoutSchema }),
  (req, res, next) => controller.checkout(req, res, next),
);

router.post(
  '/portal',
  roleGuard(Role.ADMIN, Role.GESTOR),
  validate({ body: portalSchema }),
  (req, res, next) => controller.portal(req, res, next),
);

export default router;
