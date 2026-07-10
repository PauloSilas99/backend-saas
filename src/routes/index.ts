import { Router } from 'express';
import authRoutes from '@modules/auth/auth.routes';
import usersRoutes from '@modules/users/users.routes';
import companiesRoutes from '@modules/companies/companies.routes';
import actionPlansRoutes from '@modules/action-plans/action-plans.routes';
import importsRoutes from '@modules/imports/imports.routes';
import analyticsRoutes from '@modules/analytics/analytics.routes';
import billingRoutes from '@modules/billing/billing.routes';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/companies', companiesRoutes);
router.use('/action-plans', actionPlansRoutes);
router.use('/imports', importsRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/billing', billingRoutes);

export default router;
