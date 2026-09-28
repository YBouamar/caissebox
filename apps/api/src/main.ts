import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { loadConfig } from './config';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config), { bodyParser: false });
  // Un lot de 500 opérations tient largement dans 5 Mo.
  app.useBodyParser('json', { limit: '5mb' });
  app.enableShutdownHooks();
  app.enableCors({ origin: process.env.CORS_ORIGIN?.split(',') ?? false });
  await app.listen(config.PORT, '0.0.0.0');
  console.log(`CaisseBox API à l'écoute sur le port ${config.PORT}`);
}

void bootstrap();
