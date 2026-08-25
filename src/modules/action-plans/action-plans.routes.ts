import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate } from '@middlewares/authenticate';
import { roleGuard } from '@middlewares/roleGuard';
import { subscriptionGate } from '@middlewares/subscriptionGate';
import { validate } from '@middlewares/validate';
import { ActionPlansController } from './action-plans.controller';
import {
  approveActionSchema,
  createActionPlanSchema,
  createActionRowSchema,
  listActionsQuerySchema,
  rejectActionSchema,
  resolveActionSchema,
  transitionActionSchema,
  updateActionRowSchema,
} from './action-plans.schemas';

const controller = new ActionPlansController();
const router = Router();

router.use(authenticate, subscriptionGate);

router.get('/', (req, res, next) => controller.list(req, res, next));

router.get(
  '/actions',
  validate({ query: listActionsQuerySchema }),
  (req, res, next) => controller.listActions(req, res, next),
);

router.post(
  '/',
  roleGuard(Role.GERENTE, Role.GESTOR),
  validate({ body: createActionPlanSchema }),
  (req, res, next) => controller.create(req, res, next),
);

router.get('/:id', (req, res, next) => controller.getById(req, res, next));

router.post(
  '/:id/rows',
  roleGuard(Role.GERENTE, Role.GESTOR),
  validate({ body: createActionRowSchema }),
  (req, res, next) => controller.addRow(req, res, next),
);

router.get('/rows/:rowId', (req, res, next) => controller.getRow(req, res, next));

router.patch(
  '/rows/:rowId',
  validate({ body: updateActionRowSchema }),
  (req, res, next) => controller.updateRow(req, res, next),
);

router.post(
  '/rows/:rowId/request-completion',
  validate({ body: transitionActionSchema }),
  (req, res, next) => controller.requestCompletion(req, res, next),
);

router.post(
  '/rows/:rowId/approve',
  roleGuard(Role.GERENTE, Role.GESTOR),
  validate({ body: approveActionSchema }),
  (req, res, next) => controller.approve(req, res, next),
);

router.post(
  '/rows/:rowId/reject',
  roleGuard(Role.GERENTE, Role.GESTOR),
  validate({ body: rejectActionSchema }),
  (req, res, next) => controller.reject(req, res, next),
);

router.post(
  '/rows/:rowId/resolve',
  validate({ body: resolveActionSchema }),
  (req, res, next) => controller.resolve(req, res, next),
);

router.post(
  '/rows/:rowId/duplicate',
  roleGuard(Role.GERENTE, Role.GESTOR),
  (req, res, next) => controller.duplicate(req, res, next),
);

router.delete(
  '/rows/:rowId',
  roleGuard(Role.GERENTE, Role.GESTOR),
  (req, res, next) => controller.remove(req, res, next),
);

export default router;
