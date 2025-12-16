'use client';

import { useVariant } from './variant-provider';
import type { MockVariant } from '@/mock/userMap';

const VARIANT_OPTIONS: MockVariant[] = ['normal', 'loading', 'empty', 'partial', 'error'];

export const VariantToggle = () => {
  const { variant, setVariant } = useVariant();

  return (
    <div className="flex items-center gap-3 rounded-full border border-white/10 bg-panel px-3 py-2 text-sm shadow-inner shadow-black/40">
      <div className="flex flex-col">
        <span className="text-xs uppercase tracking-[0.2em] text-textMuted">Dev only</span>
        <span className="font-semibold text-textPrimary">Mock variant</span>
      </div>
      <select
        aria-label="Mock data variant"
        className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-textPrimary outline-none focus:border-accent focus:ring-1 focus:ring-accent"
        value={variant}
        onChange={(event) => setVariant(event.target.value as MockVariant)}
      >
        {VARIANT_OPTIONS.map((option) => (
          <option key={option} value={option} className="bg-panel text-textPrimary">
            {option}
          </option>
        ))}
      </select>
    </div>
  );
};
