'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';

type SpotifyArtist = {
  id: string;
  name: string;
  popularity?: number | null;
  followers_total?: number | null;
  genres?: string[];
};

type SonicTag = {
  name: string;
  score?: number | null;
};

type SessionBase = {
  logged_in: boolean;
  [key: string]: unknown;
};

type SpotifySession = SessionBase & {
  user_id?: string;
  display_name?: string;
  scope?: string;
  expires_at?: number | null;
};

const formatExpiry = (value?: number | null) => {
  if (!value) return '--';
  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
};

const normalizePopularity = (value: unknown) => {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (Number.isNaN(num)) return null;
  if (num <= 1) return Math.round(num * 100);
  return Math.round(Math.min(100, Math.max(0, num)));
};

const formatValue = (key: string, value: unknown) => {
  if (value === null || value === undefined) return '--';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number' && key.includes('expires_at')) return formatExpiry(value);
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const labelize = (key: string) =>
  key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

const rowsFromSession = (session: SessionBase | null, preferred: string[] = []) => {
  if (!session) {
    return [{ label: 'Logged In', value: 'Loading...' }];
  }

  const keys = Array.from(new Set(['logged_in', ...preferred, ...Object.keys(session)]));

  return keys.map((key) => ({
    label: labelize(key),
    value: formatValue(key, session[key])
  }));
};

const TableCard = ({
  title,
  rows,
  status,
  connected,
  artists,
  showPopularity,
  showGenres,
  onRefresh
}: {
  title: string;
  rows: { label: string; value: string }[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  connected?: boolean;
  artists?: {
    id: string;
    name: string;
    popularity?: number | null;
    followers_total?: number | null;
    genres?: string[];
  }[];
  showPopularity?: boolean;
  showGenres?: boolean;
  onRefresh: () => void;
}) => {
  const badge =
    status === 'ready'
      ? 'bg-emerald-500/15 text-emerald-200 border-emerald-300/30'
      : status === 'loading'
        ? 'bg-amber-500/15 text-amber-200 border-amber-300/30'
        : status === 'error'
          ? 'bg-rose-500/15 text-rose-100 border-rose-300/30'
          : 'bg-white/10 text-textMuted border-white/10';

  const badgeText =
    status === 'ready'
      ? connected
        ? 'Connected'
        : 'Checked'
      : status === 'error'
        ? 'Error'
        : 'Checking...';

  return (
    <div className="card-surface rounded-2xl border border-white/5 bg-panel/70 p-6 shadow-xl shadow-black/30">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-white/5" />
          <div className="flex flex-col">
            <p className="text-xs uppercase tracking-[0.2em] text-textMuted">{title} profile</p>
            <span className="text-lg font-semibold text-textPrimary">{title} fields</span>
          </div>
        </div>
        <span className={`badge border ${badge}`}>{badgeText}</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-white/10 bg-black/20">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-left text-textMuted">
            <tr>
              <th className="px-4 py-2 font-semibold">Field</th>
              <th className="px-4 py-2 font-semibold">Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-white/5 odd:bg-white/5">
                <td className="px-4 py-3 text-textMuted">{row.label}</td>
                <td className="px-4 py-3 font-medium text-textPrimary">{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {artists ? (
        <div className="mt-4 overflow-hidden rounded-xl border border-white/10 bg-black/20">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-left text-textMuted">
              <tr>
                <th className="px-4 py-2 font-semibold">Artist</th>
                {showPopularity ? <th className="px-4 py-2 font-semibold">Popularity</th> : null}
                {showGenres ? <th className="px-4 py-2 font-semibold">Genres</th> : null}
              </tr>
            </thead>
            <tbody>
              {artists.length === 0 ? (
                <tr>
                  <td
                    className="px-4 py-3 text-textMuted"
                    colSpan={1 + (showPopularity ? 1 : 0) + (showGenres ? 1 : 0)}
                  >
                    No artists collected yet.
                  </td>
                </tr>
              ) : (
                artists.map((artist) => (
                  <tr key={artist.id} className="border-t border-white/5 odd:bg-white/5">
                    <td className="px-4 py-3 font-medium text-textPrimary">{artist.name}</td>
                    {showPopularity ? (
                      <td className="px-4 py-3 text-textMuted">
                        {typeof artist.popularity === 'number' ? artist.popularity.toFixed(2) : 'n/a'}
                      </td>
                    ) : null}
                    {showGenres ? (
                      <td className="px-4 py-3 text-textMuted">
                        {Array.isArray(artist.genres) && artist.genres.length > 0
                          ? artist.genres.join(', ')
                          : 'n/a'}
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={onRefresh}
          className="rounded-full border border-white/10 px-4 py-2 text-sm text-textMuted transition hover:border-accent hover:text-textPrimary"
        >
          Refresh
        </button>
        <p className="text-xs text-textMuted">Use this page to verify new profile fields are being captured.</p>
      </div>
    </div>
  );
};

export default function DataCheckPage() {
  const [spotifySession, setSpotifySession] = useState<SpotifySession | null>(null);
  const [spotifyArtists, setSpotifyArtists] = useState<SpotifyArtist[]>([]);
  const [tagCloud, setTagCloud] = useState<SonicTag[]>([]);
  const [spotifyStatus, setSpotifyStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [tagStatus, setTagStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [tagError, setTagError] = useState<string | null>(null);

  const loadSpotify = async () => {
    setSpotifyStatus('loading');
    try {
      const data = await apiFetch<SpotifySession>('/api/auth/spotify/session');
      setSpotifySession(data);
      if (data.logged_in) {
        const top = await apiFetch<{ items: SpotifyArtist[] }>('/api/spotify/top-artists?limit=20');
        setSpotifyArtists(top.items || []);
      } else {
        setSpotifyArtists([]);
      }
      setSpotifyStatus('ready');
      setError(null);
    } catch (err) {
      setSpotifyStatus('error');
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    loadSpotify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buildSonicTags = async () => {
    setTagStatus('loading');
    setTagError(null);

    const payload = spotifyArtists.map((artist) => ({
      name: artist.name,
      source: 'spotify',
      source_id: artist.id,
      country_code: null,
      popularity: normalizePopularity(artist.popularity),
      genres: Array.isArray(artist.genres) ? artist.genres : []
    }));

    if (payload.length === 0) {
      setTagError('No artists loaded yet. Log in and refresh first.');
      setTagStatus('error');
      return;
    }

    try {
      const data = await apiFetch<{ tag_cloud?: SonicTag[] }>('/api/user/sonic-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      setTagCloud(data.tag_cloud || []);
      setTagStatus('ready');
    } catch (err) {
      setTagStatus('error');
      setTagError((err as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-2">
          <p className="text-sm uppercase tracking-[0.25em] text-accent">Data check</p>
          <h1 className="text-3xl font-semibold text-textPrimary">Captured profile fields</h1>
          <p className="text-base text-textMuted">Inspect the fields we store after you log in with Spotify.</p>
        </div>
        <Link
          href="/"
          className="rounded-full border border-white/10 px-4 py-2 text-sm text-textMuted transition hover:border-accent hover:text-textPrimary"
        >
          Back to home
        </Link>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-rose-100">{error}</div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <TableCard
          title="Spotify"
          rows={rowsFromSession(spotifySession, ['user_id', 'display_name', 'scope', 'expires_at'])}
          status={spotifyStatus}
          connected={!!spotifySession?.logged_in}
          artists={spotifyArtists}
          showPopularity
          showGenres
          onRefresh={loadSpotify}
        />
      </div>

      <div className="rounded-2xl border border-white/5 bg-panel/70 p-6 shadow-xl shadow-black/30">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <p className="text-xs uppercase tracking-[0.2em] text-textMuted">Sonic tag cloud</p>
            <span className="text-lg font-semibold text-textPrimary">Blend your artists into tags</span>
            <p className="text-sm text-textMuted">Uses all loaded Spotify artists to build a tag cloud.</p>
          </div>
          <button
            onClick={buildSonicTags}
            className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-canvas transition hover:bg-accentMuted disabled:opacity-60"
            disabled={tagStatus === 'loading'}
          >
            {tagStatus === 'loading' ? 'Building...' : 'Build Sonic Tag Cloud'}
          </button>
        </div>

        {tagError ? (
          <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-rose-100">{tagError}</div>
        ) : null}

        <div className="mt-4 min-h-[120px] rounded-xl border border-white/10 bg-black/20 p-4">
          {tagStatus === 'idle' && tagCloud.length === 0 ? (
            <p className="text-sm text-textMuted">Click build to generate your tag cloud.</p>
          ) : null}
          {tagStatus === 'loading' ? <p className="text-sm text-textMuted">Building tags...</p> : null}
          {tagStatus === 'ready' && tagCloud.length === 0 ? (
            <p className="text-sm text-textMuted">No tags returned for your current artists.</p>
          ) : null}
          {tagCloud.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {tagCloud.map((tag) => {
                const score = typeof tag.score === 'number' ? tag.score : 0;
                const size =
                  score >= 0.75 ? 'text-xl' : score >= 0.4 ? 'text-lg' : 'text-base';
                return (
                  <span
                    key={tag.name}
                    className={`rounded-full bg-white/10 px-3 py-1 font-medium text-textPrimary ${size}`}
                  >
                    {tag.name}
                    {typeof tag.score === 'number' ? (
                      <span className="ml-2 text-xs text-textMuted">{tag.score.toFixed(2)}</span>
                    ) : null}
                  </span>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
