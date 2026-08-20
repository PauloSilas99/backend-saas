import { Request, Response, NextFunction } from 'express';
import { container } from 'tsyringe';
import { UsersService } from './users.service';

export class UsersController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(UsersService);
      const data = await service.list(req.user!, req.query.q as string | undefined);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async listMembers(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(UsersService);
      const data = await service.listMembers(
        req.user!,
        req.params.empresaId,
        req.query.q as string | undefined,
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(UsersService);
      const empresaId = req.params.empresaId as string | undefined;
      const data = await service.create(req.user!, req.body, empresaId);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(UsersService);
      const data = await service.getById(req.user!, req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(UsersService);
      const empresaId = req.params.empresaId as string | undefined;
      const data = await service.update(req.user!, req.params.id, req.body, empresaId);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(UsersService);
      const empresaId = req.params.empresaId as string | undefined;
      const data = await service.remove(req.user!, req.params.id, empresaId);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async removeMembership(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(UsersService);
      const data = await service.removeMembership(req.user!, req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async setActive(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(UsersService);
      const data = await service.setActive(req.user!, req.params.id, Boolean(req.body.isActive));
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
}
