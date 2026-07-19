import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate } from '@middlewares/authenticate';
import { roleGuard } from '@middlewares/roleGuard';
import { subscriptionGate } from '@middlewares/subscriptionGate';
import { validate } from '@middlewares/validate';
import { ColumnsController } from './columns.controller';
import {
  createColumnSchema,
  deleteColumnSchema,
  updateColumnSchema,
} from './columns.schemas';

const controller = new ColumnsController();
const router = Router();

router.use(authenticate, subscriptionGate);

router.get('/', (req, res, next) => controller.list(req, res, next));

router.post(
  '/',
  roleGuard(Role.GERENTE),
  validate({ body: createColumnSchema }),
  (req, res, next) => controller.create(req, res, next),
);

router.patch(
  '/:id',
  roleGuard(Role.GERENTE),
  validate({ body: updateColumnSchema }),
  (req, res, next) => controller.update(req, res, next),
);

router.delete(
  '/:id',
  roleGuard(Role.GERENTE),
  validate({ body: deleteColumnSchema }),
  (req, res, next) => controller.remove(req, res, next),
);

router.get(
  '/:id/history',
  roleGuard(Role.GERENTE),
  (req, res, next) => controller.history(req, res, next),
);

export default router;
