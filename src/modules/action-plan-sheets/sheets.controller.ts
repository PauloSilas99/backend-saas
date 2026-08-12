import { Request, Response, NextFunction } from 'express';
import { container } from 'tsyringe';
import { ActionPlansService } from '@modules/action-plans/action-plans.service';
import { SheetsService } from './sheets.service';

export class SheetsController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(SheetsService);
      const data = await service.list(req.user!);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(SheetsService);
      const data = await service.getById(req.user!, req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const plans = container.resolve(ActionPlansService);
      const data = await plans.create(req.user!, req.body);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async getPrimary(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(SheetsService);
      const data = await service.getOrCreateForEmpresa(
        req.user!,
        req.query.empresaId as string | undefined,
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async bulkSave(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(SheetsService);
      const data = await service.bulkSave(req.user!, req.params.id, req.body);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async createColumn(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(SheetsService);
      const data = await service.createColumn(req.user!, req.params.id, req.body);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async updateColumn(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(SheetsService);
      const data = await service.updateColumn(
        req.user!,
        req.params.id,
        req.params.columnId,
        req.body,
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async deleteColumn(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(SheetsService);
      const data = await service.deleteColumn(req.user!, req.params.id, req.params.columnId);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async orderColumns(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(SheetsService);
      const data = await service.orderColumns(req.user!, req.params.id, req.body);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async resetColumns(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(SheetsService);
      const data = await service.resetColumns(req.user!, req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async addRow(req: Request, res: Response, next: NextFunction) {
    try {
      const plans = container.resolve(ActionPlansService);
      const data = await plans.addRow(req.user!, req.params.id, req.body);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async updateRow(req: Request, res: Response, next: NextFunction) {
    try {
      const plans = container.resolve(ActionPlansService);
      const data = await plans.updateRow(req.user!, req.params.rowId, req.body);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async resolveRow(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(SheetsService);
      const data = await service.resolveRow(
        req.user!,
        req.params.id,
        req.params.rowId,
        req.body,
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async importJson(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(SheetsService);
      const data = await service.importJson(req.user!, req.body);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async parseUpload(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.file) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Envie o arquivo no campo "file".' },
        });
        return;
      }
      const service = container.resolve(SheetsService);
      const data = await service.parseUpload(req.user!, req.file);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async importFromParse(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(SheetsService);
      const data = await service.importFromParse(req.user!, req.body);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async listRows(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(SheetsService);
      const data = await service.listRows(req.user!, req.params.id, {
        page: Number(req.query.page ?? 1),
        pageSize: Number(req.query.pageSize ?? 50),
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async getAnalytics(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(SheetsService);
      const data = await service.getAnalytics(req.user!, req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
}
