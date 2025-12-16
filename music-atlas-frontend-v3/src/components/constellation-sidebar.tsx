import Link from 'next/link';
import type { Constellation } from '@/mock/userMap';

type ConstellationSidebarProps = {
  constellations: Constellation[];
  activeId?: string;
};

export const ConstellationSidebar = ({ constellations, activeId }: ConstellationSidebarProps) => {
  return (
    <aside className="card-surface h-fit w-full max-w-xs p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.2em] text-textMuted">Constellations</p>
        <span className="badge bg-white/5 text-textMuted">{constellations.length}</span>
      </div>
      <div className="flex flex-col gap-2">
        {constellations.map((c) => {
          const isActive = c.id === activeId;
          return (
            <Link
              key={c.id}
              href={`/map/${c.id}`}
              className={`flex flex-col rounded-xl border px-3 py-2 transition ${
                isActive
                  ? 'border-accent/60 bg-accent/10 text-textPrimary shadow-inner shadow-accent/30'
                  : 'border-white/5 bg-black/30 text-textMuted hover:border-white/20 hover:text-textPrimary'
              }`}
            >
              <span className="text-sm font-semibold">{c.title}</span>
              <span className="text-xs uppercase tracking-[0.12em] text-white/60">
                {c.seedArtists.slice(0, 2).join(' / ')}
              </span>
            </Link>
          );
        })}
        {constellations.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-sm text-textMuted">
            No constellations yet.
          </div>
        ) : null}
      </div>
    </aside>
  );
};
