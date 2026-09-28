import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { parseBody } from '../common/validation';
import { DbService } from '../db/db.service';
import { ResourceDef, RESOURCES } from './resources';

type Row = Record<string, unknown>;

function resourceOf(name: string): ResourceDef {
  const def = RESOURCES[name];
  if (!def) throw new NotFoundException(`Ressource inconnue : ${name}`);
  return def;
}

/** Vérifie sous RLS que chaque identifiant référencé appartient bien au client. */
async function checkRefs(c: PoolClient, def: ResourceDef, data: Row): Promise<void> {
  for (const [column, table] of Object.entries(def.refs)) {
    const value = data[column];
    if (value === undefined || value === null) continue;
    const { rowCount } = await c.query(`SELECT 1 FROM ${table} WHERE id = $1`, [value]);
    if (!rowCount) throw new BadRequestException(`${column} : référence inconnue`);
  }
}

/** Règles propres à certaines ressources, avant écriture. */
async function beforeWrite(c: PoolClient, def: ResourceDef, data: Row, id?: string): Promise<void> {
  if (def.table === 'tax_rates' && data.is_default === true) {
    await c.query('UPDATE tax_rates SET is_default = false WHERE is_default AND id IS DISTINCT FROM $1', [id ?? null]);
  }
  if (def.table === 'items') {
    // Imprimante propre à l'article : printer_mode et printer_id vont ensemble.
    if (data.printer_mode !== undefined && data.printer_mode !== 'printer') data.printer_id = null;
  }
  if (def.table === 'dining_tables' && data.zone_id) {
    const z = await c.query<{ establishment_id: string }>('SELECT establishment_id FROM zones WHERE id = $1', [data.zone_id]);
    const est = data.establishment_id ?? (id ? (await c.query('SELECT establishment_id FROM dining_tables WHERE id = $1', [id])).rows[0]?.establishment_id : undefined);
    if (z.rows[0]?.establishment_id !== est) throw new BadRequestException('La zone appartient à un autre établissement');
  }
  if (def.table === 'customers' && id) {
    const cur = await c.query<{ is_default: boolean }>('SELECT is_default FROM customers WHERE id = $1', [id]);
    if (cur.rows[0]?.is_default && data.archived === true) throw new BadRequestException('« Client divers » ne peut pas être archivé');
  }
}

@Injectable()
export class CrudService {
  constructor(private readonly db: DbService) {}

  list(tenantId: string, resource: string, query: Record<string, unknown>) {
    const def = resourceOf(resource);
    const where: string[] = [];
    const params: unknown[] = [];
    for (const f of def.filters) {
      const v = query[f];
      if (typeof v !== 'string' || v === '') continue;
      if (v === 'null') {
        where.push(`${f} IS NULL`);
      } else {
        params.push(v);
        where.push(`${f} = $${params.length}`);
      }
    }
    const sql = `SELECT * FROM ${def.table}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY ${def.orderBy}`;
    return this.db.withTenant({ tenantId }, async (c) => (await c.query(sql, params)).rows);
  }

  create(tenantId: string, resource: string, body: unknown) {
    const def = resourceOf(resource);
    const data: Row = { ...parseBody(def.create, body) };
    return this.db.withTenant({ tenantId }, async (c) => {
      await checkRefs(c, def, data);
      await beforeWrite(c, def, data);
      const row: Row = { ...data, tenant_id: tenantId };
      const cols = Object.keys(row);
      const { rows } = await c.query(
        `INSERT INTO ${def.table} (${cols.map((k) => `"${k}"`).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
        cols.map((k) => row[k]),
      );
      return rows[0];
    });
  }

  update(tenantId: string, resource: string, id: string, body: unknown) {
    const def = resourceOf(resource);
    const data: Row = { ...parseBody(def.update, body) };
    if (Object.keys(data).length === 0) throw new BadRequestException('Aucune modification');
    return this.db.withTenant({ tenantId }, async (c) => {
      const exists = await c.query(`SELECT 1 FROM ${def.table} WHERE id = $1 FOR UPDATE`, [id]);
      if (!exists.rowCount) throw new NotFoundException('Élément introuvable');
      await checkRefs(c, def, data);
      await beforeWrite(c, def, data, id);
      const cols = Object.keys(data);
      const { rows } = await c.query(
        `UPDATE ${def.table} SET ${cols.map((k, i) => `"${k}" = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`,
        [id, ...cols.map((k) => data[k])],
      );
      return rows[0];
    });
  }

  remove(tenantId: string, resource: string, id: string) {
    const def = resourceOf(resource);
    if (!def.deletable) throw new BadRequestException('Suppression impossible : archivez ou désactivez cet élément');
    return this.db.withTenant({ tenantId }, async (c) => {
      if (def.table === 'menu_steps') await c.query('DELETE FROM menu_step_choices WHERE step_id = $1', [id]);
      const { rowCount } = await c.query(`DELETE FROM ${def.table} WHERE id = $1`, [id]);
      if (!rowCount) throw new NotFoundException('Élément introuvable');
      return { deleted: id };
    });
  }
}
