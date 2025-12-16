// Collected artists for Sonic Fingerprint tag cloud
let tidalArtistInputs = [];
let spotifyArtistInputs = [];
let tidalArtistMeta = [];
let spotifyArtistMeta = [];

function normalizePopularity(value) {
    if (value === null || value === undefined) return null;
    const num = Number(value);
    if (Number.isNaN(num)) return null;
    if (num <= 1) return Math.round(num * 100);
    return Math.round(Math.min(100, Math.max(0, num)));
}

function simplifySpotifyPayload(artist) {
    const images = artist.images || [];
    const imageUrl = images[0]?.url || artist.imageUrl || null;
    return {
        id: artist.id,
        name: artist.name,
        popularity: normalizePopularity(artist.popularity),
        genres: Array.isArray(artist.genres) ? artist.genres : [],
        followers_total: artist.followers?.total,
        imageUrl,
    };
}


function loginWithTidal() {
    window.location.href = "/auth/tidal/login";
}

function loginWithSpotify() {
    window.location.href = "/auth/spotify/login";
}

// ---- TIDAL ----

async function checkTidalSession() {
    const loginImg = document.getElementById("tidalLoginBtn");

    try {
        const res = await fetch(`/auth/tidal/session`, {
            method: "GET",
            credentials: "include",
            headers: { "Accept": "application/json" },
        });

        if (!res.ok) {
            console.warn("TIDAL session check failed:", res.status);
            if (loginImg) loginImg.classList.remove("hidden");
            return;
        }

        const data = await res.json();
        if (data.logged_in) {
            if (loginImg) loginImg.classList.add("hidden");
            await loadTidalFavoriteArtists();
        } else {
            if (loginImg) loginImg.classList.remove("hidden");
        }
    } catch (err) {
        console.error("checkTidalSession error:", err);
        if (loginImg) loginImg.classList.remove("hidden");
    }
}

async function loadTidalFavoriteArtists() {
    const container = document.getElementById("tidalFavorites");
    if (!container) return;

    container.innerHTML = "Loading TIDAL favorite artists...";

    try {
        const res = await fetch(`/tidal/favorites/artists?limit=50`, {
            method: "GET",
            credentials: "include",
            headers: { "Accept": "application/json" },
        });

        if (!res.ok) {
            const msg = `Failed to load TIDAL favorites (HTTP ${res.status})`;
            console.error(msg);
            container.innerHTML = msg;
            return;
        }

        const data = await res.json();

        const rawItems = data.data || [];

        // newest first
        rawItems.sort((a, b) => {
            const tA = new Date(a.meta?.addedAt || 0).getTime();
            const tB = new Date(b.meta?.addedAt || 0).getTime();
            return tB - tA;
        });

        const totalCount = rawItems.length;
        const artistResources = (data.included || []).filter(
            (resource) => resource.type === "artists"
        );

        const resourceMap = new Map(
            artistResources.map((res) => [String(res.id), res])
        );

        const fullArtistList = rawItems.map((entry) => {
            const full = resourceMap.get(String(entry.id));
            const attrs = full?.attributes || {};
            return {
                id: entry.id,
                name: attrs.name || "Unknown",
                imageUrl: attrs.imageUrl || null, // enriched by backend
            };
        });

        // TIDAL: keep the basic list only; skip detail lookups to avoid rate limits.
        tidalArtistMeta = fullArtistList.map((artist) => ({
            ...artist,
            popularity: null,
        }));

        const recentArtists = fullArtistList.slice(0, 5);

        // Update global TIDAL artist inputs for Sonic Tags (use all available)
        tidalArtistInputs = tidalArtistMeta.map((artist) => ({
            name: artist.name,
            source: "tidal",
            source_id: artist.id,
            country_code: null,
            popularity: artist.popularity,
            genres: [],
        }));
        updateAggregates();

        renderArtistStrip(
            container,
            recentArtists,
            "Recently Favorited Artists (Top 5)",
            totalCount,
            tidalArtistMeta
        );
    } catch (err) {
        console.error("Error loading TIDAL favorites:", err);
        container.innerHTML = "Error loading TIDAL favorites (see console).";
    }
}

// ---- Spotify ----

async function checkSpotifySession() {
    const loginImg = document.getElementById("spotifyLoginBtn");

    try {
        const res = await fetch(`/auth/spotify/session`, {
            method: "GET",
            credentials: "include",
            headers: { "Accept": "application/json" },
        });

        if (!res.ok) {
            console.warn("Spotify session check failed:", res.status);
            if (loginImg) loginImg.classList.remove("hidden");
            return;
        }

        const data = await res.json();

        if (data.logged_in) {
            if (loginImg) loginImg.classList.add("hidden");
            await loadSpotifyTopArtists();
        } else {
            if (loginImg) loginImg.classList.remove("hidden");
        }
    } catch (err) {
        console.error("checkSpotifySession error:", err);
        if (loginImg) loginImg.classList.remove("hidden");
    }
}

async function loadSpotifyTopArtists() {
    clearError();
    const container = document.getElementById("spotifyTopArtists");
    if (!container) return;

    container.innerHTML = "Loading Spotify top artists...";

    try {
        const res = await fetch(`/spotify/top-artists?limit=20`, {
            method: "GET",
            credentials: "include",
            headers: { "Accept": "application/json" },
        });

        if (!res.ok) {
            const text = await res.text();
            showError("Failed to load Spotify top artists: " + text);
            container.innerHTML = "";
            return;
        }

        const payload = await res.json();
        const items = payload.items || [];

        // Fetch richer details per artist (followers, genres, popularity)
        const detailed = await Promise.all(
            items.map(async (artist) => {
                try {
                    const resp = await fetch(`/spotify/artist/${encodeURIComponent(artist.id)}`, {
                        method: "GET",
                        credentials: "include",
                        headers: { "Accept": "application/json" },
                    });
                    if (!resp.ok) throw new Error(`status ${resp.status}`);
                    return await resp.json();
                } catch (err) {
                    console.warn("Failed to load Spotify artist detail", artist.id, err);
                    return simplifySpotifyPayload(artist);
                }
            })
        );

        spotifyArtistMeta = detailed.map((artist) => ({
            id: artist.id,
            name: artist.name,
            imageUrl: artist.imageUrl || artist.image_url,
            popularity: normalizePopularity(artist.popularity),
            genres: Array.isArray(artist.genres) ? artist.genres : [],
            followers_total: artist.followers_total,
        }));

        // Update global Spotify artist inputs for Sonic Tags (use all retrieved)
        spotifyArtistInputs = spotifyArtistMeta.map((artist) => ({
            name: artist.name,
            source: "spotify",
            source_id: artist.id,
            country_code: null,
            popularity: artist.popularity,
            genres: artist.genres,
        }));
        updateAggregates();

        if (!items.length) {
            container.innerHTML = "<p>No Spotify top artists found.</p>";
            return;
        }

        const topFive = items.slice(0, 5).map((artist) => ({
            id: artist.id,
            name: artist.name,
            imageUrl: artist.imageUrl || null,
        }));

        renderArtistStrip(
            container,
            topFive,
            "Spotify Top Artists (Top 5)",
            items.length,
            spotifyArtistMeta
        );
    } catch (err) {
        container.innerHTML = "";
        showError("Network error loading Spotify artists: " + err.message);
    }
}

// ---- Shared UI helpers ----

function renderArtistStrip(container, artists, title, totalCount, metaList = []) {
    container.innerHTML = "";

    const titleEl = document.createElement("div");
    titleEl.className = "section-title";
    titleEl.textContent = title;
    container.appendChild(titleEl);

    const strip = document.createElement("div");
    strip.className = "artist-strip";

    artists.forEach((artist) => {
        const tile = document.createElement("div");
        tile.className = "artist-tile";

        const imgWrapper = document.createElement("div");
        imgWrapper.className = "artist-tile-image";

        if (artist.imageUrl) {
            const img = document.createElement("img");
            img.src = artist.imageUrl;
            img.alt = artist.name;
            imgWrapper.appendChild(img);
        } else {
            const placeholder = document.createElement("div");
            placeholder.className = "artist-tile-placeholder";
            placeholder.textContent = artist.name.charAt(0).toUpperCase();
            imgWrapper.appendChild(placeholder);
        }

        const nameEl = document.createElement("div");
        nameEl.className = "artist-tile-name";
        nameEl.textContent = artist.name;

        tile.appendChild(imgWrapper);
        tile.appendChild(nameEl);
        strip.appendChild(tile);
    });

    container.appendChild(strip);

    if (typeof totalCount === "number") {
        const more = document.createElement("div");
        more.className = "more-count";
        if (totalCount > artists.length) {
            more.textContent = `and ${totalCount - artists.length} more...`;
        } else {
            more.textContent = `Total: ${totalCount}`;
        }
        container.appendChild(more);
    }

    const popularityValues = metaList
        .map((a) => normalizePopularity(a.popularity))
        .filter((v) => typeof v === "number");
    if (popularityValues.length) {
        const spark = document.createElement("div");
        spark.className = "popularity-sparkline";
        const maxVal = Math.max(...popularityValues, 1);
        popularityValues.forEach((val) => {
            const bar = document.createElement("div");
            bar.className = "spark-bar";
            bar.style.height = `${8 + (val / 100) * 12}px`;
            bar.style.width = `${100 / Math.min(popularityValues.length, 20)}%`;
            spark.appendChild(bar);
        });
        container.appendChild(spark);
    }
}

function updateSeedCounts() {
    const total = tidalArtistInputs.length + spotifyArtistInputs.length;
    const target = document.getElementById("seedCount");
    if (!target) return;
    if (!total) {
        target.textContent = "No artists loaded yet.";
    } else {
        target.textContent = `Total seed artists in session: ${total}`;
    }
}

function computePopularityStats() {
    const bySource = {
        tidal: tidalArtistInputs.map((a) => normalizePopularity(a.popularity)).filter((v) => v !== null),
        spotify: spotifyArtistInputs.map((a) => normalizePopularity(a.popularity)).filter((v) => v !== null),
    };

    const overallValues = [...bySource.tidal, ...bySource.spotify];
    const avg = (vals) => (vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null);

    return {
        overall: avg(overallValues),
        sources: {
            tidal: avg(bySource.tidal),
            spotify: avg(bySource.spotify),
        },
    };
}

function renderPopularityStats() {
    const container = document.getElementById("popularityStats");
    if (!container) return;
    const stats = computePopularityStats();
    container.innerHTML = "";

    const makeBar = (label, value) => {
        const row = document.createElement("div");
        row.className = "stat-row";
        const text = document.createElement("div");
        text.className = "stat-label";
        text.textContent = label;
        const barWrap = document.createElement("div");
        barWrap.className = "stat-bar";
        const bar = document.createElement("div");
        bar.className = "stat-bar-fill";
        bar.style.width = `${value}%`;
        bar.textContent = value !== null ? `${value}` : "—";
        barWrap.appendChild(bar);
        row.appendChild(text);
        row.appendChild(barWrap);
        return row;
    };

    if (stats.overall !== null) {
        container.appendChild(makeBar("Overall signal", stats.overall));
    }
    if (stats.sources.tidal !== null) {
        container.appendChild(makeBar("TIDAL", stats.sources.tidal));
    }
    if (stats.sources.spotify !== null) {
        container.appendChild(makeBar("Spotify", stats.sources.spotify));
    }
}

function renderGenreMix() {
    const container = document.getElementById("genreMix");
    if (!container) return;
    const counts = new Map();

    const addGenres = (genres, source) => {
        if (!Array.isArray(genres)) return;
        genres.forEach((g) => {
            if (!g) return;
            const key = g.trim().toLowerCase();
            if (!key) return;
            if (!counts.has(key)) {
                counts.set(key, { count: 0, sources: new Set() });
            }
            const entry = counts.get(key);
            entry.count += 1;
            entry.sources.add(source);
        });
    };

    spotifyArtistInputs.forEach((a) => addGenres(a.genres, "spotify"));
    tidalArtistInputs.forEach((a) => addGenres(a.genres, "tidal"));

    const sorted = Array.from(counts.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 7);

    container.innerHTML = "";
    if (!sorted.length) {
        container.textContent = "Genres will appear after syncing Spotify.";
        return;
    }

    sorted.forEach(([genre, info]) => {
        const pill = document.createElement("span");
        pill.className = "genre-pill";
        pill.textContent = genre;
        const sourceLabel = document.createElement("span");
        sourceLabel.className = "genre-source";
        if (info.sources.size === 2) {
            sourceLabel.textContent = "S+T";
        } else if (info.sources.has("spotify")) {
            sourceLabel.textContent = "S";
        } else if (info.sources.has("tidal")) {
            sourceLabel.textContent = "T";
        }
        pill.appendChild(sourceLabel);
        container.appendChild(pill);
    });
}

function renderArtistDataTable() {
    const container = document.getElementById("artistDataTable");
    if (!container) return;

    const rows = [
        ...spotifyArtistMeta.map((a) => ({ ...a, source: "Spotify" })),
        ...tidalArtistMeta.map((a) => ({ ...a, source: "TIDAL" })),
    ];

    if (!rows.length) {
        container.innerHTML = "<p class='muted'>Artist data will appear after syncing.</p>";
        return;
    }

    const table = document.createElement("table");
    table.className = "artist-table";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    ["Source", "Artist", "Popularity", "Genres"].forEach((col) => {
        const th = document.createElement("th");
        th.textContent = col;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);

    const tbody = document.createElement("tbody");
    rows.forEach((row) => {
        const tr = document.createElement("tr");

        const src = document.createElement("td");
        src.textContent = row.source;
        src.className = "artist-table-source";
        tr.appendChild(src);

        const name = document.createElement("td");
        name.textContent = row.name || "Unknown";
        tr.appendChild(name);

        const pop = document.createElement("td");
        const popVal = row.popularity;
        if (typeof popVal === "number") {
            const bar = document.createElement("div");
            bar.className = "table-pop-bar";
            const fill = document.createElement("div");
            fill.className = "table-pop-fill";
            fill.style.width = `${popVal}%`;
            fill.textContent = popVal;
            bar.appendChild(fill);
            pop.appendChild(bar);
        } else {
            pop.textContent = "—";
        }
        tr.appendChild(pop);

        const genres = document.createElement("td");
        const genreList = Array.isArray(row.genres) ? row.genres : [];
        genres.textContent = genreList.slice(0, 3).join(", ") || "—";
        tr.appendChild(genres);

        tbody.appendChild(tr);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    container.innerHTML = "";
    container.appendChild(table);
}

function updateAggregates() {
    updateSeedCounts();
    renderPopularityStats();
    renderGenreMix();
    renderArtistDataTable();
}

function showError(msg) {
    const errBox = document.getElementById("error");
    errBox.style.display = "block";
    errBox.innerText = msg;
}

function clearError() {
    const errBox = document.getElementById("error");
    errBox.style.display = "none";
    errBox.innerText = "";
}

function renderArtistCard(data) {
    const results = document.getElementById("results");
    if (!results) return;

    results.innerHTML = "";

    // Basic card for MB-enriched artist
    const card = document.createElement("div");
    card.className = "artist-card";

    const header = document.createElement("div");
    header.className = "artist-info";

    const nameEl = document.createElement("h2");
    nameEl.textContent = data.name || "Unknown artist";

    const metaEl = document.createElement("p");
    const country = data.country || "Unknown country";
    const tags = (data.tags || []).map((t) => t.name).join(", ");
    metaEl.textContent = `${country}${tags ? " • " + tags : ""}`;

    header.appendChild(nameEl);
    header.appendChild(metaEl);
    card.appendChild(header);

    results.appendChild(card);
}

// ---- Sonic Tags (Sonic Fingerprint v0) ----

async function buildSonicTags() {
    clearError();
    const container = document.getElementById("sonicTagsArea");
    if (!container) return;

    container.innerHTML = "Building Sonic Tag Cloud from your artists...";

    // Merge artists from all sources
    const allArtists = [...tidalArtistInputs, ...spotifyArtistInputs];

    if (!allArtists.length) {
        container.innerHTML = "<p>No artists loaded yet. Log in with TIDAL and/or Spotify first.</p>";
        return;
    }

    try {
        const res = await fetch(`/user/sonic-tags`, {
            method: "POST",
            credentials: "include",
            headers: {
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            body: JSON.stringify(allArtists),
        });

        if (!res.ok) {
            const text = await res.text();
            showError("Failed to build sonic tags: " + text);
            container.innerHTML = "";
            return;
        }

        const data = await res.json();
        renderTagCloud(container, data.tag_cloud || []);
        // Later we can also use data.canonical_artists for richer UI.
    } catch (err) {
        showError("Network error building sonic tags: " + err.message);
        container.innerHTML = "";
    }
}

function renderTagCloud(container, tags) {
    container.innerHTML = "";

    if (!tags.length) {
        container.innerHTML = "<p>No tags found for your current artists.</p>";
        return;
    }

    const cloud = document.createElement("div");
    cloud.className = "tag-cloud";

    tags.forEach((tag) => {
        const span = document.createElement("span");
        const score = tag.score ?? 0;

        let sizeClass = "small";
        if (score >= 0.75) {
            sizeClass = "large";
        } else if (score >= 0.4) {
            sizeClass = "medium";
        }

        span.classList.add(sizeClass);
        span.textContent = tag.name;
        cloud.appendChild(span);
    });

    container.appendChild(cloud);
}

// ---- MB search ----

async function searchByName() {
    clearError();
    const input = document.getElementById("artistInput");
    if (!input) return;

    const query = input.value.trim();
    if (!query) {
        showError("Please enter an artist name.");
        return;
    }

    const results = document.getElementById("results");
    if (results) {
        results.innerHTML = "Searching...";
    }

    try {
        const res = await fetch(`/mb/artist/enriched/by-name?name=${encodeURIComponent(query)}`, {
            method: "GET",
            headers: { "Accept": "application/json" },
        });

        if (!res.ok) {
            const text = await res.text();
            showError("Search failed: " + text);
            if (results) results.innerHTML = "";
            return;
        }

        const data = await res.json();
        renderArtistCard(data);

    } catch (err) {
        showError("Network error: " + err.message);
    }
}

// On page load, see if we have sessions and auto-load artists
window.addEventListener("load", () => {
    checkTidalSession();
    checkSpotifySession();
    updateAggregates();
});
