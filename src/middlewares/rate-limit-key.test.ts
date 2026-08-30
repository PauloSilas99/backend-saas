import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { apiRateLimitKey, authRateLimitKey } from './rate-limit-key';

function req(partial: {
  authorization?: string;
  email?: string;
  ip?: string;
}): Request {
  return {
    ip: partial.ip ?? '10.0.0.1',
    headers: partial.authorization ? { authorization: partial.authorization } : {},
    body: partial.email === undefined ? {} : { email: partial.email },
  } as unknown as Request;
}

describe('chave do limite da API', () => {
  it('separa usuários que chegam pelo mesmo IP', () => {
    const ana = apiRateLimitKey(req({ authorization: 'Bearer token-da-ana' }));
    const bruno = apiRateLimitKey(req({ authorization: 'Bearer token-do-bruno' }));

    expect(ana).not.toBe(bruno);
  });

  it('mantém a mesma chave para o mesmo token', () => {
    expect(apiRateLimitKey(req({ authorization: 'Bearer abc' }))).toBe(
      apiRateLimitKey(req({ authorization: 'Bearer abc' })),
    );
  });

  it('não carrega o token dentro da chave', () => {
    expect(apiRateLimitKey(req({ authorization: 'Bearer segredo-do-token' }))).not.toContain(
      'segredo-do-token',
    );
  });

  it('cai para o IP quando a requisição é anônima', () => {
    expect(apiRateLimitKey(req({ ip: '203.0.113.9' }))).toContain('203.0.113.9');
  });
});

describe('chave do limite de autenticação', () => {
  it('conta por conta tentada, não pelo IP de quem tenta', () => {
    const mesmoIp = { ip: '203.0.113.9' };
    const ana = authRateLimitKey(req({ ...mesmoIp, email: 'ana@empresa.com' }));
    const bruno = authRateLimitKey(req({ ...mesmoIp, email: 'bruno@empresa.com' }));

    expect(ana).not.toBe(bruno);
  });

  it('trata o mesmo e-mail escrito de formas diferentes como a mesma conta', () => {
    expect(authRateLimitKey(req({ email: '  Ana@Empresa.COM ' }))).toBe(
      authRateLimitKey(req({ email: 'ana@empresa.com' })),
    );
  });

  it('cai para o IP quando não veio e-mail', () => {
    expect(authRateLimitKey(req({ ip: '203.0.113.9' }))).toContain('203.0.113.9');
  });
});
