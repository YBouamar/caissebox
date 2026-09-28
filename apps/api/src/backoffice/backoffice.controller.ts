import { Body, Controller, ForbiddenException, Get, Post, UseGuards } from '@nestjs/common';
import { isValidPin } from '@caissebox/shared';
import { z } from 'zod';
import { AllowOnly, AuthGuard, CurrentPrincipal } from '../auth/auth.guard';
import { Principal } from '../auth/tokens.service';
import { parseBody } from '../common/validation';
import { BackofficeService } from './backoffice.service';

const staffSchema = z.object({
  fullName: z.string().min(1).max(80),
  initials: z.string().min(1).max(3).optional(),
  roleId: z.string().uuid(),
  pin: z.string().refine(isValidPin, 'Le PIN doit comporter 4 chiffres'),
  establishmentIds: z.array(z.string().uuid()).min(1),
});

function tenantOf(p: Principal): string {
  if (p.typ !== 'owner') throw new ForbiddenException('Réservé au propriétaire');
  return p.tenantId;
}

@Controller('bo')
@UseGuards(AuthGuard)
@AllowOnly('owner')
export class BackofficeController {
  constructor(private readonly bo: BackofficeService) {}

  @Get('establishments')
  establishments(@CurrentPrincipal() p: Principal) {
    return this.bo.establishments(tenantOf(p));
  }

  @Get('roles')
  roles(@CurrentPrincipal() p: Principal) {
    return this.bo.roles(tenantOf(p));
  }

  @Get('staff')
  staff(@CurrentPrincipal() p: Principal) {
    return this.bo.staff(tenantOf(p));
  }

  @Post('staff')
  createStaff(@CurrentPrincipal() p: Principal, @Body() body: unknown) {
    return this.bo.createStaff(tenantOf(p), parseBody(staffSchema, body));
  }
}
