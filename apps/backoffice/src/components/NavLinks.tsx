'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, IconName } from './Icon';

export interface NavEntry {
  href: string;
  label: string;
  icon: IconName;
  exact?: boolean;
  also?: string[];
}

export function NavLinks({ items }: { items: NavEntry[] }) {
  const path = usePathname();
  return (
    <>
      {items.map((n) => {
        const active =
          (n.exact ? path === n.href : path === n.href || path.startsWith(`${n.href}/`)) || (n.also ?? []).some((a) => path.startsWith(a));
        return (
          <Link key={n.href} href={n.href} className="item" aria-current={active ? 'page' : undefined}>
            <Icon name={n.icon} />
            {n.label}
          </Link>
        );
      })}
    </>
  );
}
