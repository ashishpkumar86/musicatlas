import type { SeedSummary } from '@/mock/userMap';

type SeedSummaryBarProps = {
  summary: SeedSummary;
};

const SummaryItem = ({ label, value }: { label: string; value: number }) => (
  <div className="flex flex-col gap-1 rounded-xl bg-white/5 px-4 py-3 text-sm">
    <span className="text-textMuted">{label}</span>
    <span className="text-lg font-semibold text-textPrimary">{value}</span>
  </div>
);

export const SeedSummaryBar = ({ summary }: SeedSummaryBarProps) => {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
      <SummaryItem label="Total seeds" value={summary.totalSeeds} />
      <SummaryItem label="Spotify seeds" value={summary.spotifySeeds} />
      <SummaryItem label="Tidal seeds" value={summary.tidalSeeds} />
      <SummaryItem label="Taste enabled" value={summary.tasteEnabledCount} />
      <SummaryItem label="Context-only" value={summary.contextOnlyCount} />
      <SummaryItem label="Unresolved" value={summary.unresolvedCount} />
    </div>
  );
};
