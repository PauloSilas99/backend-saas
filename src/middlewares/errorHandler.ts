import { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { AppError, ConflictError } from '@shared/errors/AppError';
import { PRODUCT_LIMITS } from '@shared/limits/product-limits';
import { logger } from '@shared/logger';
import { ZodError } from 'zod';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    const conflict = new ConflictError('Já existe um registro com estes dados.');
    res.status(conflict.statusCode).json({
      success: false,
      error: {
        code: conflict.code,
        message: conflict.message,
        details: err.meta,
      },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Dados inválidos',
        details: err.flatten(),
      },
    });
    return;
  }

  const multerTooLarge =
    err.name === 'MulterError' &&
    (err as { code?: string }).code === 'LIMIT_FILE_SIZE';

  const bodyTooLarge =
    multerTooLarge ||
    (err as { type?: string; status?: number; statusCode?: number }).type ===
      'entity.too.large' ||
    (err as { status?: number }).status === 413 ||
    (err as { statusCode?: number }).statusCode === 413;

  if (bodyTooLarge) {
    res.status(413).json({
      success: false,
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: `Arquivo ou payload acima do limite deste ambiente (${PRODUCT_LIMITS.maxJsonBodyMb} MB de JSON ou ${PRODUCT_LIMITS.maxUploadMb} MB de planilha). Envie o arquivo pelo upload direto, não como JSON.`,
      },
    });
    return;
  }

  logger.error({ err }, 'Unhandled error');
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Erro interno do servidor',
    },
  });
}
