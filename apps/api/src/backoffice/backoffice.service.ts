import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { hashPin, verifyPin } from '@caissebox/shared';
import { DbService } from '../db/db.service';

export interface CreateStaffInput {
  fullName: string;
  initials?: string;
  roleId: string;
  pin: string;
  establishmentIds: string[];
}

/** Back-office du client (propriétaire) : toutes les requêtes passent par la RLS. */
@Injectable()
export class BackofficeService {
  constructor(private readonly db: DbService) {}

  establishments(tenantId: string) {
    return this.db.withTenant({ tenantId }, async (c) => {
      const { rows } = await c.query('SELECT id, name, address, service_mode, kitchen_send_mode, access_state FROM establishments ORDER BY name');
      return rows;
    });
  }

  roles(tenantId: string) {
    return this.db.withTenant({ tenantId }, async (c) => {
      const { rows } = await c.query('SELECT id, name, is_manager, permissions FROM roles ORDER BY is_manager DESC, name');
      return rows;
    });
  }

  staff(tenantId: string) {
    return this.db.withTenant({ tenantId }, async (c) => {
      const { rows } = await c.query(
        `SELECT s.id, s.full_name, s.initials, s.active, r.name AS role,
                coalesce(array_agg(se.establishment_id) FILTER (WHERE se.id IS NOT NULL), '{}') AS establishment_ids
           FROM staff s
           JOIN roles r ON r.id = s.role_id
           LEFT JOIN staff_establishments se ON se.staff_id = s.id
          GROUP BY s.id, r.name
          ORDER BY s.full_name`,
      );
      return rows;
    });
  }

  /**
   * Création d'un membre du personnel. Le PIN doit être unique parmi le
   * personnel actif du client : sur la tablette, le PIN seul identifie la personne.
   */
  async createStaff(tenantId: string, input: CreateStaffInput): Promise<{ staffId: string }> {
    return this.db.withTenant({ tenantId }, async (c) => {
      const role = await c.query('SELECT 1 FROM roles WHERE id = $1', [input.roleId]);
      if (!role.rowCount) throw new NotFoundException('Rôle introuvable');
      const est = await c.query('SELECT id FROM establishments WHERE id = ANY($1::uuid[])', [input.establishmentIds]);
      if (est.rowCount !== new Set(input.establishmentIds).size) throw new NotFoundException('Établissement introuvable');

      const existing = await c.query<{ pin_hash: string | null }>('SELECT pin_hash FROM staff WHERE active');
      if (existing.rows.some((r) => verifyPin(input.pin, r.pin_hash))) {
        throw new ConflictException('Ce code PIN est déjà utilisé par une autre personne');
      }

      const initials = input.initials ?? initialsOf(input.fullName);
      const { rows } = await c.query<{ id: string }>(
        'INSERT INTO staff (tenant_id, role_id, full_name, initials, pin_hash) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [tenantId, input.roleId, input.fullName, initials, hashPin(input.pin)],
      );
      const staffId = rows[0]!.id;
      for (const establishmentId of new Set(input.establishmentIds)) {
        await c.query('INSERT INTO staff_establishments (tenant_id, staff_id, establishment_id) VALUES ($1, $2, $3)', [
          tenantId, staffId, establishmentId,
        ]);
      }
      return { staffId };
    });
  }
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0]![0]}${parts[parts.length - 1]![0]}` : (parts[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}
