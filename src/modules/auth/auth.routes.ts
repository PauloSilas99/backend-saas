import { Router } from 'express';
import { authenticate } from '@middlewares/authenticate';
import { validate } from '@middlewares/validate';
import { authRateLimiter } from '@middlewares/rateLimit';
import { AuthController } from './auth.controller';
import { loginSchema, refreshSchema, registerSchema, switchTenantSchema } from './auth.schemas';

const controller = new AuthController();
const router = Router();

/**
 * @openapi
 * /auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Registrar usuário e empresa
 *     security: []
 */
router.post('/register', authRateLimiter, validate({ body: registerSchema }), (req, res, next) =>
  controller.register(req, res, next),
);

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login
 *     security: []
 */
router.post('/login', authRateLimiter, validate({ body: loginSchema }), (req, res, next) =>
  controller.login(req, res, next),
);

router.post('/refresh', authRateLimiter, validate({ body: refreshSchema }), (req, res, next) =>
  controller.refresh(req, res, next),
);

router.post('/logout', authenticate, (req, res, next) => controller.logout(req, res, next));

router.post(
  '/switch-tenant',
  authenticate,
  validate({ body: switchTenantSchema }),
  (req, res, next) => controller.switchTenant(req, res, next),
);

router.get('/me', authenticate, (req, res, next) => controller.me(req, res, next));

export default router;
