import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate } from '@middlewares/authenticate';
import { roleGuard } from '@middlewares/roleGuard';
import { subscriptionGate } from '@middlewares/subscriptionGate';
import { validate } from '@middlewares/validate';
import { CompaniesController } from './companies.controller';
import {
  createCompanySchema,
  createUnitSchema,
  updateCompanySchema,
  updateUnitSchema,
} from './companies.schemas';

const controller = new CompaniesController();
const router = Router();

router.use(authenticate, subscriptionGate);

router.get('/', (req, res, next) => controller.list(req, res, next));

router.post(
  '/',
  roleGuard(Role.PLATFORM_ADMIN, Role.GERENTE, Role.GESTOR),
  validate({ body: createCompanySchema }),
  (req, res, next) => controller.create(req, res, next),
);

router.get('/units', (req, res, next) => controller.listUnits(req, res, next));

router.post(
  '/units',
  roleGuard(Role.GERENTE, Role.PLATFORM_ADMIN),
  validate({ body: createUnitSchema }),
  (req, res, next) => controller.createUnit(req, res, next),
);

router.patch(
  '/units/:id',
  roleGuard(Role.GERENTE, Role.PLATFORM_ADMIN),
  validate({ body: updateUnitSchema }),
  (req, res, next) => controller.updateUnit(req, res, next),
);

router.delete(
  '/units/:id',
  roleGuard(Role.GERENTE, Role.PLATFORM_ADMIN),
  (req, res, next) => controller.removeUnit(req, res, next),
);

router.get('/:id', (req, res, next) => controller.getById(req, res, next));

router.patch(
  '/:id',
  roleGuard(Role.PLATFORM_ADMIN, Role.GERENTE),
  validate({ body: updateCompanySchema }),
  (req, res, next) => controller.update(req, res, next),
);

router.delete(
  '/:id',
  roleGuard(Role.PLATFORM_ADMIN, Role.GERENTE),
  (req, res, next) => controller.remove(req, res, next),
);

export default router;
