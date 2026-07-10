import { Role } from '@prisma/client';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  tokenVersion: number;
  tenantId: string;
  role: Role;
  membershipId: string;
}
