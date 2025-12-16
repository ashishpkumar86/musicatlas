import type { Recommendation } from '@/mock/userMap';
import { RecommendationRow } from './recommendation-row';

type RecommendationListProps = {
  recommendations: Recommendation[];
};

export const RecommendationList = ({ recommendations }: RecommendationListProps) => {
  if (recommendations.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 bg-white/5 px-4 py-6 text-sm text-textMuted">
        No recommendations in this mock yet.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {recommendations.map((rec) => (
        <RecommendationRow key={rec.id} recommendation={rec} />
      ))}
    </ul>
  );
};
