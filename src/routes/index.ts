import { Router } from 'express';
import { probeHealthDeps } from '@shared/health/deps-probe';
import authRoutes from '@modules/auth/auth.routes';
import usersRoutes from '@modules/users/users.routes';
import companiesRoutes from '@modules/companies/companies.routes';
import actionPlansRoutes from '@modules/action-plans/action-plans.routes';
import sheetsRoutes from '@modules/action-plan-sheets/sheets.routes';
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

/** Liveness da API — não acorda Neon nem Redis. */
router.get('/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
      checks: { api: 'ok' },
    },
  });
});

/** SELECT 1 + PING. `?details=1` inclui disco (cacheado) e memória Redis. */
router.get('/health/deps', async (req, res) => {
  const details = req.query.details === '1' || req.query.details === 'true';
  const checkedAt = new Date().toISOString();
  const checks = await probeHealthDeps(details);
  const ok = checks.database === 'ok';
  res.status(ok ? 200 : 503).json({
    success: ok,
    data: {
      status: ok ? 'ok' : 'degraded',
      timestamp: checkedAt,
      checks: {
        api: 'ok',
        provider: 'neon',
        plan: 'free',
        ...checks,
      },
    },
  });
});


router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/companies', companiesRoutes);
router.use('/empresas', empresasRoutes);
router.use('/empresas/members', empresasMembersRouter);
router.use('/unidades', unidadesRouter);
router.use('/action-plans', actionPlansRoutes);
router.use('/action-plan-sheets', sheetsRoutes);
router.use('/imports', (_req, res) => {
  res.status(410).json({
    success: false,
    error: {
      code: 'IMPORTS_RETIRED',
      message:
        'A API /imports foi aposentada. Use POST /action-plan-sheets/parse-upload e POST /action-plan-sheets/import-from-parse.',
    },
  });
});
router.use('/analytics', analyticsRoutes);
router.use('/billing', billingRoutes);
router.use('/columns', columnsRoutes);
router.use('/risks', risksRoutes);
router.use('/calendar', calendarRoutes);

export default router;
