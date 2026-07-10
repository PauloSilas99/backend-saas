import { describe, expect, it } from 'vitest';
import { hasRequiredRole, isAtLeast } from '@shared/helpers/rbac';
import { Role } from '@prisma/client';
import { hashToken, generateIdempotencyKey } from '@shared/helpers/crypto';
import { AppError, ForbiddenError } from '@shared/errors/AppError';

describe('RBAC helpers', () => {
  it('checks allowed roles', () => {
    expect(hasRequiredRole(Role.ADMIN, [Role.ADMIN, Role.GESTOR])).toBe(true);
    expect(hasRequiredRole(Role.OPERACIONAL, [Role.ADMIN, Role.GESTOR])).toBe(false);
  });

  it('compares hierarchy', () => {
    expect(isAtLeast(Role.ADMIN, Role.GESTOR)).toBe(true);
    expect(isAtLeast(Role.OPERACIONAL, Role.GESTOR)).toBe(false);
  });
});

describe('crypto helpers', () => {
  it('hashes tokens deterministically', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toBe(hashToken('abcd'));
  });

  it('generates idempotency keys', () => {
    const key = generateIdempotencyKey(['a', 'b', 'c']);
    expect(key).toHaveLength(64);
  });
});

describe('AppError', () => {
  it('creates operational errors', () => {
    const err = new ForbiddenError('nope');
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
  });
});
