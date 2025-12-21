'use client';

import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
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

type TasteBucket = {
  cluster_id: number | null;
  label_primary: string;
  label_secondary?: string | null;
  weight_share?: number | null;
  album_count?: number;
  albums: AlbumRec[];
};

type TasteProfileResponse = {
  buckets: TasteBucket[];
};

type SessionResponse = { logged_in: boolean };
type Status = 'idle' | 'loading' | 'ready' | 'error';

const USE_TASTE_CHIPS = true;

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
  const sessionCheckedRef = useRef(false);
  const [tasteBuckets, setTasteBuckets] = useState<TasteBucket[]>([]);
  const [activeBucketKey, setActiveBucketKey] = useState<string | number | null>(null);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showArtistPanel, setShowArtistPanel] = useState(false);

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

  const fetchTasteProfile = useCallback(async () => {
    setRecsStatus('loading');
    setError(null);
    try {
      const payload = await apiFetch<TasteProfileResponse>('/taste/profile');
      const buckets = Array.isArray(payload.buckets) ? payload.buckets : [];
      setTasteBuckets(buckets);

      const nonOther = buckets.filter(
        (b) => b.cluster_id !== null && b.label_primary !== 'Other'
      );
      const other = buckets.find((b) => b.cluster_id === null || b.label_primary === 'Other');
      const sorted = [
        ...nonOther.sort((a, b) => (Number(b.weight_share || 0) - Number(a.weight_share || 0)) || Number(b.album_count || 0) - Number(a.album_count || 0)),
        ...(other ? [other] : [])
      ];
      setActiveBucketKey(sorted.length ? (sorted[0].cluster_id ?? 'other') : null);
      setRecsStatus('ready');
    } catch (err) {
      setRecsStatus('error');
      setError(`Taste profile: ${(err as Error).message}`);
    }
  }, []);

  useEffect(() => {
    if (sessionCheckedRef.current) return;
    sessionCheckedRef.current = true;
    checkSession();
  }, [checkSession]);

  useEffect(() => {
    if (spotifyStatus === 'ready' && artists.length) {
      if (USE_TASTE_CHIPS) {
        fetchTasteProfile();
      } else {
        buildAlbumRecs();
      }
    }
  }, [spotifyStatus, artists, buildAlbumRecs, fetchTasteProfile]);

  const artistLine = useMemo(() => artists.map((a) => a.name).join(', '), [artists]);
  const isLoggedIn = spotifyStatus === 'ready';
  const artistCount = artists.length;

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

  const sortedBuckets = useMemo(() => {
    if (!tasteBuckets.length) return [];
    const nonOther = tasteBuckets.filter(
      (b) => b.cluster_id !== null && b.label_primary !== 'Other'
    );
    const other = tasteBuckets.find((b) => b.cluster_id === null || b.label_primary === 'Other');
    const sorted = [
      ...nonOther.sort((a, b) => (Number(b.weight_share || 0) - Number(a.weight_share || 0)) || Number(b.album_count || 0) - Number(a.album_count || 0)),
      ...(other ? [other] : [])
    ];
    return sorted;
  }, [tasteBuckets]);

  const chipSlices = useMemo(() => {
    const nonOther = sortedBuckets.filter((b) => b.cluster_id !== null && b.label_primary !== 'Other');
    const other = sortedBuckets.find((b) => b.cluster_id === null || b.label_primary === 'Other');
    const visible = nonOther.slice(0, 4);
    const remaining = nonOther.slice(4);
    if (other) {
      remaining.push(other);
    }
    return { visible, remaining };
  }, [sortedBuckets]);

  const activeBucket = useMemo(() => {
    if (activeBucketKey === null) return null;
    if (activeBucketKey === 'other') {
      return sortedBuckets.find((b) => b.cluster_id === null || b.label_primary === 'Other') || null;
    }
    return sortedBuckets.find((b) => b.cluster_id === activeBucketKey) || null;
  }, [activeBucketKey, sortedBuckets]);

  return (
    <div className="card-surface rounded-2xl border border-white/5 bg-panel/70 p-6 shadow-xl shadow-black/30">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-lg font-semibold text-textPrimary leading-tight">Uncle... please sit.</div>
            <div className="text-sm text-textMuted">We found new music you’ll care about.</div>
          </div>
          {!isLoggedIn ? (
            <button
              onClick={handleLogin}
              className="inline-flex items-center justify-center rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-[#1DB954] transition hover:scale-[1.02] hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1DB954]"
            >
              <span className="relative flex items-center gap-2">
                <span className="block h-5 w-20">
                  <img src="/Spotify_Full_Logo_RGB_Green.png" alt="Log in with Spotify" className="h-5 w-auto" />
                </span>
              </span>
            </button>
          ) : null}
        </div>

        {isLoggedIn ? (
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="flex items-center justify-between text-sm text-textPrimary">
              <span className="text-textMuted">Built from {artistCount} of your artists</span>
              <button
                onClick={() => setShowArtistPanel((v) => !v)}
                className="text-xs font-semibold text-accent underline-offset-2 hover:underline"
              >
                {showArtistPanel ? 'Hide' : 'View'}
              </button>
            </div>
            {showArtistPanel ? (
              <div className="mt-2 max-h-32 overflow-y-auto rounded-lg border border-white/5 bg-white/5 p-2 text-xs text-textPrimary">
                {artistLine || 'Loading artists...'}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-rose-100">{error}</div>
      ) : null}

      <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold text-textPrimary">
          <span>Album recommendations</span>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-textPrimary">
          <input
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            placeholder="Add artist by name"
            className="min-w-[200px] flex-1 rounded-full border border-white/10 bg-black/30 px-3 py-2 text-xs text-textPrimary placeholder:text-textMuted focus:border-accent focus:outline-none"
          />
          <button
            onClick={addArtistAlbums}
            className="rounded-full border border-white/10 px-3 py-2 text-xs font-semibold text-textMuted transition hover:border-accent hover:text-textPrimary disabled:opacity-60"
            disabled={addStatus === 'loading' || !addName.trim()}
          >
            {addStatus === 'loading' ? 'Adding...' : 'Add'}
          </button>
          <button
            onClick={checkSession}
            className="rounded-full border border-white/10 px-3 py-2 text-xs font-semibold text-textMuted transition hover:border-accent hover:text-textPrimary"
          >
            Refresh
          </button>
        </div>
        {recsStatus === 'loading' ? (
          <div className="flex items-center gap-2 text-sm text-textMuted">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent" style={{ animationDelay: '0.15s' }} />
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent" style={{ animationDelay: '0.3s' }} />
            <span>Building recommendations...</span>
          </div>
        ) : recsStatus === 'ready' && USE_TASTE_CHIPS && sortedBuckets.length === 0 ? (
          <p className="text-sm text-textMuted">No buckets returned. Try refreshing your session.</p>
        ) : recsStatus === 'ready' && !USE_TASTE_CHIPS && albums.length === 0 ? (
          <p className="text-sm text-textMuted">No albums returned for your seeds.</p>
        ) : recsStatus === 'error' ? (
          <p className="text-sm text-textMuted">Failed to build album recommendations.</p>
        ) : USE_TASTE_CHIPS && activeBucket ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {chipSlices.visible.map((bucket) => {
                const label = bucket.label_secondary
                  ? `${bucket.label_primary} / ${bucket.label_secondary}`
                  : bucket.label_primary;
                const key = bucket.cluster_id ?? 'other';
                const isActive = activeBucketKey === key;
                return (
                  <button
                    key={`chip-${key}`}
                    onClick={() => {
                      setActiveBucketKey(key);
                      setShowMoreMenu(false);
                    }}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                      isActive
                        ? 'border-accent bg-accent/10 text-textPrimary'
                        : 'border-white/15 bg-white/5 text-textMuted hover:border-accent hover:text-textPrimary'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
              {chipSlices.remaining.length > 0 ? (
                <div className="relative">
                  <button
                    onClick={() => setShowMoreMenu((v) => !v)}
                    className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-textMuted transition hover:border-accent hover:text-textPrimary"
                  >
                    More…
                  </button>
                  {showMoreMenu ? (
                    <div className="absolute right-0 z-10 mt-1 w-56 rounded-lg border border-white/10 bg-black/90 shadow-lg">
                      {chipSlices.remaining.map((bucket) => {
                        const label = bucket.label_secondary
                          ? `${bucket.label_primary} / ${bucket.label_secondary}`
                          : bucket.label_primary;
                        const key = bucket.cluster_id ?? 'other';
                        const isActive = activeBucketKey === key;
                        return (
                          <button
                            key={`more-${key}`}
                            onClick={() => {
                              setActiveBucketKey(key);
                              setShowMoreMenu(false);
                            }}
                            className={`block w-full px-3 py-2 text-left text-xs transition ${
                              isActive ? 'bg-accent/10 text-textPrimary' : 'text-textMuted hover:bg-white/5'
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="flex items-baseline gap-2">
              <div className="text-sm font-semibold text-textPrimary">
                {activeBucket.label_secondary
                  ? `${activeBucket.label_primary} / ${activeBucket.label_secondary}`
                  : activeBucket.label_primary}
              </div>
              <div className="text-xs text-textMuted">{activeBucket.album_count || 0} albums · from recent releases</div>
            </div>

            <div className="grid gap-3 transition duration-150 ease-out" key={`${activeBucketKey}-albums`}>
              {(activeBucket.albums || []).map((album) => {
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
          </div>
        ) : !USE_TASTE_CHIPS && albums.length > 0 ? (
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
