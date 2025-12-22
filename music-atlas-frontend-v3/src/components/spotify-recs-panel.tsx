'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, apiFetch } from '@/lib/api';

type SessionResponse = { logged_in: boolean; [key: string]: unknown };

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
  taste_bucket_id?: string | number | null;
  cluster_id?: number | null;
};

type TasteBucket = {
  cluster_id: number | null;
  bucket_id?: string | number | null;
  label_primary: string;
  label_secondary?: string | null;
  weight_share?: number | null;
  album_count?: number | null;
  albums?: AlbumRec[];
};

type TasteProfileResponse = {
  buckets: TasteBucket[];
  taste_clusters?: unknown[];
  validation?: unknown;
};

type JobProgress = {
  stage?: string | null;
  counts?: Record<string, number>;
};

type JobCreatedResponse = {
  job_id: string;
  status: string;
  status_url: string;
  result_url: string;
  progress?: JobProgress;
};

type JobStatusResponse = {
  job_id: string;
  status: 'queued' | 'running' | 'done' | 'error';
  progress?: JobProgress;
  error?: string | null;
};

type AlbumRecsPayload =
  | AlbumRec[]
  | {
      albums?: AlbumRec[];
      buckets?: TasteBucket[];
      taste_clusters?: unknown[];
    };

type SessionState = {
  status: 'unknown' | 'logged_out' | 'logged_in' | 'error';
  data?: SessionResponse | null;
  error?: string;
};

type SeedsState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  artists: SpotifyArtist[];
  error?: string;
};

type TasteState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  buckets: TasteBucket[];
  tasteClusters?: unknown[];
  validation?: unknown;
  lastUpdated?: number;
  error?: string;
};

type RecsState = {
  status: 'idle' | 'loading' | 'success' | 'error' | 'timeout' | 'cancelled';
  rawAlbums: AlbumRec[];
  buckets?: TasteBucket[];
  error?: string;
  startedAt?: number | null;
  lastSuccessfulAt?: number | null;
  addedAlbums: AlbumRec[];
  addedArtistName?: string;
  jobId?: string | null;
  progress?: JobProgress | null;
};

type UiState = {
  selectedBucketId?: string;
  moreMenuOpen: boolean;
  artistsPanelExpanded: boolean;
};

const RECS_TIMEOUT_MS = 300_000;
const JOB_POLL_INTERVAL_MS = 1_000;
const ADDED_BUCKET_ID = '__added__';
const normalizePopularity = (value: unknown) => {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (Number.isNaN(num)) return null;
  if (num <= 1) return Math.round(num * 100);
  return Math.round(Math.min(100, Math.max(0, num)));
};

const formatErrorMessage = (error: unknown) => {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Unexpected error';
};

const isTimeoutLike = (error: unknown) => {
  if (error instanceof ApiError && (error.status === 504 || /timeout/i.test(error.message))) return true;
  if (error instanceof Error) return /timeout|network|ECONNRESET/i.test(error.message);
  return false;
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const describeStage = (stage?: string | null) => {
  if (!stage) return '';
  switch (stage) {
    case 'queued':
      return 'Queued';
    case 'resolving_seeds':
      return 'Resolving artists';
    case 'resolved':
      return 'Resolved artists';
    case 'fetching_recs':
      return 'Fetching recommendations';
    case 'enriching_spotify':
      return 'Enriching with Spotify';
    case 'done':
      return 'Finalizing';
    case 'error':
      return 'Failed';
    default:
      return stage.replace(/_/g, ' ');
  }
};

const bucketKey = (bucket: TasteBucket) => {
  if (bucket.cluster_id !== null && bucket.cluster_id !== undefined) return `cluster-${bucket.cluster_id}`;
  if (bucket.bucket_id !== null && bucket.bucket_id !== undefined) return String(bucket.bucket_id);
  if (bucket.label_primary?.toLowerCase() === 'other') return 'other';
  return bucket.label_primary || 'bucket';
};

const isOtherBucket = (bucket: TasteBucket) =>
  bucket.cluster_id === null || bucket.label_primary?.toLowerCase() === 'other';

const sortBuckets = (buckets: TasteBucket[]) => {
  const copy = [...buckets];
  const other = copy.filter((b) => isOtherBucket(b));
  const nonOther = copy.filter((b) => !isOtherBucket(b));
  const sortedNonOther = nonOther.sort((a, b) => {
    const weightDelta = Number(b.weight_share || 0) - Number(a.weight_share || 0);
    if (weightDelta !== 0) return weightDelta;
    return Number(b.album_count || 0) - Number(a.album_count || 0);
  });
  return [...sortedNonOther, ...other];
};

const splitBuckets = (buckets: TasteBucket[]) => {
  const visible: TasteBucket[] = [];
  const more: TasteBucket[] = [];
  buckets.forEach((bucket) => {
    if (isOtherBucket(bucket) || visible.length >= 4) more.push(bucket);
    else visible.push(bucket);
  });
  return { visible, more };
};

const reorderWithPinned = (buckets: TasteBucket[], pinnedId?: string) => {
  if (!pinnedId) return buckets;
  const copied = [...buckets];
  const idx = copied.findIndex((b) => bucketKey(b) === pinnedId);
  if (idx === -1) return buckets;
  const [pinned] = copied.splice(idx, 1);
  const firstNonOther = copied.findIndex((b) => !isOtherBucket(b));
  const targetIndex = firstNonOther === -1 ? 0 : Math.min(firstNonOther + 1, copied.length);
  copied.splice(targetIndex, 0, pinned);
  return copied;
};

const dedupeAlbums = (albums: AlbumRec[]) => {
  const seen = new Set<string>();
  return albums.filter((album) => {
    const key = `${album.release_group_id}-${album.artist_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const normalizeRecsResponse = (payload: AlbumRecsPayload) => {
  if (Array.isArray(payload)) {
    return { rawAlbums: dedupeAlbums(payload), buckets: undefined };
  }

  const rawFromBuckets =
    payload?.buckets?.flatMap((bucket) => bucket.albums || [])?.filter(Boolean) || [];
  const rawAlbums = dedupeAlbums(
    [...(payload?.albums || []), ...rawFromBuckets].filter(Boolean) as AlbumRec[]
  );
  const buckets = payload?.buckets?.map((bucket) => ({
    ...bucket,
    albums: dedupeAlbums(bucket.albums || [])
  }));

  return { rawAlbums, buckets };
};

const mergeBuckets = (base: TasteBucket[], incoming: TasteBucket[]) => {
  const map = new Map<string, TasteBucket>();
  base.forEach((bucket) => {
    map.set(bucketKey(bucket), { ...bucket, albums: [...(bucket.albums || [])] });
  });

  incoming.forEach((bucket) => {
    const key = bucketKey(bucket);
    const existing = map.get(key);
    const mergedAlbums = dedupeAlbums([
      ...(existing?.albums || []),
      ...(bucket.albums || [])
    ]);
    map.set(key, {
      ...existing,
      ...bucket,
      albums: mergedAlbums,
      album_count: bucket.album_count ?? mergedAlbums.length
    });
  });

  return Array.from(map.values());
};

const mergeRecsWithDelta = (
  prev: RecsState,
  delta: { rawAlbums: AlbumRec[]; buckets?: TasteBucket[] },
  selectedBucketId?: string
): RecsState => {
  const rawAlbums = dedupeAlbums([...(delta.rawAlbums || []), ...prev.rawAlbums]);
  const hasBuckets = (prev.buckets?.length || 0) > 0 || (delta.buckets?.length || 0) > 0;
  let buckets = hasBuckets ? prev.buckets || [] : undefined;

  if (delta.buckets?.length) {
    buckets = mergeBuckets(prev.buckets || [], delta.buckets);
  } else if (selectedBucketId && buckets?.length) {
    buckets = buckets.map((bucket) => {
      const key = bucketKey(bucket);
      const incomingAlbums = selectedBucketId === key ? delta.rawAlbums : [];
      const mergedAlbums = dedupeAlbums([...(bucket.albums || []), ...(incomingAlbums || [])]);
      return {
        ...bucket,
        albums: mergedAlbums,
        album_count: bucket.album_count ?? mergedAlbums.length
      };
    });
  } else if (!buckets?.length && rawAlbums.length) {
    buckets = [
      {
        cluster_id: null,
        label_primary: 'All',
        label_secondary: null,
        weight_share: 1,
        album_count: rawAlbums.length,
        albums: rawAlbums
      }
    ];
  }

  return { ...prev, rawAlbums, buckets };
};

const seedsPayload = (artists: SpotifyArtist[]) =>
  artists.map((artist) => ({
    name: artist.name,
    popularity: normalizePopularity(artist.popularity),
    genres: Array.isArray(artist.genres) ? artist.genres : []
  }));

export function SpotifyRecsPanel() {
  const [session, setSession] = useState<SessionState>({ status: 'unknown' });
  const [seeds, setSeeds] = useState<SeedsState>({ status: 'idle', artists: [] });
  const [taste, setTaste] = useState<TasteState>({ status: 'idle', buckets: [] });
  const [addedArtistNames, setAddedArtistNames] = useState<string[]>([]);
  const [recs, setRecs] = useState<RecsState>({
    status: 'idle',
    rawAlbums: [],
    buckets: undefined,
    startedAt: null,
    lastSuccessfulAt: null,
    addedAlbums: [],
    addedArtistName: undefined,
    jobId: null,
    progress: null
  });
  const [ui, setUi] = useState<UiState>({
    selectedBucketId: undefined,
    moreMenuOpen: false,
    artistsPanelExpanded: false
  });
  const [addName, setAddName] = useState('');
  const [addStatus, setAddStatus] = useState<'idle' | 'loading' | 'error' | 'success'>('idle');
  const recsAbortRef = useRef<AbortController | null>(null);
  const recsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const primedRef = useRef(false);
  const [, forceTick] = useState(0);
  const stageText = describeStage(recs.progress?.stage);

  useEffect(() => {
    const timer = setInterval(() => forceTick((v) => v + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const loadSeeds = useCallback(async () => {
    setSeeds((prev) => ({ ...prev, status: 'loading', error: undefined }));
    try {
      const payload = await apiFetch<{ items: SpotifyArtist[] }>('/api/spotify/top-artists?limit=50');
      const items = Array.isArray(payload?.items) ? payload.items : [];
      setSeeds({ status: 'ready', artists: items, error: undefined });
      return items;
    } catch (error) {
      setSeeds({ status: 'error', artists: [], error: formatErrorMessage(error) });
      return [];
    }
  }, []);

  const checkSession = useCallback(async () => {
    try {
      setSession({ status: 'unknown' });
      const data = await apiFetch<SessionResponse>('/api/auth/spotify/session');
      const nextStatus = data?.logged_in ? 'logged_in' : 'logged_out';
      setSession({ status: nextStatus, data });
      if (data?.logged_in) {
        await loadSeeds();
      } else {
        setSeeds({ status: 'idle', artists: [] });
      }
    } catch (error) {
      setSession({ status: 'error', error: formatErrorMessage(error) });
    }
  }, [loadSeeds]);

  const fetchTaste = useCallback(async () => {
    setTaste((prev) => ({ ...prev, status: 'loading', error: undefined }));
    try {
      const resp = await apiFetch<TasteProfileResponse>('/api/taste/profile?validate=1');
      const sorted = sortBuckets(resp?.buckets || []);
      setTaste({
        status: 'ready',
        buckets: sorted,
        tasteClusters: resp?.taste_clusters || [],
        validation: resp?.validation,
        lastUpdated: Date.now()
      });
      setUi((prev) => {
        if (prev.selectedBucketId && sorted.some((b) => bucketKey(b) === prev.selectedBucketId)) {
          return prev;
        }
        const firstBucket = sorted[0];
        return { ...prev, selectedBucketId: firstBucket ? bucketKey(firstBucket) : prev.selectedBucketId };
      });
    } catch (error) {
      setTaste((prev) => ({ ...prev, status: 'error', error: formatErrorMessage(error) }));
    }
  }, []);

  const startRecsRefresh = useCallback(async () => {
    if (!seeds.artists.length) {
      setRecs((prev) => ({ ...prev, status: 'error', error: 'No seed artists loaded yet.' }));
      return;
    }
    if (recsAbortRef.current) {
      recsAbortRef.current.abort();
    }
    const controller = new AbortController();
    recsAbortRef.current = controller;
    setRecs((prev) => ({
      ...prev,
      status: 'loading',
      error: undefined,
      startedAt: Date.now(),
      jobId: null,
      progress: { stage: 'queued', counts: { artists: seeds.artists.length } },
      addedAlbums: [],
      addedArtistName: undefined
    }));
    try {
      const job = await apiFetch<JobCreatedResponse>('/api/recs/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(seedsPayload(seeds.artists)),
        signal: controller.signal
      });
      setRecs((prev) => ({
        ...prev,
        jobId: job.job_id,
        progress: job.progress || prev.progress
      }));

      const pollJob = async () => {
        while (true) {
          if (controller.signal.aborted) {
            throw new Error('Polling aborted');
          }
          const statusPayload = await apiFetch<JobStatusResponse>(`/api/recs/jobs/${job.job_id}`, {
            signal: controller.signal
          });
          setRecs((prev) => ({
            ...prev,
            jobId: job.job_id,
            progress: statusPayload.progress || prev.progress,
            status: statusPayload.status === 'error' ? 'error' : prev.status,
            error:
              statusPayload.status === 'error' ? formatErrorMessage(statusPayload.error || 'Job failed') : prev.error
          }));
          if (statusPayload.status === 'done') {
            break;
          }
          if (statusPayload.status === 'error') {
            throw new Error(statusPayload.error || 'Job failed');
          }
          await wait(JOB_POLL_INTERVAL_MS);
        }
      };

      await pollJob();

      const payload = await apiFetch<AlbumRecsPayload>(`/api/recs/jobs/${job.job_id}/result`, {
        signal: controller.signal
      });
      const normalized = normalizeRecsResponse(payload);
      setRecs((prev) => ({
        ...prev,
        ...normalized,
        status: 'success',
        error: undefined,
        startedAt: prev.startedAt,
        lastSuccessfulAt: Date.now(),
        addedAlbums: [],
        addedArtistName: undefined,
        jobId: job.job_id,
        progress: { stage: 'done', counts: { albums: normalized.rawAlbums.length } }
      }));
      if (taste.status === 'idle') {
        fetchTaste();
      }
    } catch (error) {
      if (controller.signal.aborted) {
        setRecs((prev) => ({ ...prev, status: 'cancelled', error: 'Request cancelled.' }));
      } else {
        const timeout = isTimeoutLike(error);
        setRecs((prev) => ({
          ...prev,
          status: timeout ? 'timeout' : 'error',
          error: prev.error || formatErrorMessage(error)
        }));
      }
    } finally {
      recsAbortRef.current = null;
    }
  }, [fetchTaste, seeds.artists, taste.status]);

  const addArtist = async () => {
    const trimmed = addName.trim();
    if (!trimmed) return;
    setAddStatus('loading');
    try {
      const payload = await apiFetch<AlbumRecsPayload>('/api/recs/albums/add-artist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed })
      });
      const normalized = normalizeRecsResponse(payload);
      setRecs((prev) => {
        const albumIdsInBuckets = new Set<string>();
        taste.buckets.forEach((bucket) =>
          (bucket.albums || []).forEach((album) => albumIdsInBuckets.add(String(album.release_group_id)))
        );
        (prev.buckets || []).forEach((bucket) =>
          (bucket.albums || []).forEach((album) => albumIdsInBuckets.add(String(album.release_group_id)))
        );
        prev.rawAlbums.forEach((album) => albumIdsInBuckets.add(String(album.release_group_id)));
        const incomingUnique = dedupeAlbums(normalized.rawAlbums);
        const unassigned = incomingUnique.filter(
          (album) => !albumIdsInBuckets.has(String(album.release_group_id))
        );
        const merged = mergeRecsWithDelta(prev, normalized, ui.selectedBucketId);
        const dedupedAdded = dedupeAlbums([...unassigned, ...prev.addedAlbums]);
        return {
          ...merged,
          addedAlbums: dedupedAdded,
          addedArtistName: trimmed
        };
      });
      setAddStatus('success');
      setAddName('');
      setAddedArtistNames((prev) => {
        if (prev.includes(trimmed)) return prev;
        return [...prev, trimmed];
      });
      setUi((prev) => ({
        ...prev,
        selectedBucketId: normalized.rawAlbums.length ? ADDED_BUCKET_ID : prev.selectedBucketId
      }));
    } catch (error) {
      setAddStatus('error');
    }
  };

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  useEffect(() => {
    if (recs.status === 'loading') {
      if (recsTimeoutRef.current) clearTimeout(recsTimeoutRef.current);
      recsTimeoutRef.current = setTimeout(() => {
        setRecs((prev) => {
          if (prev.status !== 'loading') return prev;
          recsAbortRef.current?.abort();
          return { ...prev, status: 'timeout', error: 'Album generation is taking longer than expected.' };
        });
      }, RECS_TIMEOUT_MS);
    } else if (recsTimeoutRef.current) {
      clearTimeout(recsTimeoutRef.current);
    }
    return () => {
      if (recsTimeoutRef.current) clearTimeout(recsTimeoutRef.current);
    };
  }, [recs.status]);

  useEffect(() => {
    if (session.status === 'logged_in' && seeds.status === 'ready' && !primedRef.current) {
      primedRef.current = true;
      fetchTaste();
      startRecsRefresh();
    }
  }, [fetchTaste, seeds.status, session.status, startRecsRefresh]);

  const bucketSource = useMemo(() => {
    const base = taste.buckets.length ? taste.buckets : recs.buckets || [];
    const nonEmptyBase = base.filter((bucket) => {
      const count = bucket.album_count ?? bucket.albums?.length ?? 0;
      return count > 0;
    });

    if (!nonEmptyBase.length && recs.rawAlbums.length) {
      return [
        {
          cluster_id: null,
          label_primary: 'All',
          label_secondary: null,
          weight_share: 1,
          album_count: recs.rawAlbums.length,
          albums: recs.rawAlbums
        }
      ];
    }
    const merged = nonEmptyBase.map((bucket) => {
      const recMatch = recs.buckets?.find((b) => bucketKey(b) === bucketKey(bucket));
      const albums = recMatch?.albums ?? bucket.albums ?? [];
      const album_count = recMatch?.album_count ?? bucket.album_count ?? albums.length;
      return { ...bucket, albums, album_count };
    });
    const sorted = sortBuckets(merged);
    const withAdded =
      recs.addedAlbums.length > 0
        ? [
            ...sorted,
            {
              bucket_id: ADDED_BUCKET_ID,
              cluster_id: null,
              label_primary: 'Related to added artists',
              label_secondary: recs.addedArtistName || null,
              album_count: recs.addedAlbums.length,
              albums: recs.addedAlbums,
              weight_share: 0.2
            } as TasteBucket
          ]
        : sorted;
    const withPinned = reorderWithPinned(withAdded, recs.addedAlbums.length > 0 ? ADDED_BUCKET_ID : undefined);
    return withPinned;
  }, [recs.addedAlbums, recs.addedArtistName, recs.buckets, recs.rawAlbums, taste.buckets]);

  useEffect(() => {
    if (!bucketSource.length) return;
    setUi((prev) => {
      const exists = prev.selectedBucketId
        ? bucketSource.some((bucket) => bucketKey(bucket) === prev.selectedBucketId)
        : false;
      if (exists) return prev;
      return { ...prev, selectedBucketId: bucketKey(bucketSource[0]) };
    });
  }, [bucketSource]);

  const { visible: visibleBuckets, more: moreBuckets } = useMemo(
    () => splitBuckets(bucketSource),
    [bucketSource]
  );

  const activeBucket = useMemo(
    () => bucketSource.find((bucket) => bucketKey(bucket) === ui.selectedBucketId) || null,
    [bucketSource, ui.selectedBucketId]
  );

  const activeAlbums =
    ui.selectedBucketId === ADDED_BUCKET_ID
      ? recs.addedAlbums
      : activeBucket?.albums || recs.rawAlbums || [];

  const combinedArtistNames = useMemo(() => {
    const base = seeds.artists.map((artist) => artist.name);
    const all = [...base, ...addedArtistNames];
    const seen = new Set<string>();
    return all.filter((name) => {
      const key = name.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [addedArtistNames, seeds.artists]);

  const sessionLabel =
    session.status === 'logged_in'
      ? 'Spotify connected'
      : session.status === 'logged_out'
        ? 'Not logged in'
        : session.status === 'error'
          ? 'Session error'
          : 'Checking session...';

  const pillTone = (bucket: TasteBucket) => {
    const weight = Math.max(0, Math.min(1, Number(bucket.weight_share || 0)));
    if (weight >= 0.2) return 'border-white/25 bg-white/10';
    if (weight >= 0.1) return 'border-white/15 bg-white/10';
    return 'border-white/10 bg-white/5 opacity-90';
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="sticky top-0 z-20 flex items-center justify-between rounded-2xl border border-white/5 bg-black/60 px-4 py-3 shadow-lg backdrop-blur">
        <div
          className="flex items-center gap-2 text-[1.7rem] font-semibold text-textPrimary tracking-tight"
          style={{ fontFamily: '"IBM Plex Sans", "Inter", system-ui, -apple-system, sans-serif' }}
        >
          Music Atlas
        </div>
        <div className="flex items-center gap-2">
          {session.status !== 'logged_in' ? (
            <button
              onClick={() => {
                window.location.href = '/api/auth/spotify/login';
              }}
              className="inline-flex items-center justify-center rounded-full bg-[#1DB954] px-3 py-2 text-[11px] font-semibold text-black transition hover:scale-[1.01] hover:bg-[#18a74b]"
            >
              Log in with Spotify
            </button>
          ) : null}
        </div>
      </header>

      <section className="card-surface rounded-2xl border border-white/5 bg-panel/70 p-5 shadow-xl shadow-black/40">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-textPrimary">Recent albums, personalized for you.</h2>
            <p className="text-sm text-textMuted">Based on your listening, not trends.</p>
          </div>
          {recs.lastSuccessfulAt ? (
            <span className="text-[11px] text-textMuted">
              Updated {new Date(recs.lastSuccessfulAt).toLocaleTimeString()}
            </span>
          ) : null}
        </div>

        <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-white/10 bg-black/30 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder="Add artist by name"
              className="min-w-[220px] flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-textPrimary placeholder:text-textMuted focus:border-accent focus:outline-none"
            />
            <button
              onClick={addArtist}
              disabled={!addName.trim() || addStatus === 'loading'}
              className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-canvas transition hover:bg-accentMuted disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-textMuted"
            >
              {addStatus === 'loading' ? 'Adding…' : 'Add'}
            </button>
            {addStatus === 'error' ? (
              <span className="text-xs text-rose-200">Failed to add artist.</span>
            ) : addStatus === 'success' ? (
              <span className="text-xs text-emerald-200">Added.</span>
            ) : null}
          </div>
          <p className="text-[11px] text-textMuted">Add an artist to steer recommendations (no login required).</p>
        </div>

        <div className="mt-4 rounded-xl border border-white/10 bg-black/30">
          <button
            onClick={() => setUi((prev) => ({ ...prev, artistsPanelExpanded: !prev.artistsPanelExpanded }))}
            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-sm text-textPrimary transition hover:bg-white/5"
            disabled={seeds.status === 'loading'}
          >
            <span className="text-textMuted">
              {seeds.status === 'loading'
                ? 'Loading your top artists...'
                : combinedArtistNames.length
                  ? `Built from ${combinedArtistNames.length} of your artists`
                  : session.status === 'logged_in'
                    ? 'Top artists not loaded yet.'
                    : 'Log in to pull your top artists.'}
            </span>
            <span className="text-xs text-textMuted">{ui.artistsPanelExpanded ? '▾' : '▸'}</span>
          </button>
          <div
            className={`origin-top overflow-hidden border-t border-white/10 bg-white/5 text-xs text-textPrimary transition-all duration-300 ${
              ui.artistsPanelExpanded ? 'max-h-40 p-3 opacity-100' : 'max-h-0 p-0 opacity-0'
            }`}
          >
            {combinedArtistNames.length ? (
              <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
                {combinedArtistNames.map((name) => (
                  <span key={name} className="truncate">
                    {name}
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-textMuted">No artists loaded yet.</span>
            )}
            {ui.artistsPanelExpanded ? (
              <p className="mt-2 text-[11px] text-textMuted">These artists define your current taste profile.</p>
            ) : null}
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-3">
            {recs.status === 'loading' ? (
              <div className="flex items-center gap-2 text-sm text-textMuted">
                <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                <span className="h-2 w-2 animate-pulse rounded-full bg-accent" style={{ animationDelay: '0.15s' }} />
                <span className="h-2 w-2 animate-pulse rounded-full bg-accent" style={{ animationDelay: '0.3s' }} />
                <span>
                  {stageText ? `Updating recommendations - ${stageText}` : 'Updating recommendations…'}
                </span>
              </div>
            ) : null}

            <div className="flex flex-col gap-3">
              {visibleBuckets.length > 0 || moreBuckets.length > 0 || recs.addedAlbums.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  {recs.addedAlbums.length > 0 ? (
                    <button
                      onClick={() =>
                        setUi((prev) => ({ ...prev, selectedBucketId: ADDED_BUCKET_ID, moreMenuOpen: false }))
                      }
                      className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${pillTone({
                        bucket_id: ADDED_BUCKET_ID,
                        cluster_id: null,
                        label_primary: 'Related to added artists',
                        label_secondary: recs.addedArtistName || null,
                        weight_share: 0.2,
                        album_count: recs.addedAlbums.length,
                        albums: recs.addedAlbums
                      })} ${
                        ui.selectedBucketId === ADDED_BUCKET_ID
                          ? 'border-accent bg-accent/10 text-textPrimary'
                          : 'text-textMuted hover:border-accent hover:text-textPrimary'
                      }`}
                    >
                      {recs.addedArtistName
                        ? `Related to added artists / ${recs.addedArtistName}`
                        : 'Related to added artists'}
                    </button>
                  ) : null}
                  {visibleBuckets.map((bucket) => {
                    const key = bucketKey(bucket);
                    const label = bucket.label_secondary
                      ? `${bucket.label_primary} / ${bucket.label_secondary}`
                      : bucket.label_primary;
                    const isActive = key === ui.selectedBucketId;
                    return (
                      <button
                        key={key}
                        onClick={() => setUi((prev) => ({ ...prev, selectedBucketId: key, moreMenuOpen: false }))}
                        className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${pillTone(bucket)} ${
                          isActive
                            ? 'border-accent bg-accent/10 text-textPrimary'
                            : 'text-textMuted hover:border-accent hover:text-textPrimary'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                  {moreBuckets.length ? (
                    <div className="relative">
                      <button
                        onClick={() => setUi((prev) => ({ ...prev, moreMenuOpen: !prev.moreMenuOpen }))}
                        className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-textMuted transition hover:border-accent hover:text-textPrimary"
                      >
                        More tastes
                      </button>
                      {ui.moreMenuOpen ? (
                        <div className="absolute right-0 z-10 mt-1 w-64 overflow-hidden rounded-lg border border-white/10 bg-black/90 shadow-xl">
                          <div className="px-3 py-2 text-[11px] uppercase tracking-[0.08em] text-textMuted">
                            Additional taste signals
                          </div>
                          {moreBuckets.map((bucket) => {
                            const key = bucketKey(bucket);
                            const label = bucket.label_secondary
                              ? `${bucket.label_primary} / ${bucket.label_secondary}`
                              : isOtherBucket(bucket)
                                ? 'Other (cross-genre / sparse signals)'
                                : bucket.label_primary;
                            const isActive = key === ui.selectedBucketId;
                            return (
                              <button
                                key={key}
                                onClick={() =>
                                  setUi((prev) => ({ ...prev, selectedBucketId: key, moreMenuOpen: false }))
                                }
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
              ) : recs.status === 'loading' ? (
                <div className="flex flex-wrap items-center gap-2">
                  <button className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-textMuted">
                    All
                  </button>
                  <span className="text-xs text-textMuted">
                    {stageText ? `${stageText}…` : 'Building recommendations…'}
                  </span>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <button className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-textMuted">
                    All
                  </button>
                  <span className="text-xs text-textMuted">Sonic fingerprint not available yet.</span>
                </div>
              )}
              {visibleBuckets.length > 0 || moreBuckets.length > 0 ? (
                <p className="text-[11px] text-textMuted">
                  Taste reflects your listening. Recommendations reflect recent releases.
                </p>
              ) : null}

              <div className="flex items-baseline gap-2">
                <div className="text-sm font-semibold text-textPrimary">
                  {activeBucket
                    ? activeBucket.label_secondary
                      ? `${activeBucket.label_primary} / ${activeBucket.label_secondary}`
                      : activeBucket.label_primary
                    : 'All'}
                </div>
                <div className="text-xs text-textMuted">
                  {activeBucket?.album_count ?? activeAlbums.length} albums · recent releases
                </div>
              </div>

              {activeAlbums.length ? (
                <div className="grid gap-3 transition duration-200 ease-out" key={ui.selectedBucketId || 'all'}>
                  {activeAlbums.map((album) => {
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
                      <div key={`${album.release_group_id}-${album.artist_id}`} className="rounded-lg border border-white/5 bg-white/5 p-3 shadow-inner shadow-black/20 transition hover:border-accent/60">
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
                          ) : (
                            <div className="flex h-20 w-20 items-center justify-center rounded-md border border-white/10 bg-black/40 text-xs text-textMuted">
                              No cover
                            </div>
                          )}
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <div className="text-sm font-semibold text-textPrimary">{albumName}</div>
                              {spotifyUrl ? (
                                <a
                                  href={spotifyUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[11px] font-semibold text-[#1DB954] underline-offset-2 hover:underline"
                                >
                                  Open in Spotify
                                </a>
                              ) : null}
                            </div>
                            <div className="text-xs text-textMuted">
                              {album.artist_name}
                              {year ? <span className="text-textMuted"> • {year}</span> : null}
                            </div>
                            {dominant || secondary ? (
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
              ) : recs.status === 'loading' ? (
                <div className="grid gap-3">
                  {[...Array(3)].map((_, idx) => (
                    <div key={idx} className="h-20 animate-pulse rounded-lg border border-white/5 bg-white/5" />
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-white/10 bg-black/30 p-4 text-sm text-textMuted">
                  No albums yet. Try refreshing recommendations or adding an artist manually.
                </div>
              )}
            </div>
          </div>

          {session.status === 'error' || taste.status === 'error' ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-black/30 p-4">
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-50">
                <p className="font-semibold text-rose-100">Something went wrong</p>
                <ul className="mt-1 space-y-1 text-xs text-rose-100">
                  {session.status === 'error' && session.error ? <li>Session: {session.error}</li> : null}
                  {taste.status === 'error' && taste.error ? <li>Taste: {taste.error}</li> : null}
                </ul>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
