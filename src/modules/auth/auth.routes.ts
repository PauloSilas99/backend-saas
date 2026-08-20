import { Router } from 'express';
import { authenticate } from '@middlewares/authenticate';
import { validate } from '@middlewares/validate';
import { authRateLimiter } from '@middlewares/rateLimit';
import { AuthController } from './auth.controller';
import {
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  switchTenantSchema,
  updateMeSchema,
  verifyEmailSchema,
} from './auth.schemas';

const controller = new AuthController();
const router = Router();

router.post('/register', authRateLimiter, validate({ body: registerSchema }), (req, res, next) =>
  controller.register(req, res, next),
);

router.post('/login', authRateLimiter, validate({ body: loginSchema }), (req, res, next) =>
  controller.login(req, res, next),
);

router.post('/refresh', authRateLimiter, validate({ body: refreshSchema }), (req, res, next) =>
  controller.refresh(req, res, next),
);

router.post(
  '/verify-email',
  authRateLimiter,
  validate({ body: verifyEmailSchema }),
  (req, res, next) => controller.verifyEmail(req, res, next),
);

router.post(
  '/resend-verification',
  authRateLimiter,
  validate({ body: resendVerificationSchema }),
  (req, res, next) => controller.resendVerification(req, res, next),
);

router.post(
  '/forgot-password',
  authRateLimiter,
  validate({ body: forgotPasswordSchema }),
  (req, res, next) => controller.forgotPassword(req, res, next),
);

router.post(
  '/reset-password',
  authRateLimiter,
  validate({ body: resetPasswordSchema }),
  (req, res, next) => controller.resetPassword(req, res, next),
);

router.post('/logout', authenticate, (req, res, next) => controller.logout(req, res, next));

router.post(
  '/switch-tenant',
  authenticate,
  validate({ body: switchTenantSchema }),
  (req, res, next) => controller.switchTenant(req, res, next),
);

router.get('/me', authenticate, (req, res, next) => controller.me(req, res, next));

router.patch(
  '/me',
  authenticate,
  validate({ body: updateMeSchema }),
  (req, res, next) => controller.updateMe(req, res, next),
);

export default router;
