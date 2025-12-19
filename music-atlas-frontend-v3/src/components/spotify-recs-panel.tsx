'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiBase, apiFetch } from '@/lib/api';

type SpotifyArtist = {
  id: string;
  name: string;
  popularity?: number | null;
  genres?: string[];
};

type AlbumRec = {
  release_group_id: number;
  release_group_name: string;
  artist_id: number;
  artist_name: string;
  primary_type: string;
  first_release_date: string;
  approx_track_count: number;
  best_similarity: number;
  seed_support_count: number;
  supporting_seed_ids: number[];
  dominant_tag?: string | null;
  top_tags?: string[] | null;
  spotify_album_id?: string | null;
  spotify_url?: string | null;
  spotify_image_url?: string | null;
  spotify_album_name?: string | null;
  spotify_release_date?: string | null;
  spotify_release_date_precision?: string | null;
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

export function SpotifyRecsPanel() {
  const [spotifyStatus, setSpotifyStatus] = useState<Status>('idle');
  const [artists, setArtists] = useState<SpotifyArtist[]>([]);
  const [albums, setAlbums] = useState<AlbumRec[]>([]);
  const [recsStatus, setRecsStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [addName, setAddName] = useState('');
  const [addStatus, setAddStatus] = useState<Status>('idle');

  const handleLogin = () => {
    window.location.href = `${apiBase}/auth/spotify/login`;
  };

  const loadSpotifyTop = useCallback(async () => {
    setSpotifyStatus('loading');
    try {
      const payload = await apiFetch<{ items: SpotifyArtist[] }>('/spotify/top-artists?limit=50');
      const items = payload.items || [];
      setArtists(items);
      setSpotifyStatus('ready');
    } catch (err) {
      console.error('Spotify load error', err);
      setError(`Spotify: ${(err as Error).message}`);
      setSpotifyStatus('error');
    }
  }, []);

  const checkSession = useCallback(async () => {
    try {
      setSpotifyStatus('loading');
      const session = await apiFetch<SessionResponse>('/auth/spotify/session');
      if (session.logged_in) {
        await loadSpotifyTop();
      } else {
        setSpotifyStatus('idle');
      }
    } catch (err) {
      console.error('spotify session check error', err);
      setSpotifyStatus('error');
      setError(`spotify session: ${(err as Error).message}`);
    }
  }, [loadSpotifyTop]);

  const buildAlbumRecs = useCallback(async () => {
    if (!artists.length) return;
    setRecsStatus('loading');
    setError(null);
    try {
      const payload = await apiFetch<AlbumRec[]>('/recs/albums/from-spotify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          artists.map((a) => ({
            name: a.name,
            popularity: normalizePopularity(a.popularity),
            genres: Array.isArray(a.genres) ? a.genres : []
          }))
        )
      });
      setAlbums(payload || []);
      setRecsStatus('ready');
    } catch (err) {
      setRecsStatus('error');
      setError(`Album recs: ${(err as Error).message}`);
    }
  }, [artists]);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  useEffect(() => {
    if (spotifyStatus === 'ready' && artists.length) {
      buildAlbumRecs();
    }
  }, [spotifyStatus, artists, buildAlbumRecs]);

  const artistLine = useMemo(() => artists.map((a) => a.name).join(', '), [artists]);
  const isLoggedIn = spotifyStatus === 'ready';

  const addArtistAlbums = async () => {
    const name = addName.trim();
    if (!name) return;
    setAddStatus('loading');
    setError(null);
    try {
      const payload = await apiFetch<AlbumRec[]>('/recs/albums/add-artist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      setAlbums((prev) => [...(payload || []), ...prev]);
      setAddStatus('ready');
      setAddName('');
    } catch (err) {
      setAddStatus('error');
      setError(`Add artist: ${(err as Error).message}`);
    }
  };

  return (
    <div className="card-surface rounded-2xl border border-white/5 bg-panel/70 p-6 shadow-xl shadow-black/30">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="text-xl font-semibold text-textPrimary">Uncle...please sit.</span>
        <p className="text-sm text-textMuted">No, the world didn’t run out of good new music.</p>
        {!isLoggedIn ? (
          <button
            onClick={handleLogin}
            className="mt-2 inline-flex items-center justify-center rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#1DB954] transition hover:scale-[1.02] hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1DB954]"
          >
            <span className="relative flex items-center gap-2">
              <span className="block h-6 w-24">
                {/* Use Next.js Image for optimization if desired; simple img keeps it inline and flexible */}
                <img
                  src="/Spotify_Full_Logo_RGB_Green.png"
                  alt="Log in with Spotify"
                  className="h-6 w-auto"
                />
              </span>
            </span>
          </button>
        ) : null}
        <p className="max-w-2xl text-sm text-textMuted">
          Log in with Spotify and we’ll analyze your favorite artists to surface recent albums worth your time. Or enter any
          artist you like — we’ll build the trail from there.
        </p>
        {isLoggedIn ? (
          <div className="w-full rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-textPrimary">
            <div className="mb-1 text-xs uppercase tracking-[0.15em] text-textMuted">Your artists</div>
            {artistLine ? (
              <p className="text-sm text-textPrimary">{artistLine}</p>
            ) : (
              <p className="text-sm text-textMuted">Loading artists...</p>
            )}
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-rose-100">{error}</div>
      ) : null}

      <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold text-textPrimary">Album recommendations</span>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="Add artist by name"
                className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-textPrimary placeholder:text-textMuted focus:border-accent focus:outline-none"
              />
              <button
                onClick={addArtistAlbums}
                className="rounded-full border border-white/10 px-3 py-1 text-xs text-textMuted transition hover:border-accent hover:text-textPrimary disabled:opacity-60"
                disabled={addStatus === 'loading' || !addName.trim()}
              >
                {addStatus === 'loading' ? 'Adding...' : 'Add'}
              </button>
            </div>
            <button
              onClick={checkSession}
              className="rounded-full border border-white/10 px-3 py-1 text-xs text-textMuted transition hover:border-accent hover:text-textPrimary"
            >
              Refresh
            </button>
          </div>
        </div>
        {recsStatus === 'loading' ? (
          <div className="flex items-center gap-2 text-sm text-textMuted">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent" style={{ animationDelay: '0.15s' }} />
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent" style={{ animationDelay: '0.3s' }} />
            <span>Building recommendations...</span>
          </div>
        ) : recsStatus === 'ready' && albums.length === 0 ? (
          <p className="text-sm text-textMuted">No albums returned for your seeds.</p>
        ) : recsStatus === 'error' ? (
          <p className="text-sm text-textMuted">Failed to build album recommendations.</p>
        ) : albums.length > 0 ? (
          <div className="grid gap-3">
            {albums.map((album) => {
              const coverUrl = album.spotify_image_url || null;
              const spotifyUrl = album.spotify_url || null;
              const albumName = album.spotify_album_name || album.release_group_name;
              const releaseDate = album.spotify_release_date || album.first_release_date;
              const year = releaseDate ? releaseDate.split('-')[0] : '';
              const dominant = album.dominant_tag || null;
              const secondary =
                Array.isArray(album.top_tags) && album.top_tags.length
                  ? album.top_tags.filter((t) => t && t !== dominant).slice(0, 3).join(', ')
                  : '';
              return (
                <div key={`${album.release_group_id}-${album.artist_id}`} className="rounded-lg bg-white/5 p-3">
                  <div className="flex gap-3">
                    {coverUrl ? (
                      <a
                        href={spotifyUrl || '#'}
                        target="_blank"
                        rel="noreferrer"
                        className="block h-20 w-20 overflow-hidden rounded-md border border-white/10 bg-black/30"
                      >
                        <img src={coverUrl} alt={albumName} className="h-full w-full object-cover" />
                      </a>
                    ) : null}
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold text-textPrimary">{albumName}</div>
                        {spotifyUrl ? (
                          <a
                            href={spotifyUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs font-semibold text-[#1DB954] hover:underline"
                          >
                            Open in Spotify
                          </a>
                        ) : null}
                      </div>
                      <div className="text-xs text-textMuted">{album.artist_name}</div>
                      <div className="text-xs italic text-textMuted">{year}</div>
                      {(dominant || secondary) ? (
                        <div className="text-xs text-textMuted">
                          {dominant ? <span className="font-semibold text-textPrimary">{dominant}</span> : null}
                          {dominant && secondary ? <span className="text-textMuted">, </span> : null}
                          {secondary ? <span>{secondary}</span> : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-textMuted">Log in and refresh to build album recommendations.</p>
        )}
      </div>
    </div>
  );
}
