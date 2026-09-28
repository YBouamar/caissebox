import { DynamicModule, Module } from '@nestjs/common';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { TokensService } from './auth/tokens.service';
import { BackofficeController } from './backoffice/backoffice.controller';
import { BackofficeService } from './backoffice/backoffice.service';
import { CrudService } from './backoffice/crud.service';
import { ReportsService } from './backoffice/reports.service';
import { APP_CONFIG, AppConfig, loadConfig } from './config';
import { ConsoleController } from './console/console.controller';
import { ConsoleService } from './console/console.service';
import { DbService } from './db/db.service';
import { HealthController } from './health/health.controller';
import { SyncController } from './sync/sync.controller';
import { SyncService } from './sync/sync.service';

@Module({})
export class AppModule {
  static register(config: AppConfig = loadConfig()): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, AuthController, SyncController, ConsoleController, BackofficeController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        DbService,
        TokensService,
        AuthGuard,
        AuthService,
        SyncService,
        ConsoleService,
        BackofficeService,
        CrudService,
        ReportsService,
      ],
    };
  }
}
