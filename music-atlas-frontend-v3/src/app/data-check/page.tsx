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

type TidalArtist = {
  id: string;
  name: string;
  popularity?: number | null;
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

type TidalSession = SessionBase & {
  user_id?: string;
  scope?: string;
  expires_at?: number | null;
};

const formatExpiry = (value?: number | null) => {
  if (!value) return '--';
  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
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
  const [tidalSession, setTidalSession] = useState<TidalSession | null>(null);
  const [spotifyArtists, setSpotifyArtists] = useState<SpotifyArtist[]>([]);
  const [tidalArtists, setTidalArtists] = useState<TidalArtist[]>([]);
  const [status, setStatus] = useState<{ spotify: 'idle' | 'loading' | 'ready' | 'error'; tidal: 'idle' | 'loading' | 'ready' | 'error' }>({
    spotify: 'idle',
    tidal: 'idle'
  });
  const [error, setError] = useState<string | null>(null);

  const loadSpotify = async () => {
    setStatus((s) => ({ ...s, spotify: 'loading' }));
    try {
      const data = await apiFetch<SpotifySession>('/auth/spotify/session');
      setSpotifySession(data);
      if (data.logged_in) {
        const top = await apiFetch<{ items: SpotifyArtist[] }>('/spotify/top-artists?limit=20');
        setSpotifyArtists(top.items || []);
      } else {
        setSpotifyArtists([]);
      }
      setStatus((s) => ({ ...s, spotify: 'ready' }));
      setError(null);
    } catch (err) {
      setStatus((s) => ({ ...s, spotify: 'error' }));
      setError((err as Error).message);
    }
  };

  const loadTidal = async () => {
    setStatus((s) => ({ ...s, tidal: 'loading' }));
    try {
      const session = await apiFetch<TidalSession>('/auth/tidal/session');
      setTidalSession(session);
      if (session.logged_in) {
        const data = await apiFetch<{
          data: { id: string }[];
          included?: { id: string | number; type: string; attributes?: { name?: string; imageUrl?: string | null } }[];
        }>('/tidal/favorites/artists?limit=50');

        const rawItems = data.data || [];
        const artistResources = (data.included || []).filter((res) => res.type === 'artists');
        const resourceMap = new Map(artistResources.map((res) => [String(res.id), res]));

        const fullArtistList = rawItems.map((entry) => {
          const full = resourceMap.get(String(entry.id));
          const attrs = full?.attributes || {};
          return {
            id: String(entry.id),
            name: attrs.name || 'Unknown',
            popularity: typeof attrs.popularity === 'number' ? attrs.popularity : null
          };
        });

        setTidalArtists(fullArtistList);
      } else {
        setTidalArtists([]);
      }
      setStatus((s) => ({ ...s, tidal: 'ready' }));
      setError(null);
    } catch (err) {
      setStatus((s) => ({ ...s, tidal: 'error' }));
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    loadSpotify();
    loadTidal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-2">
          <p className="text-sm uppercase tracking-[0.25em] text-accent">Data check</p>
          <h1 className="text-3xl font-semibold text-textPrimary">Captured profile fields</h1>
          <p className="text-base text-textMuted">Inspect the fields we store after you log in with Spotify or TIDAL.</p>
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
          status={status.spotify}
          connected={!!spotifySession?.logged_in}
          artists={spotifyArtists}
          showPopularity
          showGenres
          onRefresh={loadSpotify}
        />
        <TableCard
          title="TIDAL"
          rows={rowsFromSession(tidalSession, ['user_id', 'scope', 'expires_at'])}
          status={status.tidal}
          connected={!!tidalSession?.logged_in}
          artists={tidalArtists}
          showPopularity
          onRefresh={loadTidal}
        />
      </div>
    </div>
  );
}
