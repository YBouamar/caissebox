import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Principal, TokensService } from './tokens.service';

const ALLOWED = 'caissebox:allowed-principals';

/** Restreint une route à certains types d'appelants (tablette, propriétaire, opérateur). */
export const AllowOnly = (...types: Principal['typ'][]) => SetMetadata(ALLOWED, types);

export const CurrentPrincipal = createParamDecorator((_: unknown, ctx: ExecutionContext): Principal => {
  return ctx.switchToHttp().getRequest<Request & { principal: Principal }>().principal;
});

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokensService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const allowed = this.reflector.getAllAndOverride<Principal['typ'][] | undefined>(ALLOWED, [ctx.getHandler(), ctx.getClass()]);
    if (!allowed) return true;
    const req = ctx.switchToHttp().getRequest<Request & { principal?: Principal }>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new UnauthorizedException('Authentification requise');
    const principal = await this.tokens.verify(token);
    if (!allowed.includes(principal.typ)) throw new ForbiddenException('Accès non autorisé pour ce type de compte');
    req.principal = principal;
    return true;
  }
}
