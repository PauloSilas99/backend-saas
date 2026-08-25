import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate } from '@middlewares/authenticate';
import { roleGuard } from '@middlewares/roleGuard';
import { subscriptionGate } from '@middlewares/subscriptionGate';
import { validate } from '@middlewares/validate';
import { CompaniesController } from '@modules/companies/companies.controller';
import {
  createCompanySchema,
  createUnitSchema,
  updateCompanySchema,
  updateUnitSchema,
} from '@modules/companies/companies.schemas';
import { UsersController } from '@modules/users/users.controller';
import { createUserSchema, updateUserSchema } from '@modules/users/users.schemas';

/**
 * FE-aligned aliases:
 * /empresas, /empresas/:id/unidades, /empresas/:id/members, /unidades/:id
 */
const companies = new CompaniesController();
const users = new UsersController();
const router = Router();

router.use(authenticate, subscriptionGate);

router.get('/', (req, res, next) => companies.list(req, res, next));

router.post(
  '/',
  roleGuard(Role.PLATFORM_ADMIN, Role.GERENTE, Role.GESTOR),
  validate({ body: createCompanySchema }),
  (req, res, next) => companies.create(req, res, next),
);

router.get('/:empresaId/unidades', (req, res, next) => companies.listUnits(req, res, next));

router.post(
  '/:empresaId/unidades',
  roleGuard(Role.GERENTE, Role.PLATFORM_ADMIN),
  validate({ body: createUnitSchema }),
  (req, res, next) => companies.createUnit(req, res, next),
);

router.get('/:empresaId/members', (req, res, next) => users.listMembers(req, res, next));

router.post(
  '/:empresaId/members',
  roleGuard(Role.GERENTE, Role.PLATFORM_ADMIN),
  validate({ body: createUserSchema }),
  (req, res, next) => users.create(req, res, next),
);

router.patch(
  '/:empresaId/members/:id',
  roleGuard(Role.GERENTE, Role.PLATFORM_ADMIN),
  validate({ body: updateUserSchema }),
  (req, res, next) => users.update(req, res, next),
);

router.delete(
  '/:empresaId/members/:id',
  roleGuard(Role.GERENTE, Role.PLATFORM_ADMIN),
  (req, res, next) => users.remove(req, res, next),
);

router.get('/:id', (req, res, next) => companies.getById(req, res, next));

router.patch(
  '/:id',
  roleGuard(Role.PLATFORM_ADMIN, Role.GERENTE),
  validate({ body: updateCompanySchema }),
  (req, res, next) => companies.update(req, res, next),
);

router.delete(
  '/:id',
  roleGuard(Role.PLATFORM_ADMIN, Role.GERENTE),
  (req, res, next) => companies.remove(req, res, next),
);

export default router;

export const unidadesRouter = Router();
unidadesRouter.use(authenticate, subscriptionGate);

unidadesRouter.patch(
  '/:id',
  roleGuard(Role.GERENTE, Role.PLATFORM_ADMIN),
  validate({ body: updateUnitSchema }),
  (req, res, next) => companies.updateUnit(req, res, next),
);

unidadesRouter.delete(
  '/:id',
  roleGuard(Role.GERENTE, Role.PLATFORM_ADMIN),
  (req, res, next) => companies.removeUnit(req, res, next),
);

export const empresasMembersRouter = Router();
empresasMembersRouter.use(authenticate, subscriptionGate);

empresasMembersRouter.patch(
  '/:id',
  roleGuard(Role.GERENTE, Role.PLATFORM_ADMIN),
  validate({ body: updateUserSchema }),
  (req, res, next) => users.update(req, res, next),
);

empresasMembersRouter.delete(
  '/:id',
  roleGuard(Role.GERENTE, Role.PLATFORM_ADMIN),
  (req, res, next) => users.remove(req, res, next),
);
