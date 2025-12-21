-- Taste profile scaffolding: Spotify genres, cluster rollups, and labels.
-- Run this against the MusicBrainz DB (MB_DATABASE_URL).

BEGIN;

-- 1) Spotify genres per artist (MusicBrainz artist_id)
CREATE TABLE IF NOT EXISTS public.artist_spotify_genres_v1 (
    artist_id      INT PRIMARY KEY,
    spotify_genres TEXT[] NOT NULL DEFAULT '{}',
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2) Artist -> cluster weights (via tag clusters)
CREATE OR REPLACE VIEW public.artist_cluster_profile_v1 AS
SELECT
    atp.artist_id,
    tc.cluster_id,
    SUM(
        COALESCE(atp.tag_weight, atp.tag_count, 1)::NUMERIC
        * COALESCE(tc.weight, tc.tag_weight, 1)::NUMERIC
    ) AS cluster_weight
FROM public.artist_tag_profile_core_v3 atp
JOIN public.tag_clusters_v1 tc USING (tag_id)
GROUP BY atp.artist_id, tc.cluster_id;

-- 3) User taste clusters aggregated from seed artists
CREATE OR REPLACE VIEW public.user_taste_clusters_v1 AS
WITH uc AS (
    SELECT
        usa.user_id,
        acp.cluster_id,
        SUM(acp.cluster_weight * COALESCE(usa.weight, 1)) AS weight
    FROM public.user_seed_artists_v1 usa
    JOIN public.artist_cluster_profile_v1 acp ON acp.artist_id = usa.artist_id
    GROUP BY usa.user_id, acp.cluster_id
)
SELECT
    user_id,
    cluster_id,
    weight,
    ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY weight DESC) AS rank
FROM uc;

-- 4) Cluster labels from Spotify genres
CREATE OR REPLACE VIEW public.cluster_labels_spotify_v1 AS
WITH base AS (
    SELECT
        acp.cluster_id,
        acp.cluster_weight,
        unnest(ag.spotify_genres) AS genre
    FROM public.artist_cluster_profile_v1 acp
    JOIN public.artist_spotify_genres_v1 ag ON ag.artist_id = acp.artist_id
    WHERE acp.cluster_weight >= 0.01
),
agg AS (
    SELECT cluster_id, genre, SUM(cluster_weight) AS weight
    FROM base
    GROUP BY cluster_id, genre
),
ranked AS (
    SELECT
        cluster_id,
        genre,
        weight,
        ROW_NUMBER() OVER (PARTITION BY cluster_id ORDER BY weight DESC) AS rn
    FROM agg
)
SELECT
    cluster_id,
    MAX(CASE WHEN rn = 1 THEN genre END) AS label_primary,
    MAX(CASE WHEN rn = 2 THEN genre END) AS label_secondary,
    JSONB_AGG(
        JSONB_BUILD_OBJECT('genre', genre, 'weight', weight)
        ORDER BY weight DESC
    ) AS top_spotify_genres
FROM ranked
GROUP BY cluster_id;

COMMIT;
