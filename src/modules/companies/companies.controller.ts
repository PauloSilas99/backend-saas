import { Request, Response, NextFunction } from 'express';
import { container } from 'tsyringe';
import { CompaniesService } from './companies.service';

export class CompaniesController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(CompaniesService);
      const data = await service.list(req.user!);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(CompaniesService);
      const data = await service.getById(req.user!, req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(CompaniesService);
      const data = await service.create(req.user!, req.body);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(CompaniesService);
      const data = await service.update(req.user!, req.params.id, req.body);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(CompaniesService);
      const data = await service.remove(req.user!, req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async listUnits(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(CompaniesService);
      const empresaId =
        (req.params.empresaId as string | undefined) ||
        (req.query.empresaId as string | undefined) ||
        (req.query.tenantId as string | undefined);
      const data = await service.listUnits(req.user!, empresaId);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async createUnit(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(CompaniesService);
      const empresaId = req.params.empresaId as string | undefined;
      const data = await service.createUnit(req.user!, req.body, empresaId);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async updateUnit(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(CompaniesService);
      const data = await service.updateUnit(req.user!, req.params.id, req.body);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async removeUnit(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(CompaniesService);
      const data = await service.removeUnit(req.user!, req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
}
