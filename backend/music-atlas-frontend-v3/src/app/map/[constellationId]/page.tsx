'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ConstellationSidebar } from '@/components/constellation-sidebar';
import { RecommendationList } from '@/components/recommendation-list';
import { TagPills } from '@/components/tag-pills';
import { useVariant } from '@/components/variant-provider';
import { getMockUserMap } from '@/mock/userMap';

export default function ConstellationDetailPage() {
  const params = useParams();
  const constellationIdParam = Array.isArray(params?.constellationId)
    ? params?.constellationId[0]
    : params?.constellationId;
  const { variant } = useVariant();

  const response = getMockUserMap(variant);

  if (response.isLoading) {
    return <div className="text-textMuted">Loading mock constellation...</div>;
  }

  if (response.error) {
    return (
      <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-rose-100">
        {response.error}
      </div>
    );
  }

  if (!response.data) {
    return <div className="text-textMuted">No mock data for this constellation.</div>;
  }

  const { constellations } = response.data;
  const constellation = constellations.find((c) => c.id === constellationIdParam);

  if (!constellation) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-textMuted">No constellation found for {constellationIdParam} in this variant.</p>
        <Link href="/map" className="text-accent hover:text-accentMuted">
          &larr; Back to map
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <ConstellationSidebar constellations={constellations} activeId={constellation.id} />

      <div className="flex flex-col gap-6">
        <div className="card-surface p-6">
          <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
            <div className="flex flex-col gap-2">
              <p className="text-xs uppercase tracking-[0.25em] text-textMuted">Constellation explorer</p>
              <h2 className="text-3xl font-semibold text-textPrimary">{constellation.title}</h2>
              <div className="flex flex-wrap gap-2 text-sm text-textMuted">
                {constellation.seedArtists.map((seed) => (
                  <span key={seed} className="rounded-full bg-white/5 px-3 py-1">
                    Seed: {seed}
                  </span>
                ))}
              </div>
            </div>
            <span className="badge bg-accent/20 text-accent">Strength: {constellation.strength}</span>
          </div>
          <p className="text-sm text-textMuted">
            Using mock constellation detail. Replace with live constellation endpoint when wiring API.
          </p>
        </div>

        <div className="card-surface p-6">
          <TagPills title="Artist is..." tags={constellation.identityTags} />
        </div>

        <div className="card-surface p-6">
          <TagPills title="From here, explore..." tags={constellation.explorationTags} />
        </div>

        <div className="card-surface p-6">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-textMuted">Recommendations</p>
              <h3 className="text-xl font-semibold text-textPrimary">Top picks in this world</h3>
            </div>
            <Link href="/map" className="text-sm text-accent hover:text-accentMuted">
              &larr; Map
            </Link>
          </div>
          <RecommendationList recommendations={constellation.recommendations} />
        </div>
      </div>
    </div>
  );
}
