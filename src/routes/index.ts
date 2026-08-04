import { Router } from 'express';
import authRoutes from '@modules/auth/auth.routes';
import usersRoutes from '@modules/users/users.routes';
import companiesRoutes from '@modules/companies/companies.routes';
import actionPlansRoutes from '@modules/action-plans/action-plans.routes';
import sheetsRoutes from '@modules/action-plan-sheets/sheets.routes';
import importsRoutes from '@modules/imports/imports.routes';
import analyticsRoutes from '@modules/analytics/analytics.routes';
import billingRoutes from '@modules/billing/billing.routes';
import columnsRoutes from '@modules/columns/columns.routes';
import risksRoutes from '@modules/risks/risks.routes';
import calendarRoutes from '@modules/calendar/calendar.routes';
import empresasRoutes, {
  empresasMembersRouter,
  unidadesRouter,
} from '@modules/empresas/empresas.routes';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/companies', companiesRoutes);
router.use('/empresas', empresasRoutes);
router.use('/empresas/members', empresasMembersRouter);
router.use('/unidades', unidadesRouter);
router.use('/action-plans', actionPlansRoutes);
router.use('/action-plan-sheets', sheetsRoutes);
router.use('/imports', importsRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/billing', billingRoutes);
router.use('/columns', columnsRoutes);
router.use('/risks', risksRoutes);
router.use('/calendar', calendarRoutes);

export default router;
