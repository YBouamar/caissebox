'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { moveTable } from './actions';

interface T {
  id: string; label: string; seats: number; shape: 'square' | 'round' | 'long'; x: number; y: number; w: number; h: number; active: boolean;
}

/** Plan de salle : glisser une table pour la placer, cliquer pour la modifier. Même disposition que sur la tablette. */
export function FloorEditor({ tables, selected, zoneId }: { tables: T[]; selected?: string; zoneId: string }) {
  const router = useRouter();
  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>({});
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [pending, start] = useTransition();

  const at = (t: T) => pos[t.id] ?? { x: t.x, y: t.y };

  return (
    <div
      className="floor"
      ref={box}
      style={{ height: Math.max(420, ...tables.map((t) => at(t).y + t.h + 24)), opacity: pending ? 0.85 : 1 }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || !box.current) return;
        const r = box.current.getBoundingClientRect();
        const x = Math.round((e.clientX - r.left + box.current.scrollLeft - d.dx) / 8) * 8;
        const y = Math.round((e.clientY - r.top + box.current.scrollTop - d.dy) / 8) * 8;
        d.moved = true;
        setPos((p) => ({ ...p, [d.id]: { x: Math.max(0, x), y: Math.max(0, y) } }));
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        if (!d.moved) {
          router.push(`/salle?zone=${zoneId}&table=${d.id}`);
          return;
        }
        const p = pos[d.id];
        if (p) start(() => moveTable(d.id, p.x, p.y));
      }}
    >
      {tables.length === 0 ? <div className="empty">Ajoutez des tables avec le formulaire de droite.</div> : null}
      {tables.map((t) => {
        const p = at(t);
        return (
          <div
            key={t.id}
            role="button"
            tabIndex={0}
            aria-current={selected === t.id ? 'true' : undefined}
            aria-label={`Table ${t.label}, ${t.seats} places`}
            className={`t${t.shape === 'round' ? ' round' : ''}`}
            style={{ left: p.x, top: p.y, width: t.w, height: t.h, cursor: 'grab', opacity: t.active ? 1 : 0.45, touchAction: 'none', userSelect: 'none' }}
            onPointerDown={(e) => {
              const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
              drag.current = { id: t.id, dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false };
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') router.push(`/salle?zone=${zoneId}&table=${t.id}`);
            }}
          >
            {t.label}
            <small>{t.seats} pl.</small>
          </div>
        );
      })}
    </div>
  );
}
