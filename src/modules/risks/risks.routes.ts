import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate } from '@middlewares/authenticate';
import { roleGuard } from '@middlewares/roleGuard';
import { subscriptionGate } from '@middlewares/subscriptionGate';
import { validate } from '@middlewares/validate';
import { RisksController } from './risks.controller';
import {
  createRiskSchema,
  listRisksQuerySchema,
  updateRiskSchema,
} from './risks.schemas';
import { createControlSchema, updateControlSchema } from './controls.schemas';

const controller = new RisksController();
const router = Router();

router.use(authenticate, subscriptionGate);

router.get('/stats', (req, res, next) => controller.stats(req, res, next));
router.get('/matrix', (req, res, next) => controller.matrix(req, res, next));

router.get(
  '/',
  validate({ query: listRisksQuerySchema }),
  (req, res, next) => controller.list(req, res, next),
);

router.post(
  '/',
  roleGuard(Role.GERENTE, Role.GESTOR),
  validate({ body: createRiskSchema }),
  (req, res, next) => controller.create(req, res, next),
);

router.get('/:id/action-controls', (req, res, next) =>
  controller.listControls(req, res, next),
);

router.post(
  '/:id/action-controls',
  roleGuard(Role.GERENTE, Role.GESTOR),
  validate({ body: createControlSchema }),
  (req, res, next) => controller.createControl(req, res, next),
);

router.patch(
  '/:id/action-controls/:controlId',
  roleGuard(Role.GERENTE, Role.GESTOR),
  validate({ body: updateControlSchema }),
  (req, res, next) => controller.updateControl(req, res, next),
);

router.delete(
  '/:id/action-controls/:controlId',
  roleGuard(Role.GERENTE, Role.GESTOR),
  (req, res, next) => controller.removeControl(req, res, next),
);

router.get('/:id', (req, res, next) => controller.getById(req, res, next));

router.patch(
  '/:id',
  roleGuard(Role.GERENTE, Role.GESTOR),
  validate({ body: updateRiskSchema }),
  (req, res, next) => controller.update(req, res, next),
);

router.delete(
  '/:id',
  roleGuard(Role.GERENTE, Role.GESTOR),
  (req, res, next) => controller.remove(req, res, next),
);

export default router;
