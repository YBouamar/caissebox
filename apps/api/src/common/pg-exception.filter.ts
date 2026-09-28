import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';

interface PgError {
  code?: string;
  detail?: string;
  message?: string;
  constraint?: string;
}

/**
 * Traduit les erreurs PostgreSQL des routes back-office et console en réponses
 * HTTP lisibles, au lieu d'une erreur 500 opaque.
 */
@Catch()
export class PgExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (error instanceof HttpException) {
      res.status(error.getStatus()).json(error.getResponse());
      return;
    }
    const pg = error as PgError;
    const map: Record<string, [number, string]> = {
      '23505': [409, 'Cette valeur existe déjà'],
      '23514': [400, 'Valeur refusée par une règle de cohérence'],
      '23502': [400, 'Champ obligatoire manquant'],
      '23503': [400, 'Référence inconnue'],
      '22P02': [400, 'Format de donnée invalide'],
      '42501': [403, 'Accès refusé'],
      P0001: [409, pg.message ?? 'Opération refusée'],
    };
    const hit = pg.code ? map[pg.code] : undefined;
    if (hit) {
      res.status(hit[0]).json({ statusCode: hit[0], message: hit[1], constraint: pg.constraint });
      return;
    }
    console.error(error);
    res.status(500).json({ statusCode: 500, message: 'Erreur interne' });
  }
}
