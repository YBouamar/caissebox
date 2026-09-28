import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { parseBody } from '../common/validation';
import { AuthService } from './auth.service';

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const deviceSchema = z.object({
  deviceId: z.string().uuid(),
  secret: z.string().min(20),
  appVersion: z.string().max(32).optional(),
});

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() body: unknown) {
    const { email, password } = parseBody(loginSchema, body);
    return this.auth.login(email, password);
  }

  @Post('device')
  @HttpCode(200)
  device(@Body() body: unknown) {
    const { deviceId, secret, appVersion } = parseBody(deviceSchema, body);
    return this.auth.authenticateDevice(deviceId, secret, appVersion);
  }
}
