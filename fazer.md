Quero que você desenvolva o backend da aplicação em Node.js + Express + TypeScript seguindo arquitetura modular e limpa, inspirada nesta estrutura:

src/
  config/
  middlewares/
  modules/
  shared/
  types/

Objetivo: criar um backend robusto, escalável e preparado para crescimento.

## Requisitos obrigatórios

1) Autenticação
- Implementar autenticação com JWT (access token + refresh token).
- Hash de senha com bcrypt.
- Fluxos:
  - POST /auth/register
  - POST /auth/login
  - POST /auth/refresh
  - POST /auth/logout
  - GET /auth/me
- Incluir controle de sessão/tokens revogados (blacklist ou versionamento de token).

2) Permissionamento por perfil (RBAC)
- Perfis: admin, gestor, operacional.
- Middleware de autorização por role.
- Rotas segregadas por permissão:
  - Admin: gestão completa de usuários, empresas, planos e configurações.
  - Gestor: gestão operacional da empresa/unidade sob seu escopo.
  - Operacional: acesso restrito aos próprios dados/ações.
- Garantir proteção tanto em rota quanto em regra de domínio (não só no controller).

3) Upload de planilha e importação para banco
- Endpoint para upload de planilha (xlsx/csv) com validação de formato.
- Ler planilha, validar colunas obrigatórias, normalizar dados e persistir no banco.
- Estratégia de importação:
  - Preview dos dados antes de confirmar.
  - Importação transacional.
  - Relatório de erros por linha (sem derrubar tudo).
  - Idempotência para evitar duplicação.
- Endpoints sugeridos:
  - POST /imports/spreadsheet (upload)
  - POST /imports/spreadsheet/confirm
  - GET /imports/:id/status

4) Rotas para área de gráficos (dashboard analytics)
- Criar endpoints de agregação para alimentar cards, séries temporais, distribuição por status/prioridade/unidade/responsável.
- Permitir filtros por período, empresa, unidade, responsável, status.
- Exemplo:
  - GET /analytics/kpis
  - GET /analytics/monthly
  - GET /analytics/by-unit
  - GET /analytics/by-responsible
  - GET /analytics/adherence
- Garantir que os dados retornados respeitem o perfil do usuário (escopo).

5) Gateway de pagamento para liberar acesso ao sistema
- Integração com gateway (ex.: Stripe, Mercado Pago ou Asaas) abstraída por adapter.
- Fluxos:
  - Criar assinatura/plano
  - Checkout
  - Webhook para confirmação/cancelamento/inadimplência
  - Atualização automática do status de acesso do tenant/usuário
- Endpoints sugeridos:
  - POST /billing/checkout
  - POST /billing/webhook
  - GET /billing/subscription
  - POST /billing/portal
- Aplicar feature gate/bloqueio de acesso quando assinatura estiver inativa.

## Arquitetura e padrões obrigatórios

- Express + TypeScript com camadas claras:
  - routes -> controller -> service/use-case -> repository -> database
- Organização por módulos de domínio em src/modules:
  - auth
  - users
  - companies/tenants
  - action-plans (planilhas e ações)
  - analytics
  - billing
- src/shared para utilitários, errors, logger, helpers, contracts.
- src/config para env, database, app, swagger.
- src/middlewares para auth, roleGuard, validation, errorHandler, rateLimit.
- src/types para tipos globais e augmentations.
- Injeção de dependência (tsyringe ou padrão factory).
- Validação de payload com Zod ou Joi.
- Tratamento de erro padronizado (AppError + error middleware).
- Versionamento de API: /api/v1.
- Rotas limpas, RESTful e consistentes para crescimento futuro.

## Banco de dados

- Usar PostgreSQL com ORM (Prisma preferencial).
- Modelagem mínima:
  - users
  - roles (ou enum)
  - tenants/companies
  - memberships (user x tenant x role)
  - action_plans
  - action_plan_rows
  - imports
  - subscriptions
  - payments
  - audit_logs
- Incluir migrations e seed inicial.

## Segurança e qualidade

- Helmet, CORS configurável, rate limiting.
- Sanitização e validação de entrada.
- Logs estruturados (pino/winston).
- Auditoria de ações críticas.
- Testes:
  - unitários (services/use-cases)
  - integração (rotas principais)
- Documentação Swagger/OpenAPI.
- Docker + docker-compose.
- .env.example completo.
- Scripts npm/yarn:
  - dev, build, start, test, test:watch, lint, format, migrate, seed

## Entregáveis esperados

1. Estrutura completa de pastas e arquivos.
2. Implementação funcional de autenticação + RBAC.
3. Upload/import de planilha com persistência no banco.
4. Endpoints de analytics para o dashboard.
5. Integração de billing com webhook funcional.
6. Documentação da API + instruções de execução.
7. Seed com usuários de teste:
   - admin@...
   - gestor@...
   - operacional@...

## Critérios de aceite

- Todas as rotas protegidas corretamente por autenticação e perfil.
- Operacional não acessa dados de admin/gestor.
- Importação de planilha robusta com relatório de erro por linha.
- Dashboard retorna dados agregados consistentes e filtráveis.
- Acesso bloqueia/desbloqueia conforme status da assinatura.
- Código limpo, modular e preparado para escalar.