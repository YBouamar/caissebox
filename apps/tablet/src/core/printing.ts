import type { Sql } from './sql';

export interface PrinterTarget {
  id: string;
  name: string;
  connection: 'bluetooth' | 'wifi';
  address: string;
  port: number;
}

/** Envoi brut d'octets ESC/POS à une imprimante (module natif, ou simulateur en test). */
export interface PrintTransport {
  send(printer: PrinterTarget, bytes: Uint8Array, timeoutMs: number): Promise<void>;
}

export interface PrintJob {
  id: string;
  printerId: string;
  label: string;
  state: 'queued' | 'printing' | 'failed' | 'done';
  attempts: number;
  lastError: string | null;
  createdAt: string;
  kitchenTicketId: string | null;
}

const MAX_ATTEMPTS = 3;

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
}

function fromBase64(b64: string): Uint8Array {
  const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * File d'impression persistante. Un ticket n'est jamais perdu : il reste en file
 * tant qu'il n'est pas imprimé. Chaque imprimante est servie dans l'ordre ; une
 * imprimante en panne ne bloque pas les autres. Après 3 échecs, le travail passe
 * « en échec » et la tablette le signale (réessayer ou changer d'imprimante).
 */
export class PrintQueue {
  private busy = new Set<string>();
  private listeners = new Set<() => void>();

  constructor(
    private readonly sql: Sql,
    private readonly transport: PrintTransport,
    private readonly printerOf: (id: string) => PrinterTarget | undefined,
    private readonly opts: { uuid: () => string; now?: () => Date; onKitchenTicket?: (ticketId: string, status: 'printed' | 'failed') => Promise<void>; timeoutMs?: number; retryDelayMs?: number } ,
  ) {}

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  async enqueue(jobs: { printerId: string; label: string; bytes: Uint8Array; kitchenTicketId?: string }[]): Promise<void> {
    const at = (this.opts.now?.() ?? new Date()).toISOString();
    await this.sql.transaction(async (tx) => {
      for (const j of jobs) {
        await tx.run('INSERT INTO print_jobs (id, printer_id, label, payload, kitchen_ticket_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
          this.opts.uuid(), j.printerId, j.label, toBase64(j.bytes), j.kitchenTicketId ?? null, at,
        ]);
      }
    });
    this.notify();
    for (const printerId of new Set(jobs.map((j) => j.printerId))) void this.drain(printerId);
  }

  async jobs(): Promise<PrintJob[]> {
    const rows = await this.sql.all<{ id: string; printer_id: string; label: string; state: PrintJob['state']; attempts: number; last_error: string | null; created_at: string; kitchen_ticket_id: string | null }>(
      "SELECT id, printer_id, label, state, attempts, last_error, created_at, kitchen_ticket_id FROM print_jobs WHERE state <> 'done' ORDER BY created_at",
    );
    return rows.map((r) => ({ id: r.id, printerId: r.printer_id, label: r.label, state: r.state, attempts: r.attempts, lastError: r.last_error, createdAt: r.created_at, kitchenTicketId: r.kitchen_ticket_id }));
  }

  /** Relance les travaux en file ou en échec (au démarrage, ou sur « Réessayer »). */
  async resume(printerId?: string): Promise<void> {
    await this.sql.run(`UPDATE print_jobs SET state = 'queued', attempts = 0 WHERE state IN ('failed', 'printing')${printerId ? ' AND printer_id = ?' : ''}`, printerId ? [printerId] : []);
    const printers = await this.sql.all<{ printer_id: string }>("SELECT DISTINCT printer_id FROM print_jobs WHERE state = 'queued'");
    this.notify();
    await Promise.all(printers.map((p) => this.drain(p.printer_id)));
  }

  /** Envoie les travaux d'une imprimante vers une autre (imprimante cuisine en panne). */
  async reroute(fromPrinterId: string, toPrinterId: string): Promise<void> {
    await this.sql.run("UPDATE print_jobs SET printer_id = ?, state = 'queued', attempts = 0 WHERE printer_id = ? AND state IN ('queued', 'failed')", [toPrinterId, fromPrinterId]);
    this.notify();
    await this.drain(toPrinterId);
  }

  async cancel(jobId: string): Promise<void> {
    await this.sql.run("UPDATE print_jobs SET state = 'done', last_error = 'Annulé' WHERE id = ?", [jobId]);
    this.notify();
  }

  async purgeDone(olderThanIso: string): Promise<void> {
    await this.sql.run("DELETE FROM print_jobs WHERE state = 'done' AND created_at < ?", [olderThanIso]);
  }

  private async drain(printerId: string): Promise<void> {
    if (this.busy.has(printerId)) return;
    this.busy.add(printerId);
    try {
      for (;;) {
        const job = await this.sql.first<{ id: string; payload: string; attempts: number; kitchen_ticket_id: string | null }>(
          "SELECT id, payload, attempts, kitchen_ticket_id FROM print_jobs WHERE printer_id = ? AND state = 'queued' ORDER BY created_at, rowid LIMIT 1",
          [printerId],
        );
        if (!job) return;
        const printer = this.printerOf(printerId);
        await this.sql.run("UPDATE print_jobs SET state = 'printing' WHERE id = ?", [job.id]);
        this.notify();
        try {
          if (!printer) throw new Error('Imprimante supprimée ou désactivée');
          await this.transport.send(printer, fromBase64(job.payload), this.opts.timeoutMs ?? 8000);
          if (job.kitchen_ticket_id) await this.opts.onKitchenTicket?.(job.kitchen_ticket_id, 'printed').catch(() => undefined);
          await this.sql.run("UPDATE print_jobs SET state = 'done', attempts = attempts + 1, last_error = NULL WHERE id = ?", [job.id]);
        } catch (error) {
          const attempts = job.attempts + 1;
          const failed = attempts >= MAX_ATTEMPTS;
          await this.sql.run('UPDATE print_jobs SET state = ?, attempts = ?, last_error = ? WHERE id = ?', [
            failed ? 'failed' : 'queued', attempts, (error as Error).message ?? 'Erreur', job.id,
          ]);
          this.notify();
          if (failed) {
            if (job.kitchen_ticket_id) await this.opts.onKitchenTicket?.(job.kitchen_ticket_id, 'failed').catch(() => undefined);
            // On n'imprime pas la suite dans le désordre : les travaux suivants attendent la relance.
            return;
          }
          await new Promise((r) => setTimeout(r, (this.opts.retryDelayMs ?? 1500) * attempts));
        }
        this.notify();
      }
    } finally {
      this.busy.delete(printerId);
    }
  }
}
