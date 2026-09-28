import { NextRequest, NextResponse } from 'next/server';

/** Aiguillage : non connecté → /connexion ; opérateur → /console ; propriétaire → back-office. */
export function middleware(req: NextRequest) {
  const token = req.cookies.get('cb_session')?.value;
  const { pathname } = req.nextUrl;
  let role: string | null = null;
  if (token) {
    try {
      const payload = JSON.parse(atob((token.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/'))) as { typ?: string; exp?: number };
      if (payload.exp && payload.exp * 1000 > Date.now()) role = payload.typ ?? null;
    } catch {
      role = null;
    }
  }
  const isLogin = pathname === '/connexion';
  if (!role) return isLogin ? NextResponse.next() : NextResponse.redirect(new URL('/connexion', req.url));
  if (isLogin) return NextResponse.redirect(new URL(role === 'operator' ? '/console' : '/', req.url));
  const inConsole = pathname === '/console' || pathname.startsWith('/console/');
  if (role === 'operator' && !inConsole) return NextResponse.redirect(new URL('/console', req.url));
  if (role === 'owner' && inConsole) return NextResponse.redirect(new URL('/', req.url));
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next|icon.svg|favicon.ico|api/health).*)'] };
