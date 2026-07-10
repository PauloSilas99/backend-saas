import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate } from '@middlewares/authenticate';
import { roleGuard } from '@middlewares/roleGuard';
import { subscriptionGate } from '@middlewares/subscriptionGate';
import { validate } from '@middlewares/validate';
import { ActionPlansController } from './action-plans.controller';
import {
  createActionPlanSchema,
  createActionRowSchema,
  updateActionRowSchema,
} from './action-plans.schemas';

const controller = new ActionPlansController();
const router = Router();

router.use(authenticate, subscriptionGate);

router.get('/', (req, res, next) => controller.list(req, res, next));

router.post(
  '/',
  roleGuard(Role.ADMIN, Role.GESTOR),
  validate({ body: createActionPlanSchema }),
  (req, res, next) => controller.create(req, res, next),
);

router.get('/:id', (req, res, next) => controller.getById(req, res, next));

router.post(
  '/:id/rows',
  roleGuard(Role.ADMIN, Role.GESTOR),
  validate({ body: createActionRowSchema }),
  (req, res, next) => controller.addRow(req, res, next),
);

router.patch(
  '/rows/:rowId',
  validate({ body: updateActionRowSchema }),
  (req, res, next) => controller.updateRow(req, res, next),
);

export default router;
