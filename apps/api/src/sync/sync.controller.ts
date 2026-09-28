import { Body, Controller, ForbiddenException, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { MAX_CHANGES_PER_PULL, pushRequestSchema } from '@caissebox/shared';
import { z } from 'zod';
import { AllowOnly, AuthGuard, CurrentPrincipal } from '../auth/auth.guard';
import { Principal } from '../auth/tokens.service';
import { parseBody } from '../common/validation';
import { DeviceScope, SyncService } from './sync.service';

const pullQuery = z.object({
  cursor: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(MAX_CHANGES_PER_PULL).default(MAX_CHANGES_PER_PULL),
});

function scopeOf(p: Principal): DeviceScope {
  if (p.typ !== 'device') throw new ForbiddenException('Réservé aux tablettes');
  return { tenantId: p.tenantId, establishmentId: p.establishmentId, deviceId: p.deviceId };
}

@Controller('sync')
@UseGuards(AuthGuard)
@AllowOnly('device')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post('push')
  @HttpCode(200)
  push(@CurrentPrincipal() p: Principal, @Body() body: unknown) {
    const { ops } = parseBody(pushRequestSchema, body);
    return this.sync.push(scopeOf(p), ops);
  }

  @Get('pull')
  pull(@CurrentPrincipal() p: Principal, @Query() query: unknown) {
    const { cursor, limit } = parseBody(pullQuery, query);
    return this.sync.pull(scopeOf(p), cursor, limit);
  }

  @Get('snapshot')
  snapshot(@CurrentPrincipal() p: Principal) {
    return this.sync.snapshot(scopeOf(p));
  }
}
