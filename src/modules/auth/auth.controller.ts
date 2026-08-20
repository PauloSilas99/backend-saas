import { Request, Response, NextFunction } from 'express';
import { container } from 'tsyringe';
import { AuthService } from './auth.service';

export class AuthController {
  async register(req: Request, res: Response, next: NextFunction) {
    try {
      const authService = container.resolve(AuthService);
      const result = await authService.register(req.body);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const authService = container.resolve(AuthService);
      const result = await authService.login(req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const authService = container.resolve(AuthService);
      const result = await authService.refresh(req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const authService = container.resolve(AuthService);
      const result = await authService.logout(req.user!.id, req.body?.refreshToken);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async switchTenant(req: Request, res: Response, next: NextFunction) {
    try {
      const authService = container.resolve(AuthService);
      const result = await authService.switchTenant(req.user!, req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async me(req: Request, res: Response, next: NextFunction) {
    try {
      const authService = container.resolve(AuthService);
      const result = await authService.me(req.user!.id, req.user!.tenantId);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async updateMe(req: Request, res: Response, next: NextFunction) {
    try {
      const authService = container.resolve(AuthService);
      const result = await authService.updateMe(req.user!.id, req.user!.tenantId, req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async verifyEmail(req: Request, res: Response, next: NextFunction) {
    try {
      const authService = container.resolve(AuthService);
      const result = await authService.verifyEmail(req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async resendVerification(req: Request, res: Response, next: NextFunction) {
    try {
      const authService = container.resolve(AuthService);
      const result = await authService.resendVerification(req.body.email);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async forgotPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const authService = container.resolve(AuthService);
      const result = await authService.forgotPassword(req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async resetPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const authService = container.resolve(AuthService);
      const result = await authService.resetPassword(req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}
