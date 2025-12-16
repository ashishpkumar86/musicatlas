import type { Recommendation } from '@/mock/userMap';

type RecommendationRowProps = {
  recommendation: Recommendation;
};

const scoreBadge = (score: Recommendation['scoreBand']) => {
  switch (score) {
    case 'high':
      return 'bg-emerald-500/20 text-emerald-200 border-emerald-400/40';
    case 'medium':
      return 'bg-amber-500/20 text-amber-200 border-amber-400/40';
    default:
      return 'bg-slate-500/20 text-slate-200 border-slate-300/30';
  }
};

const reasonColors: Record<string, string> = {
  members: 'bg-purple-500/15 text-purple-100 border-purple-400/30',
  credits: 'bg-blue-500/15 text-blue-100 border-blue-400/30',
  labels: 'bg-pink-500/15 text-pink-100 border-pink-400/30',
  events: 'bg-orange-500/15 text-orange-100 border-orange-400/30',
  country: 'bg-emerald-500/15 text-emerald-100 border-emerald-400/30'
};

export const RecommendationRow = ({ recommendation }: RecommendationRowProps) => {
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-white/5 bg-white/5 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-base font-semibold text-textPrimary">{recommendation.name}</span>
          <span className="text-sm text-textMuted">
            {[recommendation.city, recommendation.country].filter(Boolean).join(', ')}
          </span>
        </div>
        <span className={`badge border ${scoreBadge(recommendation.scoreBand)}`}>
          {recommendation.scoreBand} score
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {recommendation.reasons.map((reason) => (
          <span key={reason} className={`badge border ${reasonColors[reason] ?? 'bg-white/10 text-textMuted'}`}>
            {reason}
          </span>
        ))}
        {recommendation.reasons.length === 0 ? (
          <span className="badge border border-white/10 bg-white/5 text-textMuted">organic match</span>
        ) : null}
      </div>
    </li>
  );
};
