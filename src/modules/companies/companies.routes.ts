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
} from './companies.schemas';

const controller = new CompaniesController();
const router = Router();

router.use(authenticate, subscriptionGate);

router.get('/', (req, res, next) => controller.list(req, res, next));

router.post(
  '/',
  roleGuard(Role.ADMIN),
  validate({ body: createCompanySchema }),
  (req, res, next) => controller.create(req, res, next),
);

router.get('/units', (req, res, next) => controller.listUnits(req, res, next));

router.post(
  '/units',
  roleGuard(Role.ADMIN, Role.GESTOR),
  validate({ body: createUnitSchema }),
  (req, res, next) => controller.createUnit(req, res, next),
);

router.get('/:id', (req, res, next) => controller.getById(req, res, next));

router.patch(
  '/:id',
  roleGuard(Role.ADMIN, Role.GESTOR),
  validate({ body: updateCompanySchema }),
  (req, res, next) => controller.update(req, res, next),
);

export default router;
