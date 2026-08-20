import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate } from '@middlewares/authenticate';
import { roleGuard } from '@middlewares/roleGuard';
import { subscriptionGate } from '@middlewares/subscriptionGate';
import { validate } from '@middlewares/validate';
import { UsersController } from './users.controller';
import { createUserSchema, listUsersQuerySchema, setUserActiveSchema, updateUserSchema } from './users.schemas';

const controller = new UsersController();
const router = Router();

router.use(authenticate, subscriptionGate);

router.get('/', validate({ query: listUsersQuerySchema }), (req, res, next) =>
  controller.list(req, res, next),
);

router.post(
  '/',
  roleGuard(Role.GERENTE),
  validate({ body: createUserSchema }),
  (req, res, next) => controller.create(req, res, next),
);

router.get('/:id', (req, res, next) => controller.getById(req, res, next));

router.patch(
  '/:id',
  roleGuard(Role.GERENTE, Role.PLATFORM_ADMIN),
  validate({ body: updateUserSchema }),
  (req, res, next) => controller.update(req, res, next),
);

router.patch(
  '/:id/active',
  roleGuard(Role.PLATFORM_ADMIN),
  validate({ body: setUserActiveSchema }),
  (req, res, next) => controller.setActive(req, res, next),
);

router.delete('/:id', roleGuard(Role.GERENTE, Role.PLATFORM_ADMIN), (req, res, next) =>
  controller.remove(req, res, next),
);

export default router;
