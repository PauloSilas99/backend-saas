import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate } from '@middlewares/authenticate';
import { roleGuard } from '@middlewares/roleGuard';
import { subscriptionGate } from '@middlewares/subscriptionGate';
import { validate } from '@middlewares/validate';
import { CalendarController } from './calendar.controller';
import {
  actionRowIdParamsSchema,
  calendarRangeQuerySchema,
  createActivitySchema,
  overridesQuerySchema,
  putOverridesSchema,
  updateActivitySchema,
  upsertActionOverlaySchema,
  upsertOverrideSchema,
} from './calendar.schemas';

/**
 * Calendário híbrido:
 * - Lê datas da base (ações/planilha)
 * - Overlay pessoal não altera ActionPlanRow
 * - Activities livres + overrides de dia
 */
const controller = new CalendarController();
const router = Router();

router.use(authenticate, subscriptionGate);

/** Agenda: items (action + personal) + overrides */
router.get(
  '/',
  validate({ query: calendarRangeQuerySchema }),
  (req, res, next) => controller.agenda(req, res, next),
);

router.get(
  '/overrides',
  validate({ query: overridesQuerySchema }),
  (req, res, next) => controller.listOverrides(req, res, next),
);

router.put(
  '/overrides',
  roleGuard(Role.GERENTE, Role.GESTOR),
  validate({ body: putOverridesSchema }),
  (req, res, next) => controller.putOverrides(req, res, next),
);

router.post(
  '/overrides',
  roleGuard(Role.GERENTE, Role.GESTOR),
  validate({ body: upsertOverrideSchema }),
  (req, res, next) => controller.upsertOverride(req, res, next),
);

router.delete(
  '/overrides/:date',
  roleGuard(Role.GERENTE, Role.GESTOR),
  (req, res, next) => controller.removeOverride(req, res, next),
);

/** Overlay pessoal sobre ação da base — sem write-back na planilha */
router.put(
  '/actions/:actionRowId/overlay',
  roleGuard(Role.GERENTE, Role.GESTOR, Role.OPERACIONAL),
  validate({ params: actionRowIdParamsSchema, body: upsertActionOverlaySchema }),
  (req, res, next) => controller.upsertActionOverlay(req, res, next),
);

router.delete(
  '/actions/:actionRowId/overlay',
  roleGuard(Role.GERENTE, Role.GESTOR, Role.OPERACIONAL),
  validate({ params: actionRowIdParamsSchema }),
  (req, res, next) => controller.removeActionOverlay(req, res, next),
);

router.get(
  '/activities',
  validate({ query: calendarRangeQuerySchema }),
  (req, res, next) => controller.listActivities(req, res, next),
);

router.post(
  '/activities',
  roleGuard(Role.GERENTE, Role.GESTOR, Role.OPERACIONAL),
  validate({ body: createActivitySchema }),
  (req, res, next) => controller.createActivity(req, res, next),
);

router.get('/activities/:id', (req, res, next) => controller.getActivity(req, res, next));

router.patch(
  '/activities/:id',
  roleGuard(Role.GERENTE, Role.GESTOR, Role.OPERACIONAL),
  validate({ body: updateActivitySchema }),
  (req, res, next) => controller.updateActivity(req, res, next),
);

router.delete(
  '/activities/:id',
  roleGuard(Role.GERENTE, Role.GESTOR, Role.OPERACIONAL),
  (req, res, next) => controller.removeActivity(req, res, next),
);

export default router;
