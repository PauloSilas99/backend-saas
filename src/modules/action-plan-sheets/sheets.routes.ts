import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate } from '@middlewares/authenticate';
import { roleGuard } from '@middlewares/roleGuard';
import { subscriptionGate } from '@middlewares/subscriptionGate';
import { validate } from '@middlewares/validate';
import {
  bulkSheetSchema,
  columnsOrderSchema,
  createActionPlanSchema,
  createActionRowSchema,
  importSheetJsonSchema,
  resolveActionSchema,
  updateActionRowSchema,
} from '@modules/action-plans/action-plans.schemas';
import { createColumnSchema, updateColumnSchema } from '@modules/columns/columns.schemas';
import { SheetsController } from './sheets.controller';

const controller = new SheetsController();
const router = Router();

router.use(authenticate, subscriptionGate);

router.get('/', (req, res, next) => controller.list(req, res, next));
router.get('/primary', (req, res, next) => controller.getPrimary(req, res, next));

router.post(
  '/import',
  roleGuard(Role.GERENTE, Role.GESTOR),
  validate({ body: importSheetJsonSchema }),
  (req, res, next) => controller.importJson(req, res, next),
);

router.post(
  '/',
  roleGuard(Role.GERENTE, Role.GESTOR),
  validate({ body: createActionPlanSchema }),
  (req, res, next) => controller.create(req, res, next),
);

router.get('/:id', (req, res, next) => controller.getById(req, res, next));

router.put(
  '/:id',
  roleGuard(Role.GERENTE, Role.GESTOR),
  validate({ body: bulkSheetSchema }),
  (req, res, next) => controller.bulkSave(req, res, next),
);

router.post(
  '/:id/columns',
  roleGuard(Role.GERENTE),
  validate({ body: createColumnSchema }),
  (req, res, next) => controller.createColumn(req, res, next),
);

router.patch(
  '/:id/columns/:columnId',
  roleGuard(Role.GERENTE),
  validate({ body: updateColumnSchema }),
  (req, res, next) => controller.updateColumn(req, res, next),
);

router.delete(
  '/:id/columns/:columnId',
  roleGuard(Role.GERENTE),
  (req, res, next) => controller.deleteColumn(req, res, next),
);

router.put(
  '/:id/columns/order',
  roleGuard(Role.GERENTE),
  validate({ body: columnsOrderSchema }),
  (req, res, next) => controller.orderColumns(req, res, next),
);

router.post(
  '/:id/columns/reset',
  roleGuard(Role.GERENTE),
  (req, res, next) => controller.resetColumns(req, res, next),
);

router.post(
  '/:id/rows',
  roleGuard(Role.GERENTE, Role.GESTOR),
  validate({ body: createActionRowSchema }),
  (req, res, next) => controller.addRow(req, res, next),
);

router.patch(
  '/:id/rows/:rowId',
  validate({ body: updateActionRowSchema }),
  (req, res, next) => controller.updateRow(req, res, next),
);

router.post(
  '/:id/rows/:rowId/resolve',
  validate({ body: resolveActionSchema }),
  (req, res, next) => controller.resolveRow(req, res, next),
);

export default router;
