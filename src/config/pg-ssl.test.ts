import { describe, expect, it } from 'vitest';
import { pgSslFor } from './pg-ssl';

describe('pgSslFor', () => {
  it('exige SSL em host remoto', () => {
    expect(pgSslFor('postgresql://u:p@ep-x.sa-east-1.aws.neon.tech/db?sslmode=require')).toEqual({
      rejectUnauthorized: false,
    });
  });

  it('dispensa SSL em localhost', () => {
    expect(pgSslFor('postgresql://saas:saas@localhost:5434/saas')).toBe(false);
  });

  it('dispensa SSL em 127.0.0.1', () => {
    expect(pgSslFor('postgresql://saas:saas@127.0.0.1:5432/saas')).toBe(false);
  });

  it('respeita sslmode=disable mesmo em host remoto', () => {
    expect(pgSslFor('postgresql://u:p@db.interno:5432/saas?sslmode=disable')).toBe(false);
  });

  it('trata URL inválida como remota, para não afrouxar por engano', () => {
    expect(pgSslFor('nao-e-uma-url')).toEqual({ rejectUnauthorized: false });
  });
});
