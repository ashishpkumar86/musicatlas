import type { Tag } from '@/mock/userMap';

type TagPillsProps = {
  title?: string;
  tags: Tag[];
  limit?: number;
};

const intensityClass = (weight: number) => {
  if (weight >= 0.85) return 'bg-accent/20 text-textPrimary border border-accent/60';
  if (weight >= 0.65) return 'bg-accent/10 text-textPrimary border border-accent/30';
  if (weight >= 0.4) return 'bg-white/5 text-textMuted border border-white/10';
  return 'bg-black/30 text-textMuted border border-white/5';
};

export const TagPills = ({ title, tags, limit }: TagPillsProps) => {
  const visible = typeof limit === 'number' ? tags.slice(0, limit) : tags;

  return (
    <div className="flex flex-col gap-2">
      {title ? <p className="text-xs uppercase tracking-[0.2em] text-textMuted">{title}</p> : null}
      <div className="flex flex-wrap gap-2">
        {visible.map((tag) => (
          <span key={tag.name} className={`pill ${intensityClass(tag.weight)}`}>
            <span className="text-[11px] uppercase text-white/70">{tag.kind === 'identity' ? 'Core' : 'Explore'}</span>
            {tag.name}
          </span>
        ))}
        {visible.length === 0 ? <span className="text-sm text-textMuted">No tags yet.</span> : null}
      </div>
    </div>
  );
};
