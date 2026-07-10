# Backend SaaS

API modular em **Node.js + Express + TypeScript** com autenticação JWT, RBAC, importação de planilhas, analytics e billing.

## Stack

- Express + TypeScript
- Prisma + PostgreSQL (Neon)
- JWT (access + refresh) com versionamento/revogação
- Zod, tsyringe, Helmet, rate limit, Pino, Swagger

## Estrutura

```text
src/
  config/
  middlewares/
  modules/
    auth/
    users/
    companies/
    action-plans/
    imports/
    analytics/
    billing/
  shared/
  types/
  routes/
```

## Setup rápido

```bash
cp .env.example .env
# configure DATABASE_URL e JWT_SECRET

npm install
npx prisma migrate dev --name init
npm run seed
npm run dev
```

- API: `http://localhost:3333/api/v1`
- Swagger: `http://localhost:3333/docs`
- Health: `http://localhost:3333/api/v1/health`

## Usuários de seed

| Perfil       | E-mail                 | Senha              |
|-------------|------------------------|--------------------|
| Admin       | admin@saas.local       | Admin@123456       |
| Gestor      | gestor@saas.local      | Gestor@123456      |
| Operacional | operacional@saas.local | Operacional@123456 |

Tenant demo: `demo-company` (assinatura ACTIVE).

## Principais endpoints

### Auth
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET  /api/v1/auth/me`

### Users / Companies / Action plans
- `GET/POST /api/v1/users`
- `GET/POST /api/v1/companies`
- `GET/POST /api/v1/action-plans`

### Imports
- `POST /api/v1/imports/spreadsheet` (multipart `file`)
- `POST /api/v1/imports/spreadsheet/confirm`
- `GET  /api/v1/imports/:id/status`

Colunas obrigatórias da planilha: `titulo`, `status`, `prioridade`, `responsavel`, `unidade`, `prazo` (opcional: `descricao`, `chave`).

### Analytics
- `GET /api/v1/analytics/kpis`
- `GET /api/v1/analytics/monthly`
- `GET /api/v1/analytics/by-unit`
- `GET /api/v1/analytics/by-responsible`
- `GET /api/v1/analytics/adherence`

### Billing
- `GET  /api/v1/billing/plans`
- `POST /api/v1/billing/checkout`
- `POST /api/v1/billing/webhook`
- `GET  /api/v1/billing/subscription`
- `POST /api/v1/billing/portal`

Provider padrão: `BILLING_PROVIDER=mock`. Troque para `stripe` quando tiver chaves.

## RBAC

- **ADMIN**: gestão completa (usuários, empresas, planos, billing)
- **GESTOR**: gestão operacional da própria empresa
- **OPERACIONAL**: apenas próprios dados/ações

Rotas protegidas por JWT + `roleGuard` + regras de domínio nos services. Feature gate de assinatura bloqueia acesso quando status ≠ `ACTIVE`/`TRIALING`.

## Scripts

```bash
npm run dev
npm run build
npm start
npm test
npm run lint
npm run format
npm run migrate
npm run seed
```

## Docker

```bash
docker compose up --build
```

## Exemplo de login

```bash
curl -X POST http://localhost:3333/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@saas.local","password":"Admin@123456"}'
```

## Webhook de billing (mock)

```bash
curl -X POST http://localhost:3333/api/v1/billing/webhook \
  -H 'Content-Type: application/json' \
  -d '{
    "type":"subscription.activated",
    "tenantId":"<TENANT_ID>",
    "externalSubscriptionId":"sub_mock_123",
    "amountCents":9900
  }'
```
