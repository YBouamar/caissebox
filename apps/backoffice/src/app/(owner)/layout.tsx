import { Brand } from '@/components/Logo';
import { NavEntry, NavLinks } from '@/components/NavLinks';
import { logout } from '@/lib/auth-actions';
import { ownerContext } from '@/lib/owner';

const NAV: NavEntry[] = [
  { href: '/', label: 'Tableau de bord', icon: 'dash', exact: true },
  { href: '/ventes', label: 'Ventes et journées', icon: 'ventes' },
  { href: '/articles', label: 'Articles', icon: 'articles' },
  { href: '/menus', label: 'Menus composés', icon: 'menus' },
  { href: '/clients', label: 'Clients et ardoises', icon: 'clients' },
  { href: '/salle', label: 'Salle et tables', icon: 'salle' },
  { href: '/imprimantes', label: 'Imprimantes', icon: 'imp' },
  { href: '/equipe', label: 'Équipe et PIN', icon: 'users' },
  { href: '/parametres', label: 'Paramètres', icon: 'params' },
];

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const { me } = await ownerContext();
  return (
    <div className="shell">
      <nav className="nav" aria-label="Menu du back-office">
        <Brand />
        <NavLinks items={NAV} />
        <div className="grow" />
        <div className="nav-foot">
          <strong>{me.tenant_name}</strong>
          <span>{me.full_name}</span>
          <form action={logout}>
            <button type="submit">Se déconnecter</button>
          </form>
        </div>
      </nav>
      <div className="main">{children}</div>
    </div>
  );
}
