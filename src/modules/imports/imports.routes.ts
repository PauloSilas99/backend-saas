import { randomUUID } from 'crypto';
import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { Role } from '@prisma/client';
import { container } from 'tsyringe';
import { env } from '@config/env';
import { authenticate } from '@middlewares/authenticate';
import { roleGuard } from '@middlewares/roleGuard';
import { subscriptionGate } from '@middlewares/subscriptionGate';
import { validate } from '@middlewares/validate';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import {
  assertAllowedUploadMime,
  assertAllowedExtension,
} from './imports.file-validator';
import {
  columnMappingSchema,
  confirmImportSchema,
  importJobIdParamsSchema,
  legacyConfirmImportSchema,
  listImportsQuerySchema,
  previewQuerySchema,
} from './imports.schemas';

const controller = new ImportsController();
const router = Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const service = container.resolve(ImportsService);
    cb(null, service.ensureUploadDir());
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: env.UPLOAD_MAX_SIZE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    try {
      assertAllowedExtension(file.originalname);
      assertAllowedUploadMime(file.mimetype);
      cb(null, true);
    } catch (error) {
      cb(error as Error);
    }
  },
});

const importRoles = roleGuard(Role.GERENTE, Role.GESTOR);

router.use(authenticate, subscriptionGate);

router.get(
  '/',
  importRoles,
  validate({ query: listImportsQuerySchema }),
  (req, res, next) => controller.list(req, res, next),
);

router.post(
  '/',
  importRoles,
  upload.single('file'),
  (req, res, next) => controller.upload(req, res, next),
);

router.get(
  '/:jobId/columns',
  importRoles,
  validate({ params: importJobIdParamsSchema }),
  (req, res, next) => controller.getColumns(req, res, next),
);

router.post(
  '/:jobId/mapping',
  importRoles,
  validate({ params: importJobIdParamsSchema, body: columnMappingSchema }),
  (req, res, next) => controller.saveMapping(req, res, next),
);

router.get(
  '/:jobId/preview',
  importRoles,
  validate({ params: importJobIdParamsSchema, query: previewQuerySchema }),
  (req, res, next) => controller.preview(req, res, next),
);

router.post(
  '/:jobId/confirm',
  importRoles,
  validate({ params: importJobIdParamsSchema, body: confirmImportSchema }),
  (req, res, next) => controller.confirm(req, res, next),
);

router.get(
  '/:jobId',
  importRoles,
  validate({ params: importJobIdParamsSchema }),
  (req, res, next) => controller.getById(req, res, next),
);

// Rotas legadas (compatibilidade)
router.post(
  '/spreadsheet',
  importRoles,
  upload.single('file'),
  (req, res, next) => controller.upload(req, res, next),
);

router.post(
  '/spreadsheet/confirm',
  importRoles,
  validate({ body: legacyConfirmImportSchema }),
  (req, res, next) => controller.legacyConfirm(req, res, next),
);

router.get('/:id/status', (req, res, next) => controller.status(req, res, next));

export default router;
