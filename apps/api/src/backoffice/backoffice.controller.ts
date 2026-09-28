import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { isValidPin } from '@caissebox/shared';
import { z } from 'zod';
import { AllowOnly, AuthGuard, CurrentPrincipal } from '../auth/auth.guard';
import { Principal } from '../auth/tokens.service';
import { PgExceptionFilter } from '../common/pg-exception.filter';
import { parseBody } from '../common/validation';
import { BackofficeService } from './backoffice.service';
import { CrudService } from './crud.service';
import { ReportsService } from './reports.service';

const pin = z.string().refine(isValidPin, 'Le PIN doit comporter 4 chiffres');
const staffSchema = z.object({
  fullName: z.string().trim().min(1).max(80),
  initials: z.string().trim().min(1).max(3).optional(),
  roleId: z.string().uuid(),
  pin,
  establishmentIds: z.array(z.string().uuid()).min(1),
});
const staffUpdateSchema = z.object({
  fullName: z.string().trim().min(1).max(80).optional(),
  initials: z.string().trim().min(1).max(3).optional(),
  roleId: z.string().uuid().optional(),
  active: z.boolean().optional(),
  establishmentIds: z.array(z.string().uuid()).min(1).optional(),
});
const establishmentSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    address: z.string().max(300).nullable(),
    receipt_header: z.string().max(500).nullable(),
    receipt_footer: z.string().max(300).nullable(),
    service_mode: z.enum(['counter', 'waiter_pays', 'both']),
    kitchen_send_mode: z.enum(['manual', 'auto']),
  })
  .partial();
const establishmentQuery = z.object({ establishmentId: z.string().uuid() });

function ownerOf(p: Principal): { tenantId: string; userId: string } {
  if (p.typ !== 'owner') throw new ForbiddenException('Réservé au propriétaire');
  return { tenantId: p.tenantId, userId: p.userId };
}

@Controller('bo')
@UseGuards(AuthGuard)
@UseFilters(PgExceptionFilter)
@AllowOnly('owner')
export class BackofficeController {
  constructor(
    private readonly bo: BackofficeService,
    private readonly crud: CrudService,
    private readonly reports: ReportsService,
  ) {}

  @Get('me')
  me(@CurrentPrincipal() p: Principal) {
    const { tenantId, userId } = ownerOf(p);
    return this.bo.me(tenantId, userId);
  }

  @Get('establishments')
  establishments(@CurrentPrincipal() p: Principal) {
    return this.bo.establishments(ownerOf(p).tenantId);
  }

  @Patch('establishments/:id')
  updateEstablishment(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.bo.updateEstablishment(ownerOf(p).tenantId, id, parseBody(establishmentSchema, body));
  }

  @Get('dashboard')
  dashboard(@CurrentPrincipal() p: Principal, @Query() q: unknown) {
    return this.bo.dashboard(ownerOf(p).tenantId, parseBody(establishmentQuery, q).establishmentId);
  }

  @Get('reports/days')
  days(@CurrentPrincipal() p: Principal, @Query() q: unknown) {
    return this.reports.days(ownerOf(p).tenantId, parseBody(establishmentQuery, q).establishmentId);
  }

  @Get('reports/days/:id')
  day(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.reports.day(ownerOf(p).tenantId, id);
  }

  @Get('roles')
  roles(@CurrentPrincipal() p: Principal) {
    return this.bo.roles(ownerOf(p).tenantId);
  }

  @Patch('roles/:id')
  updateRole(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { permissions } = parseBody(z.object({ permissions: z.record(z.union([z.boolean(), z.number()])) }), body);
    return this.bo.updateRole(ownerOf(p).tenantId, id, permissions);
  }

  @Get('staff')
  staff(@CurrentPrincipal() p: Principal) {
    return this.bo.staff(ownerOf(p).tenantId);
  }

  @Post('staff')
  createStaff(@CurrentPrincipal() p: Principal, @Body() body: unknown) {
    return this.bo.createStaff(ownerOf(p).tenantId, parseBody(staffSchema, body));
  }

  @Patch('staff/:id')
  updateStaff(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.bo.updateStaff(ownerOf(p).tenantId, id, parseBody(staffUpdateSchema, body));
  }

  @Put('staff/:id/pin')
  setPin(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.bo.setPin(ownerOf(p).tenantId, id, parseBody(z.object({ pin }), body).pin);
  }

  @Get('customers')
  customers(@CurrentPrincipal() p: Principal) {
    return this.bo.customers(ownerOf(p).tenantId);
  }

  @Get('customers/:id/ledger')
  ledger(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.bo.ledger(ownerOf(p).tenantId, id);
  }

  @Post('customers/:id/settlements')
  settle(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parseBody(
      z.object({ amountCents: z.number().int().positive().max(100_000_000), paymentMethodId: z.string().uuid(), note: z.string().max(200).optional() }),
      body,
    );
    return this.bo.settle(ownerOf(p).tenantId, id, input);
  }

  // Catalogue, salle, paramètres : CRUD générique (voir resources.ts).

  @Get('r/:resource')
  list(@CurrentPrincipal() p: Principal, @Param('resource') resource: string, @Query() q: Record<string, unknown>) {
    return this.crud.list(ownerOf(p).tenantId, resource, q);
  }

  @Post('r/:resource')
  create(@CurrentPrincipal() p: Principal, @Param('resource') resource: string, @Body() body: unknown) {
    return this.crud.create(ownerOf(p).tenantId, resource, body);
  }

  @Patch('r/:resource/:id')
  update(
    @CurrentPrincipal() p: Principal,
    @Param('resource') resource: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.crud.update(ownerOf(p).tenantId, resource, id, body);
  }

  @Delete('r/:resource/:id')
  remove(@CurrentPrincipal() p: Principal, @Param('resource') resource: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.crud.remove(ownerOf(p).tenantId, resource, id);
  }
}
