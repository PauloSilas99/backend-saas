# FE API — Base `/api/v1`

```
http://localhost:3333/api/v1
Authorization: Bearer <accessToken>
```

Roles FE → BE: `admin`→PLATFORM_ADMIN | `gerente`→GERENTE | `gestor`→GESTOR | `operacional`→OPERACIONAL | `leitor`→LEITOR  
Aceita minúsculo ou uppercase. Campo `cargo` = alias de `role`.

Swagger: `http://localhost:3333/docs`

---

## Auth
| Método | Rota | O que faz |
|--------|------|-----------|
| POST | `/auth/register` | cria user + empresa |
| POST | `/auth/login` | login → `accessToken` + `refreshToken` |
| POST | `/auth/refresh` | renova tokens `{ refreshToken }` |
| POST | `/auth/logout` | encerra sessão |
| GET | `/auth/me` | usuário + role + tenant |

---

## Empresas / unidades / members
| Método | Rota | O que faz |
|--------|------|-----------|
| GET | `/empresas` | listar |
| POST | `/empresas` | criar (admin\|gerente\|gestor) |
| GET | `/empresas/:id` | detalhe |
| PATCH | `/empresas/:id` | atualizar |
| DELETE | `/empresas/:id` | soft delete |
| GET | `/empresas/:empresaId/unidades` | listar unidades |
| POST | `/empresas/:empresaId/unidades` | criar unidade |
| PATCH | `/unidades/:id` | atualizar unidade |
| DELETE | `/unidades/:id` | soft delete unidade |
| GET | `/empresas/:empresaId/members` | listar members |
| POST | `/empresas/:empresaId/members` | criar (password opcional → `temporaryPassword`) |
| PATCH | `/empresas/:empresaId/members/:id` | atualizar |
| DELETE | `/empresas/:empresaId/members/:id` | desativar |
| PATCH/DELETE | `/empresas/members/:id` | alias member |

Aliases: `/companies`, `/companies/units`, `/users` (`GET ?q=` typeahead).

---

## Action-plan-sheets
| Método | Rota | O que faz |
|--------|------|-----------|
| GET | `/action-plan-sheets` | listar planos |
| GET | `/action-plan-sheets/primary?empresaId=` | plano principal (cria se não existir) |
| POST | `/action-plan-sheets` | criar plano |
| GET | `/action-plan-sheets/:id` | plano + columns + rows |
| PUT | `/action-plan-sheets/:id` | bulk save `{ title?, columns?, rows? }` |
| POST | `/action-plan-sheets/import` | import JSON wizard |
| POST | `/action-plan-sheets/:id/columns` | criar coluna |
| PATCH | `/action-plan-sheets/:id/columns/:columnId` | editar coluna **só por UUID** |
| DELETE | `/action-plan-sheets/:id/columns/:columnId` | soft delete coluna **só por UUID** |
| PUT | `/action-plan-sheets/:id/columns/order` | `{ order: uuid[] }` |
| POST | `/action-plan-sheets/:id/columns/reset` | reset colunas |
| POST | `/action-plan-sheets/:id/rows` | criar row (`values` / `customFields`) |
| PATCH | `/action-plan-sheets/:id/rows/:rowId` | editar row |
| POST | `/action-plan-sheets/:id/rows/:rowId/resolve` | concluir `{ evidence?, completedAt?, comment? }` |

### Rows — DELETE e duplicate
**Não estão em `/action-plan-sheets`.** Use o legado:

| Método | Rota | O que faz |
|--------|------|-----------|
| DELETE | `/action-plans/rows/:rowId` | soft delete (GERENTE\|GESTOR) |
| POST | `/action-plans/rows/:rowId/duplicate` | duplicar (GERENTE\|GESTOR) |

### Columns — UUID vs key
- PATCH/DELETE de coluna: **apenas UUID** (`:columnId`)
- Em `values` das rows: aceita **uuid ou `name`** da coluna

### Import JSON
```http
POST /action-plan-sheets/import
{ "empresaId?", "title", "columns": [], "rows": [], "options?": { "replaceExisting?" } }
→ { planId, imported, skipped, issues[] }
```

Legado arquivo/jobs: `/imports`, `/columns` global.

---

## Riscos + controls
| Método | Rota |
|--------|------|
| GET | `/risks/stats` |
| GET | `/risks/matrix` |
| GET/POST | `/risks` |
| GET/PATCH/DELETE | `/risks/:id` |
| GET/POST | `/risks/:id/action-controls` |
| PATCH/DELETE | `/risks/:id/action-controls/:controlId` |

---

## Calendar (híbrido)

**Regra:** datas oficiais vêm da base (ações/planilha `dueDate`).  
Remarcar no calendário é **overlay pessoal** → **não altera** a planilha.

### Agenda
```http
GET /calendar?from=2026-08-01T00:00:00.000Z&to=2026-08-31T23:59:59.000Z
# opcional: &assigneeId=<uuid>
```

Resposta:
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "source": "action",
        "actionRowId": "uuid",
        "title": "Auditar estoque",
        "baseDueDate": "2026-08-10T00:00:00.000Z",
        "startsAt": "2026-08-12T00:00:00.000Z",
        "hasPersonalOverride": true,
        "overlay": { "displayStartsAt": "...", "note": "...", "hidden": false }
      },
      {
        "source": "personal",
        "id": "uuid",
        "title": "Reunião 1:1",
        "startsAt": "2026-08-15T14:00:00.000Z"
      }
    ],
    "overrides": [],
    "meta": { "note": "..." }
  }
}
```

- `source: "action"` → da planilha; `startsAt` = overlay ou `baseDueDate`
- `source: "personal"` → evento livre do usuário
- padrão: ações do usuário logado; gestor/gerente pode filtrar `assigneeId`

### Overlay pessoal (sem write-back)
```http
PUT /calendar/actions/:actionRowId/overlay
{
  "displayStartsAt": "2026-08-20T00:00:00.000Z",
  "displayEndsAt": null,
  "hidden": false,
  "note": "adiado só pra mim",
  "color": "#3b82f6"
}
→ { ..., "baseDueDate": "...", "writesToBase": false }
```

```http
DELETE /calendar/actions/:actionRowId/overlay
→ volta a usar dueDate oficial da base
```

### Atividades livres
| Método | Rota |
|--------|------|
| GET | `/calendar/activities?from=&to=` |
| POST | `/calendar/activities` |
| GET/PATCH/DELETE | `/calendar/activities/:id` |

### Overrides de dia (empresa — bloqueio/feriado/nota)
| Método | Rota |
|--------|------|
| GET | `/calendar/overrides?from=YYYY-MM-DD&to=YYYY-MM-DD` |
| PUT | `/calendar/overrides` `{ overrides: [{ date, type, title?, note? }] }` |
| POST | `/calendar/overrides` |
| DELETE | `/calendar/overrides/:date` |

`type`: `BLOCKED` \| `NOTE` \| `HOLIDAY` \| `CUSTOM`

### Legado
`GET /action-plans/calendar?from=&to=` — só dueDate das ações, **sem** overlay pessoal.

---

## Changelog FE (importante)

1. **Calendar híbrido** — usar `/calendar` (não só `/action-plans/calendar`)
2. Remarcar data = `PUT .../overlay` (`writesToBase: false`)
3. Columns PATCH/DELETE = **UUID only**; `values` aceita uuid ou `name`
4. Rows DELETE/duplicate = hoje só em `/action-plans/rows/:rowId`
5. Roles FE em minúsculo + `cargo` aceitos
6. Members: password opcional → `temporaryPassword` na resposta
