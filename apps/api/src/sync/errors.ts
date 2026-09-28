import { SyncErrorCode } from '@caissebox/shared';

/** Refus d'une opération de synchronisation, renvoyé tel quel à la tablette. */
export class SyncRuleError extends Error {
  constructor(
    readonly code: SyncErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const rule = (message: string) => new SyncRuleError('BUSINESS_RULE', message);

interface PgError {
  code?: string;
  message?: string;
  detail?: string;
}

/** Traduit une erreur PostgreSQL en code de rejet stable. */
export function classifyError(error: unknown): { code: SyncErrorCode; message: string } {
  if (error instanceof SyncRuleError) return { code: error.code, message: error.message };
  const pg = error as PgError;
  const message = pg.message ?? 'Erreur inconnue';
  switch (pg.code) {
    case '23505':
      return { code: 'CONFLICT', message: pg.detail ?? message };
    case '23514':
    case '23502':
      return { code: 'BUSINESS_RULE', message };
    case '23503':
      return { code: 'INVALID', message: `Référence inconnue : ${pg.detail ?? message}` };
    case '22P02':
    case '22007':
    case '22008':
    case '22003':
    case '42804':
      return { code: 'INVALID', message };
    case '42501':
      return { code: 'INVALID', message: 'Ligne hors du périmètre de cette tablette' };
    default:
      return { code: 'INVALID', message };
  }
}

/** Erreurs de connexion : on n'en fait pas un rejet, la tablette réessaiera. */
export function isTransient(error: unknown): boolean {
  const code = (error as PgError).code ?? '';
  return code.startsWith('08') || code === '57P01' || code === '40001' || code === '40P01';
}
