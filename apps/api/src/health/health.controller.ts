import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DbService } from '../db/db.service';

@Controller()
export class HealthController {
  constructor(private readonly db: DbService) {}

  /** Page d'accueil : confirme qu'on parle bien à l'API (le back-office est sur un autre port). */
  @Get()
  root() {
    return { service: 'CaisseBox API', status: 'ok', info: 'Adresse à saisir telle quelle sur la tablette. Le back-office et la console sont servis à part (port 3001 en local).' };
  }

  @Get('health')
  async check() {
    try {
      await this.db.pool.query('SELECT 1');
      return { status: 'ok', time: new Date().toISOString() };
    } catch {
      throw new ServiceUnavailableException({ status: 'db_unreachable' });
    }
  }
}
