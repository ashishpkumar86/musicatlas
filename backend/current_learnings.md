MUSIC ATLAS — GRAPH LEARNING PHASE — CURRENT STATE & LEARNINGS (Memory Document)

North Star

Build an underground-focused discovery system: “artists like X” with scene coherence, lineage, and micro-scene geography, not popularity.

Canonical identity

Node key: artist_id (MusicBrainz integer)

User favorites from TIDAL/Spotify reliably resolve to artist_id

Node mapping exists: artist_id → node_index

Prior graph + failure

Large merged graph: ~573k nodes, ~11.7M unique undirected edges (stored as directed pairs)

Edge semantics were merged (multi-semantic) with weights used mainly for sampling bias

GraphSAGE (homogeneous, 2-layer, neighbor sampling 25→10, negatives=5, dot-product decoder, unsupervised link prediction) collapsed

Empirical failure: Meshuggah/Soundgarden/Pat Metheny neighbors became nonsensical; got worse with training

Root cause: mixed semantics + hub dominance + oversmoothing + weak node features + misaligned objective

Locked decision: Stop GraphSAGE v1 for “artists like X”

Chosen strategy

Hybrid (C):

Taste similarity: Node2Vec-style embeddings on taste-only graph

Structure/lineage: separate graph (members/influence/label)

Geo: essential; aim toward city-level micro-scenes

Combine at query time: α·taste + β·structure (+ geo booster)

Key tables inspected

1) musicbrainz.artist_edges_v1 (mixed semantics; not for taste)
Columns:
src_artist_id, dst_artist_id, edge_type(text), is_directed(bool), weight(float), context_type(text), context_id(int), metric(float), evidence(jsonb), source(text), as_of_date(date)
Useful for: ecosystem/structure. Dangerous for taste.

2) musicbrainz.artists_normalized_v1
Validated: 1 row per artist, no null artist_id.

3) musicbrainz.artist_tag_profile_v1 (taste primitive; best foundation so far)
Columns:
artist_id, tag_id, tag_name, tag_count, tag_weight, tag_rank
Meshuggah example shows meaningful top tags and weights.
Stats:

artists_with_tags ≈ 17,970

avg tags ≈ 2.08, median=2, p90=4, max=35

eligible core with ≥3 tags = 4,555 artists

Taste edge construction attempt

Built artist_edges_taste_v1 from artist_tag_profile_v1:

Only artists with ≥3 tags

Only tag_rank ≤ 5

Similarity = weighted Jaccard over tag_weight

threshold kept edges with similarity ≥ 0.2
Sanity check:

Meshuggah (31416) ↔ Tesseract (514711) similarity ≈ 0.4737 (plausible)
Concern:

Missing expected edge Skyharbor (802750) ↔ Tesseract (514711) likely due to rank gating / thresholding / inconsistent tag profiles.
Decision trend:

leaning toward a full rebuild with stricter preparation + richer MB-derived primitives and relationships.

What’s reusable

Parquet/ETL infrastructure

Memory-safe workflows

Artist identity resolution

Clear falsification of wrong approach (GraphSAGE v1 on mixed graph)

Next rebuild objective

Rebuild from primitives with best practices:

canonical node table

robust artist→tag primitives (potentially expanded beyond current table if justified)

taste edges that are explainable + dense + hub-safe

separate structure edges (members/labels/influence)

geo primitives/edges toward city-level scenes
Only then proceed to embeddings + evaluation.