Music Atlas — Phase 4 Decisions (LOCKED)
Overall Philosophy

Strict separation of concerns:

Taste = “sounds similar”

Structure = “real-world connections”

Macro tags = labeling & exploration only

Geo = context,️ & orientation

No signal is allowed to “leak” into another’s role.

Taste Graph (Primary Similarity)

Only source: MusicBrainz positive tags
(artist_tag_profile_core_v3)

Similarity metric: IDF-weighted Jaccard

Hub control:

Max 15 tags per artist

Max 800 artists per tag

Edges:

Top-50 neighbors per artist

Directed

Stored in artist_edges_taste_v3_topk

Guarantee:

Similarity is purely sonic

No structure, no labels, no geography

Structure Graph (Explanations + Light Reranking)

Never used for candidate generation

Used only at query time

Edge types (all hub-controlled):

members

credits

labels

events

country

Unified view:

artist_structure_edges_v1

Directionality preserved; handled bidirectionally at query time

Hybrid Retrieval (Phase 4 Core)

Seed candidates via taste graph

Attach structure explanations

Optional structure-aware reranking

Attach labels + geo for UX

Structure-Aware Reranking (LOCKED)

Base score = taste similarity

Type-weighted boost (max-only, no stacking):

members → +0.15

credits → +0.12

labels → +0.06

events → +0.04

country → +0.02

Reranking:

Conservative

Taste always dominates

Structure nudges only

Macro Tags — TWO DISTINCT ROLES (CRITICAL)
1️⃣ Seed-Centric Labels (“Artist is…”)

Purpose: describe the actual sound/identity of the artist

Data:

Artist’s own macro tags

Scoring:

tag_count × inverse global ref_count

Filters:

Remove geo adjectives (american, etc.)

Suppress ultra-generic tags

Output:

Top-5 with decay weights

UX:

Canonical description

Stable, conservative

2️⃣ Set-Centric Labels (“From here, explore…”)

Purpose: show adjacent stylistic directions

Data:

Macro tags across top-50 recommendations

Scoring:

Relative lift (within-set frequency vs global frequency)

Filters:

Remove geo adjectives

Require multi-artist coverage

Output:

Top-3 exploration labels

UX:

Exploratory, permissive

Explicitly not identity

Geo Labels (B2 — City + Country)

Source:

artist_area_bipartite_v2 + area table

Roles:

Seed geo → orientation (“Seattle, US”)

Neighbor geo badges → light context

Rules:

Best-effort

City optional

Country expected

Geo is never used for similarity

Cold-Start Strategy (LOCKED)

When a TIDAL favorite artist is missing from the taste universe:

Attempt MusicBrainz mapping

If mapped but not in taste graph:

Use seed-centric macro + geo

No taste similarity

Fallback proxy

Use macro tags + labels + country

Exploration only

No “sounds like” claim

Materialization Policy

Do NOT materialize:

macro labels

reranked scores

explanations

These are:

query-time logic

product-sensitive

still evolving

Lock the logic, not tables.

Embeddings Policy (Next Phase)

Embeddings are:

supplemental

taste-only

never authoritative

No embeddings trained on:

structure

macro tags

geography