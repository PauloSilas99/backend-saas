import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

export const PERIOD_DATE_COLUMN_KEYS = [
  'data_ocorrencia',
  'data_fim',
  'data_inicio',
  'data_criacao',
  'data_conclusao',
  'data_prox_verificacao',
  'data_verificacao',
] as const;

export type PeriodFilter = { years: string[]; month: string };

const MAX_YEARS = 40;
const EXCEL_EPOCH = '1899-12-30';
const EXCEL_SERIAL_MIN = 20000;
const EXCEL_SERIAL_MAX = 80000;

export function parsePeriodParam(raw: unknown): PeriodFilter | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const candidate = parsed as { years?: unknown; month?: unknown };
  const years = Array.isArray(candidate.years)
    ? candidate.years
        .filter((year): year is string => typeof year === 'string' && /^\d{4}$/.test(year.trim()))
        .map((year) => year.trim())
        .slice(0, MAX_YEARS)
    : [];

  const rawMonth = typeof candidate.month === 'string' ? candidate.month.trim() : '';
  const month = /^(0[1-9]|1[0-2])$/.test(rawMonth) ? rawMonth : 'all';

  if (years.length === 0 && month === 'all') return null;
  return { years, month };
}

function parsedDateSql(cellSql: Prisma.Sql): Prisma.Sql {
  const bruto = Prisma.sql`btrim(${cellSql})`;
  const brPartes = Prisma.sql`regexp_match(${bruto}, '^([0-9]{1,2})[/.-]([0-9]{1,2})[/.-]([0-9]{2,4})')`;
  const brIso = Prisma.sql`(
    CASE
      WHEN length((${brPartes})[3]) < 3 THEN lpad((2000 + (${brPartes})[3]::int)::text, 4, '0')
      ELSE lpad((${brPartes})[3], 4, '0')
    END
    || '-' || lpad((${brPartes})[2], 2, '0')
    || '-' || lpad((${brPartes})[1], 2, '0')
  )`;
  const serial = Prisma.sql`replace(${bruto}, ',', '.')`;

  return Prisma.sql`(
    CASE
      WHEN ${bruto} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
           AND pg_input_is_valid(left(${bruto}, 10), 'date')
        THEN left(${bruto}, 10)::date
      WHEN ${brPartes} IS NOT NULL AND pg_input_is_valid(${brIso}, 'date')
        THEN ${brIso}::date
      WHEN ${bruto} ~ '^[0-9]+([.,][0-9]+)?$'
           AND ${serial}::numeric BETWEEN ${EXCEL_SERIAL_MIN} AND ${EXCEL_SERIAL_MAX}
        THEN DATE ${Prisma.raw(`'${EXCEL_EPOCH}'`)} + round(${serial}::numeric)::int
      ELSE NULL
    END
  )`;
}

function matchesPeriodSql(dateSql: Prisma.Sql, period: PeriodFilter): Prisma.Sql {
  const partes: Prisma.Sql[] = [];

  if (period.years.length > 0) {
    partes.push(
      Prisma.sql`to_char(${dateSql}, 'YYYY') IN (${Prisma.join(period.years)})`,
    );
  }
  if (period.month !== 'all') {
    partes.push(Prisma.sql`to_char(${dateSql}, 'MM') = ${period.month}`);
  }

  if (partes.length === 0) return Prisma.sql`true`;
  return Prisma.join(partes, ' AND ');
}

export function buildPeriodFilterSql(
  columnIds: string[],
  period: PeriodFilter | null,
): Prisma.Sql {
  if (!period || columnIds.length === 0) return Prisma.empty;

  const celula = Prisma.sql`r.cells ->> pc.col_id`;
  const data = parsedDateSql(celula);

  return Prisma.sql`AND (
    SELECT CASE
      WHEN count(d.dt) = 0 THEN true
      ELSE bool_or(${matchesPeriodSql(Prisma.sql`d.dt`, period)})
    END
    FROM unnest(ARRAY[${Prisma.join(columnIds)}]::text[]) AS pc(col_id)
    CROSS JOIN LATERAL (SELECT ${data} AS dt) d
  )`;
}

export function periodFilterCacheTag(period: PeriodFilter | null): string {
  if (!period) return '';

  const normalized = `${[...period.years].sort().join('|')}@${period.month}`;
  return createHash('sha1').update(normalized).digest('hex').slice(0, 16);
}
