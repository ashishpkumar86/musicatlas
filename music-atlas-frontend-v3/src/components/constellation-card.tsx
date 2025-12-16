import Link from 'next/link';
import { TagPills } from './tag-pills';
import type { Constellation } from '@/mock/userMap';

type ConstellationCardProps = {
  constellation: Constellation;
};

export const ConstellationCard = ({ constellation }: ConstellationCardProps) => {
  return (
    <Link
      href={`/map/${constellation.id}`}
      className="card-surface group flex flex-col gap-4 p-5 transition hover:-translate-y-1 hover:border-accent/40 hover:shadow-accent/20"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-textMuted">Constellation</p>
          <h3 className="text-xl font-semibold text-textPrimary">{constellation.title}</h3>
        </div>
        <span className="badge bg-accent/20 text-accent">Strength: {constellation.strength}</span>
      </div>

      <div className="flex flex-wrap gap-2 text-sm text-textMuted">
        {constellation.seedArtists.map((seed) => (
          <span key={seed} className="rounded-full bg-white/5 px-3 py-1">
            {seed}
          </span>
        ))}
      </div>

      <TagPills title="Identity" tags={constellation.identityTags} limit={3} />
      <TagPills title="Exploration" tags={constellation.explorationTags} limit={3} />

      <div className="flex items-center justify-between pt-2 text-sm text-textMuted">
        <span>{constellation.recommendations.length} recommendations</span>
        <span className="flex items-center gap-2 text-accent">
          View details
          <span className="inline-block transition-transform group-hover:translate-x-1">-></span>
        </span>
      </div>
    </Link>
  );
};
