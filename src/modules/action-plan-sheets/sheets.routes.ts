import { Router } from 'express';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { Role } from '@prisma/client';
import { env } from '@config/env';
import { authenticate } from '@middlewares/authenticate';
import { roleGuard } from '@middlewares/roleGuard';
import { subscriptionGate } from '@middlewares/subscriptionGate';
import { validate } from '@middlewares/validate';
import {
  bulkSheetSchema,
  columnsOrderSchema,
  createActionPlanSchema,
  createActionRowSchema,
  importFromParseSchema,
  importSheetJsonSchema,
  listSheetRowsQuerySchema,
  parseDistinctsQuerySchema,
  resolveActionSchema,
  updateActionRowSchema,
} from '@modules/action-plans/action-plans.schemas';
import { createColumnSchema, updateColumnSchema } from '@modules/columns/columns.schemas';
import { SheetsController } from './sheets.controller';

const controller = new SheetsController();
const router = Router();

const parseUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.resolve(process.cwd(), env.UPLOAD_DIR, 'tmp');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      cb(null, `${randomUUID()}${path.extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: env.UPLOAD_MAX_SIZE_MB * 1024 * 1024 },
});

router.use(authenticate, subscriptionGate);

router.get('/', (req, res, next) => controller.list(req, res, next));
router.get('/primary', (req, res, next) => controller.getPrimary(req, res, next));

router.post(
  '/parse-upload',
  roleGuard(Role.GERENTE, Role.GESTOR),
  parseUpload.single('file'),
  (req, res, next) => controller.parseUpload(req, res, next),
);

router.get(
  '/jobs/:jobId',
  roleGuard(Role.GERENTE, Role.GESTOR),
  (req, res, next) => controller.getJob(req, res, next),
);

router.get(
  '/parses/:parseId/distincts',
  roleGuard(Role.GERENTE, Role.GESTOR),
  validate({ query: parseDistinctsQuerySchema }),
  (req, res, next) => controller.getParseDistincts(req, res, next),
);

router.post(
  '/import-from-parse',
  roleGuard(Role.GERENTE, Role.GESTOR),
  validate({ body: importFromParseSchema }),
  (req, res, next) => controller.importFromParse(req, res, next),
);

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

router.get(
  '/:id/rows',
  validate({ query: listSheetRowsQuerySchema }),
  (req, res, next) => controller.listRows(req, res, next),
);

router.get('/:id/analytics', (req, res, next) => controller.getAnalytics(req, res, next));

router.delete(
  '/:id/rows/blank',
  roleGuard(Role.GERENTE, Role.GESTOR),
  (req, res, next) => controller.deleteBlankRows(req, res, next),
);

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
