import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AllowOnly, AuthGuard } from '../auth/auth.guard';
import { parseBody } from '../common/validation';
import { ConsoleService } from './console.service';

const createTenantSchema = z.object({
  name: z.string().min(1).max(120),
  legalName: z.string().max(200).optional(),
  ice: z.string().regex(/^\d{15}$/, "L'ICE comporte 15 chiffres").optional(),
  address: z.string().max(300).optional(),
  owner: z.object({ email: z.string().email(), fullName: z.string().min(1), password: z.string().min(10) }),
  establishment: z.object({ name: z.string().min(1).max(120), address: z.string().max(300).optional() }),
});
const establishmentSchema = z.object({ name: z.string().min(1).max(120), address: z.string().max(300).optional() });
const deviceSchema = z.object({
  kind: z.enum(['tablet', 'printer', 'drawer']),
  serial: z.string().min(3).max(80),
  model: z.string().max(80).optional(),
  purchasePriceCents: z.number().int().min(0).optional(),
});
const deploySchema = z.object({ establishmentId: z.string().uuid(), label: z.string().max(40).optional() });
const retireSchema = z.object({ status: z.enum(['repair', 'lost', 'retired', 'stock']) });
const accessSchema = z.object({ state: z.enum(['normal', 'warning_manager', 'warning_all', 'refuse_day_open']) });

@Controller('console')
@UseGuards(AuthGuard)
@AllowOnly('operator')
export class ConsoleController {
  constructor(private readonly console: ConsoleService) {}

  @Get('tenants')
  tenants() {
    return this.console.listTenants();
  }

  @Post('tenants')
  createTenant(@Body() body: unknown) {
    return this.console.createTenant(parseBody(createTenantSchema, body));
  }

  @Post('tenants/:id/establishments')
  createEstablishment(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { name, address } = parseBody(establishmentSchema, body);
    return this.console.createEstablishment(id, name, address);
  }

  @Post('devices')
  registerDevice(@Body() body: unknown) {
    return this.console.registerDevice(parseBody(deviceSchema, body));
  }

  @Post('devices/:id/deploy')
  @HttpCode(200)
  deploy(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { establishmentId, label } = parseBody(deploySchema, body);
    return this.console.deployDevice(id, establishmentId, label);
  }

  @Post('devices/:id/retire')
  @HttpCode(200)
  retire(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.console.retireDevice(id, parseBody(retireSchema, body).status);
  }

  @Post('establishments/:id/access')
  @HttpCode(200)
  access(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.console.setAccessState(id, parseBody(accessSchema, body).state);
  }
}
