import { inject, injectable } from 'tsyringe';
import {
  CalendarActivityStatus,
  CalendarOverrideType,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { CalendarRangeQuery } from './calendar.schemas';

@injectable()
export class CalendarRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  listActivities(
    tenantId: string,
    query: CalendarRangeQuery,
    scopeAssigneeId?: string,
  ) {
    return this.prisma.calendarActivity.findMany({
      where: {
        tenantId,
        deletedAt: null,
        startsAt: {
          gte: new Date(query.from),
          lte: new Date(query.to),
        },
        ...(query.status ? { status: query.status } : {}),
        ...(scopeAssigneeId
          ? { assigneeId: scopeAssigneeId }
          : query.assigneeId
            ? { assigneeId: query.assigneeId }
            : {}),
      },
      include: {
        assignee: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { startsAt: 'asc' },
    });
  }

  findActivity(id: string, tenantId: string) {
    return this.prisma.calendarActivity.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        assignee: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  createActivity(data: {
    tenantId: string;
    createdById: string;
    title: string;
    description?: string;
    startsAt: Date;
    endsAt?: Date;
    allDay?: boolean;
    status?: CalendarActivityStatus;
    assigneeId?: string | null;
    location?: string;
    color?: string;
    metadata?: Prisma.InputJsonValue;
  }) {
    return this.prisma.calendarActivity.create({
      data: {
        tenantId: data.tenantId,
        createdById: data.createdById,
        title: data.title,
        description: data.description,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        allDay: data.allDay ?? false,
        status: data.status,
        assigneeId: data.assigneeId ?? undefined,
        location: data.location,
        color: data.color,
        metadata: data.metadata,
      },
      include: {
        assignee: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  updateActivity(id: string, data: Prisma.CalendarActivityUpdateInput) {
    return this.prisma.calendarActivity.update({
      where: { id },
      data,
      include: {
        assignee: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  softDeleteActivity(id: string) {
    return this.prisma.calendarActivity.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  listOverrides(tenantId: string, from?: string, to?: string) {
    return this.prisma.calendarOverride.findMany({
      where: {
        tenantId,
        ...(from || to
          ? {
              date: {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: new Date(to) } : {}),
              },
            }
          : {}),
      },
      orderBy: { date: 'asc' },
    });
  }

  upsertOverride(data: {
    tenantId: string;
    createdById: string;
    date: Date;
    type: CalendarOverrideType;
    title?: string | null;
    note?: string | null;
    metadata?: Prisma.InputJsonValue;
  }) {
    return this.prisma.calendarOverride.upsert({
      where: {
        tenantId_date: { tenantId: data.tenantId, date: data.date },
      },
      create: {
        tenantId: data.tenantId,
        createdById: data.createdById,
        date: data.date,
        type: data.type,
        title: data.title,
        note: data.note,
        metadata: data.metadata,
      },
      update: {
        type: data.type,
        title: data.title,
        note: data.note,
        metadata: data.metadata,
      },
    });
  }

  deleteOverride(tenantId: string, date: Date) {
    return this.prisma.calendarOverride.deleteMany({
      where: { tenantId, date },
    });
  }

  /** Ações da base (planilha) com dueDate no período — fonte das datas do calendário. */
  listActionRowsForCalendar(
    tenantId: string,
    from: Date,
    to: Date,
    responsibleId?: string,
  ) {
    return this.prisma.actionPlanRow.findMany({
      where: {
        deletedAt: null,
        dueDate: { gte: from, lte: to },
        actionPlan: { tenantId },
        ...(responsibleId ? { responsibleId } : {}),
      },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        dueDate: true,
        responsibleId: true,
        responsibleName: true,
        unitName: true,
        actionPlan: { select: { id: true, title: true } },
        responsible: { select: { id: true, name: true, email: true } },
      },
      orderBy: { dueDate: 'asc' },
    });
  }

  findActionRow(id: string, tenantId: string) {
    return this.prisma.actionPlanRow.findFirst({
      where: { id, deletedAt: null, actionPlan: { tenantId } },
      select: {
        id: true,
        title: true,
        dueDate: true,
        responsibleId: true,
        status: true,
      },
    });
  }

  listOverlaysForUser(tenantId: string, userId: string, actionRowIds?: string[]) {
    return this.prisma.calendarActionOverlay.findMany({
      where: {
        tenantId,
        userId,
        ...(actionRowIds ? { actionRowId: { in: actionRowIds } } : {}),
      },
    });
  }

  findOverlay(userId: string, actionRowId: string) {
    return this.prisma.calendarActionOverlay.findUnique({
      where: { userId_actionRowId: { userId, actionRowId } },
    });
  }

  upsertActionOverlay(data: {
    tenantId: string;
    userId: string;
    actionRowId: string;
    displayStartsAt?: Date | null;
    displayEndsAt?: Date | null;
    hidden?: boolean;
    note?: string | null;
    color?: string | null;
    metadata?: Prisma.InputJsonValue;
  }) {
    return this.prisma.calendarActionOverlay.upsert({
      where: {
        userId_actionRowId: {
          userId: data.userId,
          actionRowId: data.actionRowId,
        },
      },
      create: {
        tenantId: data.tenantId,
        userId: data.userId,
        actionRowId: data.actionRowId,
        displayStartsAt: data.displayStartsAt ?? undefined,
        displayEndsAt: data.displayEndsAt ?? undefined,
        hidden: data.hidden ?? false,
        note: data.note,
        color: data.color,
        metadata: data.metadata,
      },
      update: {
        displayStartsAt: data.displayStartsAt === undefined ? undefined : data.displayStartsAt,
        displayEndsAt: data.displayEndsAt === undefined ? undefined : data.displayEndsAt,
        hidden: data.hidden,
        note: data.note,
        color: data.color,
        metadata: data.metadata,
      },
    });
  }

  deleteActionOverlay(userId: string, actionRowId: string) {
    return this.prisma.calendarActionOverlay.deleteMany({
      where: { userId, actionRowId },
    });
  }
}
