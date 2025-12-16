'use client';

import Link from 'next/link';
import { ConstellationCard } from '@/components/constellation-card';
import { SeedSummaryBar } from '@/components/seed-summary-bar';
import { getMockUserMap } from '@/mock/userMap';
import { useVariant } from '@/components/variant-provider';

const LoadingState = () => (
  <div className="rounded-2xl border border-white/5 bg-panel/80 p-6 text-textMuted">Loading mock data...</div>
);

const EmptyState = () => (
  <div className="rounded-2xl border border-dashed border-white/10 bg-panel/40 p-6 text-textMuted">
    No constellations in this mock variant. Try another variant to see cards.
  </div>
);

const ErrorState = ({ message }: { message: string }) => (
  <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-rose-100">
    {message}
  </div>
);

export default function ListeningMapPage() {
  const { variant } = useVariant();
  const response = getMockUserMap(variant);

  if (response.isLoading) return <LoadingState />;
  if (response.error) return <ErrorState message={response.error} />;
  if (!response.data) return <ErrorState message="No mock data found." />;

  const { seedSummary, constellations } = response.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-textMuted">Listening map</p>
          <h2 className="text-3xl font-semibold text-textPrimary">Your constellations (mock)</h2>
        </div>
        <Link href="/" className="text-sm text-accent hover:text-accentMuted">
          &larr; Back to landing
        </Link>
      </div>

      <div className="card-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm uppercase tracking-[0.2em] text-textMuted">Seed summary (mock)</span>
          <span className="badge bg-white/5 text-textMuted">Data will be wired to real endpoint later</span>
        </div>
        <SeedSummaryBar summary={seedSummary} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {constellations.map((constellation) => (
          <ConstellationCard key={constellation.id} constellation={constellation} />
        ))}
      </div>

      {constellations.length === 0 ? <EmptyState /> : null}
    </div>
  );
}
