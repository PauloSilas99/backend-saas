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

const controller = new RisksController();
const router = Router();

router.use(authenticate, subscriptionGate);

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
