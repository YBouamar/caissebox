const PATHS = {
  dash: 'M4 13h6V4H4zM14 20h6v-9h-6zM14 4h6v4h-6zM4 20h6v-4H4z',
  ventes: 'M4 19V9M10 19V5M16 19v-7M22 19H2',
  articles: 'M4 7l8-4 8 4-8 4zM4 7v10l8 4 8-4V7M12 11v10',
  menus: 'M4 5h16M4 12h16M4 19h10',
  stock: 'M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5',
  clients: 'M12 12a4 4 0 1 0 0-8a4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  salle: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  imp: 'M7 8V3h10v5M6 17H4v-7h16v7h-2M7 14h10v7H7z',
  users: 'M9 11a4 4 0 1 0 0-8a4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M17 11a3 3 0 1 0 0-6M22 21a6 6 0 0 0-4-5.6',
  params: 'M12 15a3 3 0 1 0 0-6a3 3 0 0 0 0 6zM19 12h2M3 12h2M12 3v2M12 19v2M17 7l1.5-1.5M5.5 18.5L7 17M17 17l1.5 1.5M5.5 5.5L7 7',
  tablet: 'M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2',
  building: 'M4 21V5l8-3 8 3v16M9 21v-5h6v5M8 9h1M15 9h1M8 13h1M15 13h1',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
