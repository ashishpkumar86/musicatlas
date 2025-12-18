'use client';

import { FormEvent, useState } from 'react';
import { apiFetch } from '@/lib/api';

type EnrichedArtist = {
  name: string;
  country?: string | null;
  tags?: { name: string; count?: number | null }[];
};

type Status = 'idle' | 'loading' | 'ready' | 'error';

export function ArtistSearch() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<EnrichedArtist | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  const onSearch = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      setError('Enter an artist name to search MusicBrainz.');
      setResult(null);
      return;
    }

    setStatus('loading');
    setError(null);
    setResult(null);

    try {
      const data = await apiFetch<EnrichedArtist>(`/mb/artist/enriched/by-name?name=${encodeURIComponent(trimmed)}`);
      setResult(data);
      setStatus('ready');
    } catch (err) {
      setStatus('error');
      setError((err as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs uppercase tracking-[0.2em] text-textMuted">MusicBrainz search</p>
          <span className="text-lg font-semibold text-textPrimary">Find an artist (DB-backed when MB_SOURCE=db)</span>
          <p className="text-sm text-textMuted">
            Looks up an artist via the backend enriched endpoint and shows country + top tags.
          </p>
        </div>
        <form className="flex flex-wrap items-center gap-2" onSubmit={onSearch}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search artist name"
            className="rounded-full border border-white/10 bg-black/30 px-4 py-2 text-sm text-textPrimary placeholder:text-textMuted focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-canvas transition hover:bg-accentMuted disabled:opacity-60"
            disabled={status === 'loading'}
          >
            {status === 'loading' ? 'Searching...' : 'Search'}
          </button>
        </form>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-rose-100">{error}</div>
      ) : null}

      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        {status === 'idle' && !result ? <p className="text-sm text-textMuted">Enter a name and hit search.</p> : null}
        {status === 'loading' ? <p className="text-sm text-textMuted">Searching...</p> : null}
        {status === 'ready' && result ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold text-textPrimary">{result.name}</span>
              {result.country ? (
                <span className="rounded-full border border-white/10 px-2 py-1 text-xs text-textMuted">{result.country}</span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {Array.isArray(result.tags) && result.tags.length > 0 ? (
                result.tags.map((tag) => (
                  <span key={tag.name} className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-textPrimary">
                    {tag.name}
                    {typeof tag.count === 'number' ? <span className="ml-1 text-textMuted">({tag.count})</span> : null}
                  </span>
                ))
              ) : (
                <p className="text-sm text-textMuted">No tags found.</p>
              )}
            </div>
          </div>
        ) : null}
        {status === 'error' && !error ? <p className="text-sm text-textMuted">Search failed.</p> : null}
      </div>
    </div>
  );
}
