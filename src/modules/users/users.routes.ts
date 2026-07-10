import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate } from '@middlewares/authenticate';
import { roleGuard } from '@middlewares/roleGuard';
import { subscriptionGate } from '@middlewares/subscriptionGate';
import { validate } from '@middlewares/validate';
import { UsersController } from './users.controller';
import { createUserSchema, updateUserSchema } from './users.schemas';

const controller = new UsersController();
const router = Router();

router.use(authenticate, subscriptionGate);

router.get('/', roleGuard(Role.ADMIN, Role.GESTOR), (req, res, next) =>
  controller.list(req, res, next),
);

router.post(
  '/',
  roleGuard(Role.ADMIN, Role.GESTOR),
  validate({ body: createUserSchema }),
  (req, res, next) => controller.create(req, res, next),
);

router.get('/:id', (req, res, next) => controller.getById(req, res, next));

router.patch(
  '/:id',
  roleGuard(Role.ADMIN, Role.GESTOR),
  validate({ body: updateUserSchema }),
  (req, res, next) => controller.update(req, res, next),
);

export default router;
