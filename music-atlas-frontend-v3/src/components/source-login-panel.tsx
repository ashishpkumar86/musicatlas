'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api';

type SpotifyTopItem = {
  id: string;
  name: string;
  imageUrl?: string | null;
};

type SpotifyArtistDetail = {
  id: string;
  name: string;
  imageUrl?: string | null;
  image_url?: string | null;
  popularity?: number | null;
  followers_total?: number | null;
  genres?: string[];
};

type TidalFavorite = {
  id: string;
  name: string;
  imageUrl?: string | null;
  popularity?: number | null;
};

type SessionResponse = { logged_in: boolean };

type Status = 'idle' | 'loading' | 'ready' | 'error';

const normalizePopularity = (value: unknown) => {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (Number.isNaN(num)) return null;
  if (num <= 1) return Math.round(num * 100);
  return Math.round(Math.min(100, Math.max(0, num)));
};

const simplifySpotifyPayload = (artist: any): SpotifyArtistDetail => {
  const images = artist.images || [];
  const imageUrl = images[0]?.url || artist.imageUrl || artist.image_url || null;
  return {
    id: artist.id,
    name: artist.name,
    popularity: normalizePopularity(artist.popularity),
    genres: Array.isArray(artist.genres) ? artist.genres : [],
    followers_total: artist.followers?.total ?? artist.followers_total,
    imageUrl
  };
};

export const SourceLoginPanel = () => {
  const [spotifyStatus, setSpotifyStatus] = useState<Status>('idle');
  const [tidalStatus, setTidalStatus] = useState<Status>('idle');
  const [spotifyItems, setSpotifyItems] = useState<SpotifyArtistDetail[]>([]);
  const [tidalItems, setTidalItems] = useState<TidalFavorite[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = (provider: 'spotify' | 'tidal') => {
    window.location.href = `/api/auth/${provider}/login`;
  };

  const loadSpotifyTop = useCallback(async () => {
    setSpotifyStatus('loading');
    try {
      const payload = await apiFetch<{ items: SpotifyTopItem[] }>('/api/spotify/top-artists?limit=20');
      const items = payload.items || [];
      const detailed = await Promise.all(
        items.map(async (artist) => {
          try {
            const resp = await apiFetch<SpotifyArtistDetail>(`/api/spotify/artist/${encodeURIComponent(artist.id)}`);
            return resp;
          } catch (err) {
            console.warn('Failed to load Spotify artist detail', artist.id, err);
            return simplifySpotifyPayload(artist);
          }
        })
      );
      setSpotifyItems(detailed);
      setSpotifyStatus('ready');
    } catch (err) {
      console.error('Spotify load error', err);
      setError(`Spotify: ${(err as Error).message}`);
      setSpotifyStatus('error');
    }
  }, []);

  const loadTidalFavorites = useCallback(async () => {
    setTidalStatus('loading');
    try {
      const data = await apiFetch<{
        data: { id: string }[];
        included?: { id: string | number; type: string; attributes?: { name?: string; imageUrl?: string | null } }[];
      }>('/api/tidal/favorites/artists?limit=50');

      const rawItems = data.data || [];
      const artistResources = (data.included || []).filter((res) => res.type === 'artists');
      const resourceMap = new Map(artistResources.map((res) => [String(res.id), res]));

      const fullArtistList = rawItems.map((entry) => {
        const full = resourceMap.get(String(entry.id));
        const attrs = full?.attributes || {};
        return {
          id: String(entry.id),
          name: attrs.name || 'Unknown',
          imageUrl: attrs.imageUrl || null,
          popularity: null
        };
      });

      setTidalItems(fullArtistList);
      setTidalStatus('ready');
    } catch (err) {
      console.error('TIDAL load error', err);
      setError(`TIDAL: ${(err as Error).message}`);
      setTidalStatus('error');
    }
  }, []);

  const checkSession = useCallback(
    async (provider: 'spotify' | 'tidal') => {
      const setter = provider === 'spotify' ? setSpotifyStatus : setTidalStatus;
      try {
        setter('loading');
        const session = await apiFetch<SessionResponse>(`/api/auth/${provider}/session`);
        if (session.logged_in) {
          if (provider === 'spotify') await loadSpotifyTop();
          else await loadTidalFavorites();
        } else {
          setter('idle');
        }
      } catch (err) {
        console.error(`${provider} session check error`, err);
        setter('error');
        setError(`${provider} session: ${(err as Error).message}`);
      }
    },
    [loadSpotifyTop, loadTidalFavorites]
  );

  useEffect(() => {
    checkSession('spotify');
    checkSession('tidal');
  }, [checkSession]);

  const spotifyPreview = useMemo(() => spotifyItems.slice(0, 5), [spotifyItems]);
  const tidalPreview = useMemo(() => tidalItems.slice(0, 5), [tidalItems]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <LoginCard
        title="Spotify"
        status={spotifyStatus}
        cta={() => handleLogin('spotify')}
        onRefresh={() => checkSession('spotify')}
        items={spotifyPreview.map((artist) => ({
          id: artist.id,
          name: artist.name,
          image: artist.imageUrl || artist.image_url || null,
          popularity: normalizePopularity(artist.popularity),
          meta:
            typeof artist.followers_total === 'number'
              ? `${artist.followers_total.toLocaleString()} followers`
              : undefined
        }))}
        emptyText="No Spotify session yet. Log in to sync top artists."
      />

      <LoginCard
        title="TIDAL"
        status={tidalStatus}
        cta={() => handleLogin('tidal')}
        onRefresh={() => checkSession('tidal')}
        items={tidalPreview.map((artist) => ({
          id: artist.id,
          name: artist.name,
          image: artist.imageUrl || null,
          popularity: normalizePopularity(artist.popularity),
          meta: undefined
        }))}
        emptyText="No TIDAL session yet. Log in to sync favorites."
      />

      {error ? (
        <div className="lg:col-span-2 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-rose-100">
          {error}
        </div>
      ) : null}
    </div>
  );
};

type LoginCardProps = {
  title: string;
  status: Status;
  items: { id: string; name: string; image: string | null; popularity: number | null; meta?: string }[];
  emptyText: string;
  cta: () => void;
  onRefresh: () => void;
};

const StatusBadge = ({ status }: { status: Status }) => {
  const variants: Record<Status, { text: string; className: string }> = {
    idle: { text: 'Logged out', className: 'bg-white/10 text-textMuted border-white/10' },
    loading: { text: 'Checking...', className: 'bg-amber-500/15 text-amber-200 border-amber-300/30' },
    ready: { text: 'Connected', className: 'bg-emerald-500/15 text-emerald-200 border-emerald-300/30' },
    error: { text: 'Error', className: 'bg-rose-500/15 text-rose-100 border-rose-300/30' }
  };
  const variant = variants[status];
  return <span className={`badge border ${variant.className}`}>{variant.text}</span>;
};

const LoginCard = ({ title, status, items, emptyText, cta, onRefresh }: LoginCardProps) => {
  return (
    <div className="card-surface flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-white/5" />
          <div className="flex flex-col">
            <p className="text-xs uppercase tracking-[0.2em] text-textMuted">{title} sync</p>
            <span className="text-lg font-semibold text-textPrimary">{title} session</span>
          </div>
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="flex flex-wrap gap-2">
        {status !== 'ready' ? (
          <button
            onClick={cta}
            className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-canvas transition hover:bg-accentMuted"
          >
            Log in with {title}
          </button>
        ) : null}
        <button
          onClick={onRefresh}
          className="rounded-full border border-white/10 px-3 py-2 text-sm text-textMuted transition hover:border-accent hover:text-textPrimary"
        >
          Refresh
        </button>
      </div>

      <div className="rounded-xl border border-white/5 bg-white/5 p-3">
        {items.length === 0 ? (
          <p className="text-sm text-textMuted">{emptyText}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((artist) => (
              <li key={artist.id} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-black/40">
                    {artist.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={artist.image} alt={artist.name} className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-sm text-textMuted">{artist.name.charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-textPrimary">{artist.name}</span>
                    <span className="text-xs text-textMuted">{artist.meta || 'Artist'}</span>
                  </div>
                </div>
                <div className="text-xs text-textMuted">
                  {typeof artist.popularity === 'number' ? `Popularity ${artist.popularity}` : 'n/a'}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
