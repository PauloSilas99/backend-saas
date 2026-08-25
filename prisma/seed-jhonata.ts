import 'reflect-metadata';
import dotenv from 'dotenv';
import path from 'path';
import bcrypt from 'bcryptjs';
import { PrismaClient, Role, ActionStatus, ActionPriority, ColumnFieldType, ColumnSemanticRole, SubscriptionStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { streamXlsxZipFile } from './xlsx-zip-stream';
import { normalizeDateValue } from '../src/modules/action-plan-sheets/parse/sheet-cells';
import { pickDueDateFromNamedValues } from '../src/modules/action-plan-sheets/parse/due-date';
import { inferSemanticRole, pickUniqueSemanticRoles } from '../src/modules/columns/column-semantics';
import { buildCells } from '../src/modules/action-plans/row-cells';
import { isBlankPlanRow } from '../src/shared/helpers/plan-row-blank';
import { PRODUCT_LIMITS } from '../src/shared/limits/product-limits';

dotenv.config();

const FILE = path.resolve(__dirname, '../../planilha-base.xlsx');
const HEADER_ROW = 5;
const EMAIL = 'jhonata@saas.local';
const NAME = 'Jhonata';
const PASSWORD = 'jhon123@';
const WHATSAPP = '9888258534';
const TENANT_NAME = 'Avelino e Garces';
const TENANT_SLUG = 'avelino-e-garces';
const BATCH = 40;

const STATUS_MAP: Record<string, ActionStatus> = {
  pending: ActionStatus.PENDING,
  pendente: ActionStatus.PENDING,
  'nao iniciada': ActionStatus.PENDING,
  'não iniciada': ActionStatus.PENDING,
  'em aberto': ActionStatus.PENDING,
  in_progress: ActionStatus.IN_PROGRESS,
  'em andamento': ActionStatus.IN_PROGRESS,
  'no prazo': ActionStatus.IN_PROGRESS,
  completed: ActionStatus.COMPLETED,
  concluido: ActionStatus.COMPLETED,
  concluida: ActionStatus.COMPLETED,
  delayed: ActionStatus.DELAYED,
  atrasado: ActionStatus.DELAYED,
  'em atraso': ActionStatus.DELAYED,
  canceled: ActionStatus.CANCELED,
  cancelled: ActionStatus.CANCELED,
  cancelado: ActionStatus.CANCELED,
  cancelada: ActionStatus.CANCELED,
};

const PRIORITY_MAP: Record<string, ActionPriority> = {
  low: ActionPriority.LOW,
  baixa: ActionPriority.LOW,
  medium: ActionPriority.MEDIUM,
  media: ActionPriority.MEDIUM,
  high: ActionPriority.HIGH,
  alta: ActionPriority.HIGH,
  importante: ActionPriority.HIGH,
  urgente: ActionPriority.CRITICAL,
  critical: ActionPriority.CRITICAL,
  critica: ActionPriority.CRITICAL,
};

function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toColumnName(label: string, index: number): string {
  const cleaned = fold(label)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+/, 'c_')
    .replace(/_+/g, '_')
    .replace(/_+$/g, '')
    .slice(0, 60);
  return cleaned || `c_${index + 1}`;
}

function fieldTypeFor(label: string, name: string): ColumnFieldType {
  const blob = `${name} ${fold(label)}`;
  if (/(data|prazo)/.test(blob)) return ColumnFieldType.DATE;
  if (/valor|r\$|currency/.test(blob)) return ColumnFieldType.CURRENCY;
  if (/status|prioridade|indicador|fase/.test(blob)) return ColumnFieldType.SELECT;
  if (/comentario|acoes|fontes|lesoes|sugestao|evidencia/.test(blob)) {
    return ColumnFieldType.LONG_TEXT;
  }
  return ColumnFieldType.TEXT;
}

function pick(values: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const found = Object.entries(values).find(([label]) => {
      const folded = fold(label).replace(/[^a-z0-9]+/g, ' ').trim();
      return folded === key || folded.startsWith(`${key} `);
    });
    if (found?.[1]?.trim()) return found[1].trim();
  }
  return '';
}

function mapStatus(raw: string): ActionStatus {
  const key = fold(raw).replace(/_/g, ' ');
  return STATUS_MAP[key] ?? ActionStatus.PENDING;
}

function mapPriority(raw: string): ActionPriority {
  const key = fold(raw).replace(/_/g, ' ');
  return PRIORITY_MAP[key] ?? ActionPriority.MEDIUM;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL ausente');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 4,
    statement_timeout: 60_000,
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const starter = await prisma.plan.findFirst({ where: { code: 'starter', isActive: true } });

  const existingUser = await prisma.user.findUnique({ where: { email: EMAIL } });
  let tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });

  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: { name: TENANT_NAME, slug: TENANT_SLUG, document: WHATSAPP, isActive: true },
    });
  } else {
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { name: TENANT_NAME, isActive: true },
    });
  }

  const user = existingUser
    ? await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          name: NAME,
          passwordHash,
          whatsapp: WHATSAPP,
          isActive: true,
          emailVerifiedAt: new Date(),
        },
      })
    : await prisma.user.create({
        data: {
          email: EMAIL,
          name: NAME,
          passwordHash,
          whatsapp: WHATSAPP,
          isActive: true,
          emailVerifiedAt: new Date(),
        },
      });

  await prisma.membership.upsert({
    where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
    update: { role: Role.GERENTE, isActive: true },
    create: { userId: user.id, tenantId: tenant.id, role: Role.GERENTE, isActive: true },
  });

  if (starter) {
    await prisma.subscription.upsert({
      where: { tenantId: tenant.id },
      update: {
        planId: starter.id,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      create: {
        tenantId: tenant.id,
        planId: starter.id,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
  }

  const unit = await prisma.unit.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'São José de Ribamar' } },
    update: {},
    create: { tenantId: tenant.id, name: 'São José de Ribamar', code: 'SJR' },
  });

  let plan = await prisma.actionPlan.findFirst({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: 'asc' },
  });
  if (!plan) {
    plan = await prisma.actionPlan.create({
      data: {
        tenantId: tenant.id,
        ownerId: user.id,
        unitId: unit.id,
        title: 'Plano de ação — PGR Avelino e Garces',
        description: 'Base importada de planilha-base.xlsx',
      },
    });
  }

  const existingRows = await prisma.actionPlanRow.count({
    where: { actionPlanId: plan.id, deletedAt: null },
  });
  if (existingRows > 0) {
    await backfillPlanDates(prisma, plan.id);
    console.log(`Usuário pronto. Plano já tem ${existingRows} linhas — importação ignorada.`);
    console.log(`Login: ${EMAIL} / ${PASSWORD}`);
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  let headers: string[] = [];
  const columnByKey = new Map<string, { id: string; name: string; fieldType: ColumnFieldType }>();
  let imported = 0;
  let skipped = 0;
  let batch: Array<{
    title: string;
    description?: string;
    status: ActionStatus;
    priority: ActionPriority;
    dueDate?: Date;
    responsibleName?: string;
    unitName?: string;
    values: Record<string, string>;
  }> = [];

  async function flush() {
    if (batch.length === 0) return;
    const chunk = batch;
    batch = [];
    await prisma.$transaction(
      async (tx) => {
        for (const row of chunk) {
          await tx.actionPlanRow.create({
            data: {
              actionPlanId: plan!.id,
              unitId: unit.id,
              title: row.title.slice(0, 200),
              description: row.description?.slice(0, 2000),
              status: row.status,
              priority: row.priority,
              dueDate: row.dueDate,
              responsibleName: row.responsibleName,
              unitName: row.unitName,
              cells: buildCells(row.values, columnByKey),
            },
          });
        }
      },
      { timeout: 60_000 },
    );
    imported += chunk.length;
    process.stdout.write(`\rimportadas ${imported} (ignoradas ${skipped})`);
  }

  const result = await streamXlsxZipFile(
    FILE,
    {
      onHeaders(nextHeaders) {
        headers = nextHeaders;
      },
      async onRow(raw) {
        if (columnByKey.size === 0) {
          const seen = new Set<string>();
          const defs = headers.map((label, index) => {
            let name = toColumnName(label, index);
            let n = 2;
            while (seen.has(name)) {
              name = `${toColumnName(label, index).slice(0, 50)}_${n}`;
              n += 1;
            }
            seen.add(name);
            const fieldType = fieldTypeFor(label, name);
            return {
              name,
              label: label.replace(/\s+/g, ' ').slice(0, 120) || `Coluna ${index + 1}`,
              fieldType,
              semanticRole: inferSemanticRole({ name, label, fieldType }),
              sortOrder: index,
            };
          });
          const unique = pickUniqueSemanticRoles(defs);
          for (const col of unique) {
            const created = await prisma.actionColumn.upsert({
              where: {
                actionPlanId_name: { actionPlanId: plan!.id, name: col.name },
              },
              update: {
                label: col.label,
                fieldType: col.fieldType,
                semanticRole: col.semanticRole,
                sortOrder: col.sortOrder,
                isActive: true,
                deletedAt: null,
              },
              create: {
                tenantId: tenant!.id,
                actionPlanId: plan!.id,
                name: col.name,
                label: col.label,
                fieldType: col.fieldType,
                semanticRole: col.semanticRole,
                sortOrder: col.sortOrder,
              },
            });
            columnByKey.set(created.id, created);
            columnByKey.set(created.name, created);
            columnByKey.set(col.label, created);
          }
        }

        const values: Record<string, string> = {};
        for (const [label, rawValue] of Object.entries(raw)) {
          const col = columnByKey.get(label);
          if (!col) continue;
          let value = String(rawValue ?? '').trim();
          if (!value || value === '[object Object]' || /^#(ref|n\/a|value|name|div\/0)!$/i.test(value)) {
            continue;
          }
          if (col.fieldType === ColumnFieldType.DATE) {
            const parsed = normalizeDateValue(value);
            value = parsed.ok ? parsed.value : value;
          }
          values[col.name] = value;
          values[label] = value;
        }

        const title =
          pick(values, ['acoes', 'acao']) ||
          pick(values, ['perigo']) ||
          pick(values, ['atividade']) ||
          pick(values, ['id']) ||
          'Ação importada';

        if (
          isBlankPlanRow({
            title,
            description: pick(values, ['fontes', 'lesoes']),
            responsibleName: pick(values, ['responsavel pela solucao']),
            unitName: pick(values, ['unidade']),
            dueDate: null,
            fieldValues: Object.entries(values).map(([name, value]) => ({
              value,
              column: { name },
            })),
          })
        ) {
          skipped += 1;
          return;
        }

        const dueDate = pickDueDateFromNamedValues(values);

        batch.push({
          title,
          description: pick(values, ['fontes', 'possiveis lesoes']) || undefined,
          status: mapStatus(pick(values, ['status'])),
          priority: mapPriority(pick(values, ['prioridade'])),
          dueDate,
          responsibleName: pick(values, ['responsavel pela solucao']) || undefined,
          unitName: pick(values, ['unidade']) || 'São José de Ribamar',
          values,
        });

        if (batch.length >= BATCH) await flush();
      },
    },
    { headerRowIndex: HEADER_ROW, columnCount: 57 },
  );

  await flush();
  await backfillPlanDates(prisma, plan.id);
  console.log(
    `\nConcluído. Linhas lidas: ${result.totalRows}, gravadas: ${imported}, ignoradas: ${skipped}, truncado: ${result.truncated}`,
  );
  console.log(`Login: ${EMAIL}`);
  console.log(`Senha: ${PASSWORD}`);
  console.log(`WhatsApp: ${WHATSAPP}`);
  console.log(`Empresa: ${TENANT_NAME} (${TENANT_SLUG})`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});

async function backfillPlanDates(
  prisma: PrismaClient,
  planId: string,
): Promise<void> {
  const columns = await prisma.actionColumn.findMany({
    where: { actionPlanId: planId, deletedAt: null },
  });
  if (columns.length === 0) return;

  const unique = pickUniqueSemanticRoles(
    columns.map((col) => ({
      id: col.id,
      semanticRole: inferSemanticRole({
        name: col.name,
        label: col.label,
        fieldType: col.fieldType,
      }),
    })),
  );
  await Promise.all(
    unique.map((col) =>
      prisma.actionColumn.update({
        where: { id: col.id },
        data: { semanticRole: col.semanticRole ?? ColumnSemanticRole.NONE },
      }),
    ),
  );

  const nameById = new Map(columns.map((col) => [col.id, col.name]));
  const rows = await prisma.actionPlanRow.findMany({
    where: { actionPlanId: planId, deletedAt: null },
    select: { id: true, dueDate: true, cells: true },
  });
  let updated = 0;
  for (const row of rows) {
    const cells =
      row.cells && typeof row.cells === 'object' && !Array.isArray(row.cells)
        ? (row.cells as Record<string, unknown>)
        : {};
    const named: Record<string, string> = {};
    for (const [id, value] of Object.entries(cells)) {
      const name = nameById.get(id);
      if (name) named[name] = String(value ?? '');
    }
    const due = pickDueDateFromNamedValues(named);
    if (!due) continue;
    if (row.dueDate && row.dueDate.getTime() === due.getTime()) continue;
    await prisma.actionPlanRow.update({ where: { id: row.id }, data: { dueDate: due } });
    updated += 1;
  }
  console.log(`Datas nativas atualizadas em ${updated} linha(s).`);
}
