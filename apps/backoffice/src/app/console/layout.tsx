import { Brand } from '@/components/Logo';
import { NavEntry, NavLinks } from '@/components/NavLinks';
import { logout } from '@/lib/auth-actions';

const NAV: NavEntry[] = [
  { href: '/console', label: 'Clients', icon: 'building', exact: true, also: ['/console/clients'] },
  { href: '/console/parc', label: 'Parc matériel', icon: 'tablet' },
];

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <nav className="nav" aria-label="Menu de la console">
        <Brand href="/console" />
        <span className="console-tag">CONSOLE BACYBRAINS</span>
        <NavLinks items={NAV} />
        <div className="grow" />
        <div className="nav-foot">
          <strong>Opérateur</strong>
          <form action={logout}>
            <button type="submit">Se déconnecter</button>
          </form>
        </div>
      </nav>
      <div className="main">{children}</div>
    </div>
  );
}
