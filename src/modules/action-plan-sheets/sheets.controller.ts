import { Request, Response, NextFunction } from 'express';
import { container } from 'tsyringe';
import { ValidationError } from '@shared/errors/AppError';
import { ActionPlansService } from '@modules/action-plans/action-plans.service';
import { parseCrossFilterParam } from '@modules/action-plans/cross-filter';
import { parsePeriodParam } from '@modules/action-plans/period-filter';
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
      const data = await service.getPrimaryForEmpresa(
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

  async restoreDefaultCharts(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(SheetsService);
      const data = await service.restoreDefaultCharts(req.user!, req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async downloadTemplate(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(SheetsService);
      const { buffer, fileName } = await service.buildTemplate(req.user!);
      this.sendWorkbook(res, buffer, fileName);
    } catch (error) {
      next(error);
    }
  }

  async exportSheet(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(SheetsService);
      const { buffer, fileName } = await service.exportSheet(req.user!, req.params.id);
      this.sendWorkbook(res, buffer, fileName);
    } catch (error) {
      next(error);
    }
  }

  private sendWorkbook(res: Response, buffer: Buffer, fileName: string) {
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
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
      const data = await plans.saveSheetRow(req.user!, req.params.id, {
        ...req.body,
        id: req.params.rowId,
      });
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
        throw new ValidationError('Envie o arquivo no campo "file".');
      }
      const service = container.resolve(SheetsService);
      const data = await service.enqueueParseUpload(req.user!, req.file);
      res.status(202).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async getJob(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(SheetsService);
      const data = await service.getJob(req.user!, req.params.jobId);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async getParseDistincts(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(SheetsService);
      const header = String(req.query.header ?? '');
      const data = await service.getParseDistincts(req.user!, req.params.parseId, header);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async importFromParse(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(SheetsService);
      const data = await service.enqueueImportFromParse(req.user!, req.body);
      res.status(202).json({ success: true, data });
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
        crossFilters: parseCrossFilterParam(req.query.filters),
        period: parsePeriodParam(req.query.period),
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async getAnalytics(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(SheetsService);
      const data = await service.getAnalytics(
        req.user!,
        req.params.id,
        parseCrossFilterParam(req.query.filters),
        parsePeriodParam(req.query.period),
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async getMyCharts(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(SheetsService);
      const data = await service.getMyCharts(req.user!, req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async saveMyCharts(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(SheetsService);
      const data = await service.saveMyCharts(req.user!, req.params.id, req.body);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async getChartSeries(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(SheetsService);
      const data = await service.getChartSeries(
        req.user!,
        req.params.id,
        req.body,
        parseCrossFilterParam(req.query.filters),
        parsePeriodParam(req.query.period),
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async deleteBlankRows(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(SheetsService);
      const data = await service.deleteBlankRows(req.user!, req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async duplicateRow(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(SheetsService);
      const data = await service.duplicateRow(req.user!, req.params.id, req.params.rowId);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async removeRow(req: Request, res: Response, next: NextFunction) {
    try {
      const service = container.resolve(SheetsService);
      const data = await service.removeRow(req.user!, req.params.id, req.params.rowId);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
}
