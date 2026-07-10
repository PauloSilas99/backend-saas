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
import { confirmImportSchema } from './imports.schemas';

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
});

router.use(authenticate, subscriptionGate);

router.post(
  '/spreadsheet',
  roleGuard(Role.ADMIN, Role.GESTOR),
  upload.single('file'),
  (req, res, next) => controller.upload(req, res, next),
);

router.post(
  '/spreadsheet/confirm',
  roleGuard(Role.ADMIN, Role.GESTOR),
  validate({ body: confirmImportSchema }),
  (req, res, next) => controller.confirm(req, res, next),
);

router.get('/:id/status', (req, res, next) => controller.status(req, res, next));

export default router;
