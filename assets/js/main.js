const DB_FILE = 'data/anime_merged.db';

    let db = null; // sql.js Database instance
    const $input = document.getElementById('searchInput');
    const $results = document.getElementById('searchResults');
    let debounceTimer;

    const $seasonPrevBtn = document.getElementById('seasonPrevBtn');
    const $seasonNextBtn = document.getElementById('seasonNextBtn');
    const $seasonTitleBtn = document.getElementById('seasonTitleBtn');
    const $seasonPickerPanel = document.getElementById('seasonPickerPanel');
    const $sortSelect = document.getElementById('sortSelect');
    const $loadMoreBtn = document.getElementById('loadMoreBtn');
    const $advancedToggleBtn = document.getElementById('advancedToggleBtn');
    const $advancedPanel = document.getElementById('advancedPanel');
    const $sqlInput = document.getElementById('sqlInput');
    const $runSqlBtn = document.getElementById('runSqlBtn');
    const $sqlResults = document.getElementById('sqlResults');
    const $detailView = document.getElementById('detailView');
    const $heroSection = document.getElementById('hero-section');
    const $seasonSection = document.getElementById('season-section');
    const SEASON_LABELS = { WINTER: 'Winter', SPRING: 'Spring', SUMMER: 'Summer', FALL: 'Fall' };
    const SEASON_ORDER = { WINTER: 0, SPRING: 1, SUMMER: 2, FALL: 3 };
    const FAV_STORAGE_KEY = 'anivoice-favorite-voice-actors';

    // Favorite voice actor IDs, persisted in localStorage
    let favoriteIds = loadFavorites();

    // State for the season voice actor list
    let allSeasons = [];       // sorted, newest first
    let currentSeasonIdx = 0;  // index into allSeasons; 0 = newest season
    let currentSort = 'role_count';
    let seasonGridRows = 2; // number of full rows to show on the home VA grid

    // Initialize sql.js & load the .db file
    const $loadScreen = document.getElementById('loadingScreen');
    const $loadBar    = document.getElementById('loadBar');
    const $loadStatus = document.getElementById('loadStatus');

    function setProgress(pct, msg) {
        $loadBar.style.width = pct + '%';
        $loadStatus.textContent = msg;
    }

    function dismissLoadScreen() {
        $loadScreen.classList.add('ls-done');
        // Remove from DOM after transition so it never interferes with layout
        $loadScreen.addEventListener('transitionend', () => $loadScreen.remove(), { once: true });
    }

    async function init() {
        const $grid = document.getElementById('seasonGrid');
        const loadStart = Date.now();
        const MIN_DISPLAY_MS = 5000;

        try {
            // Phase 1 — load the sql.js WASM engine (~30%)
            setProgress(10, 'Loading database engine…');
            const SQL = await initSqlJs({
                locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${file}`
            });
            setProgress(30, 'Downloading database…');

            // Phase 2 — fetch the .db file, tracking download progress (~30% → 75%)
            const res = await fetch(DB_FILE);
            if (!res.ok) throw new Error(`${DB_FILE} not found (HTTP ${res.status})`);

            const contentLength = res.headers.get('Content-Length');
            const total = contentLength ? parseInt(contentLength, 10) : null;
            const reader = res.body.getReader();
            const chunks = [];
            let received = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                received += value.length;
                if (total) {
                    const dlPct = 30 + Math.round((received / total) * 40);
                    const mb = (received / 1048576).toFixed(1);
                    setProgress(dlPct, `Downloading… ${mb} MB`);
                } else {
                    // No Content-Length: pulse between 30–70
                    const mb = (received / 1048576).toFixed(1);
                    setProgress(50, `Downloading… ${mb} MB`);
                }
            }

            // Phase 3 — parse into sql.js in-memory database (~75% → 100%)
            setProgress(75, 'Parsing database…');
            const totalLen = chunks.reduce((s, c) => s + c.length, 0);
            const merged   = new Uint8Array(totalLen);
            let offset = 0;
            for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
            db = new SQL.Database(merged);

            setProgress(100, 'Ready');
            // Ensure the screen is visible for at least MIN_DISPLAY_MS
            const elapsed = Date.now() - loadStart;
            const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);
            if (remaining > 0) await new Promise(r => setTimeout(r, remaining));
            dismissLoadScreen();

            document.getElementById('year').textContent = new Date().getFullYear();
            $input.disabled = false;
            $advancedToggleBtn.disabled = false;
            loadDbStats();
            renderHeroStats();
            initSeasons();
            initAdvancedSearch();

        } catch (err) {
            setProgress(0, '');
            $loadBar.style.background = 'var(--danger)';
            $loadStatus.innerHTML = `<span style="color:var(--danger)">Error: ${err.message}</span>`;
            // Also show retry in grid for after screen is manually closed
            $grid.innerHTML = `<div class="error-msg">Database error: ${err.message}<br>Make sure anime_merged.db is in the same folder and the page is opened via a local server (not file://).<br><button class="retry-btn" onclick="location.reload()">Retry</button></div>`;
            console.error('Init Error:', err);
        }
    }

    // Helper: run a SQL query with parameters, return an array of objects
    function query(sql, params = []) {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return rows;
    }

    // Show how many anime/characters/voice actors are indexed, with clickable links to browse them
    let dbStatsCache = null;

    function loadDbStats() {
        const row = query(`
            SELECT (SELECT COUNT(*) FROM anime) AS anime_count,
                   (SELECT COUNT(*) FROM characters) AS char_count,
                   (SELECT COUNT(*) FROM voice_actors) AS va_count
        `)[0];
        dbStatsCache = row;
        renderHeroStats();
    }

    function renderHeroStats() {
        if (!dbStatsCache) return;
        const { anime_count, char_count, va_count } = dbStatsCache;
        document.getElementById('heroSubtitle').innerHTML =
            `<a href="#" class="stats-link" onclick="event.preventDefault(); showAnimeListView();">${anime_count.toLocaleString()} anime</a> · ` +
            `<a href="#" class="stats-link" onclick="event.preventDefault(); showCharacterListView();">${char_count.toLocaleString()} characters</a> · ` +
            `<a href="#" class="stats-link" onclick="event.preventDefault(); showVoiceActorListView();">${va_count.toLocaleString()} voice actors</a> indexed, ` +
            `<a href="#" class="stats-link" onclick="event.preventDefault(); showFavoritesView();">favorized: ${favoriteIds.size}</a>`;
    }

    // Favorites: persisted in localStorage so they survive a page reload
    function loadFavorites() {
        try {
            const raw = localStorage.getItem(FAV_STORAGE_KEY);
            return new Set(raw ? JSON.parse(raw) : []);
        } catch (err) {
            console.warn('Could not read favorites from localStorage:', err);
            return new Set();
        }
    }

    function saveFavorites() {
        try {
            localStorage.setItem(FAV_STORAGE_KEY, JSON.stringify([...favoriteIds]));
        } catch (err) {
            console.warn('Could not save favorites to localStorage:', err);
        }
    }

    function isFavorite(id) { return favoriteIds.has(id); }

    // Renders a star toggle button for a voice-actor card (grid context)
    function favStarButton(id) {
        const active = isFavorite(id);
        return `<button class="fav-star ${active ? 'active' : ''}" onclick="event.stopPropagation(); handleFavToggle(${id}, this)" title="${active ? 'Remove from favorites' : 'Add to favorites'}">${active ? '★' : '☆'}</button>`;
    }

    // Renders a star toggle button for the staff detail page (inline, with label)
    function favStarButtonInline(id) {
        const active = isFavorite(id);
        return `<button class="fav-star-inline ${active ? 'active' : ''}" onclick="handleFavToggle(${id}, this)">${active ? '★ Favorited' : '☆ Add to favorites'}</button>`;
    }

    // Renders a compact star toggle button for a voice-actor row in the search dropdown
    function favStarButtonResult(id) {
        const active = isFavorite(id);
        return `<button class="fav-star-result ${active ? 'active' : ''}" onclick="event.stopPropagation(); handleFavToggle(${id}, this)" title="${active ? 'Remove from favorites' : 'Add to favorites'}">${active ? '★' : '☆'}</button>`;
    }

    // Renders a voice-actor grid card (avatar, name, up to 3 anime tags, favorite star).
    // Used by the home season grid, the All Voice Actors list, and the Favorites view.
    // Pass a {season, season_year} object to restrict the anime tags to that season.
    function vaCardHtml(va, seasonFilter) {
        const animeTitles = query(`
            SELECT DISTINCT a.romaji_title
            FROM character_anime_voice_actor cava
            JOIN anime a ON a.id = cava.anime_id
            WHERE cava.voice_actor_id = ? ${seasonFilter ? 'AND a.season = ? AND a.season_year = ?' : ''}
            LIMIT 3
        `, seasonFilter ? [va.id, seasonFilter.season, seasonFilter.season_year] : [va.id]);

        return `
        <div class="card" onclick="showDetail('staff', ${va.id})">
            ${favStarButton(va.id)}
            <div class="card-header">
                <img class="card-avatar" src="${va.image || ''}" alt="" onerror="this.style.display='none'">
                <div class="card-name">${escapeHtml(va.full_name)}</div>
            </div>
            <div class="tag-list">${animeTitles.map(t => `<span class="tag">${escapeHtml(t.romaji_title)}</span>`).join('')}</div>
        </div>`;
    }

    function handleFavToggle(id, btnEl) {
        if (favoriteIds.has(id)) favoriteIds.delete(id); else favoriteIds.add(id);
        saveFavorites();
        renderHeroStats();

        const active = isFavorite(id);
        if (btnEl && btnEl.classList.contains('fav-star-inline')) {
            btnEl.classList.toggle('active', active);
            btnEl.textContent = active ? '★ Favorited' : '☆ Add to favorites';
        } else if (btnEl) {
            btnEl.classList.toggle('active', active);
            btnEl.textContent = active ? '★' : '☆';
            btnEl.title = active ? 'Remove from favorites' : 'Add to favorites';
        }

        // If we're currently viewing the favorites list, refresh it (an unfavorited card disappears)
        if ($detailView.dataset.view === 'favorites') {
            renderFavoritesView();
        }
        // If the home grid is currently filtered to favorites, refresh it too
        if (currentSort === 'favorites') {
            renderVoiceActorHighlights();
        }
    }

    // Shared chrome setup for every full-page list view (favorites, anime/character/VA lists):
    // hides the hero/season sections, activates the detail pane, and pushes history state.
    // Returns false (and does nothing else) if the DB isn't ready yet.
    function enterListView(pushViewName, datasetView, noHistory) {
        if (!db) return false;
        if (!noHistory) pushNav({ view: pushViewName });
        $results.classList.remove('active');
        $heroSection.style.display = 'none';
        $seasonSection.style.display = 'none';
        $detailView.classList.add('active');
        $detailView.dataset.view = datasetView;
        return true;
    }

    function showFavoritesView(noHistory) {
        if (!enterListView('favorites', 'favorites', noHistory)) return;
        renderFavoritesView();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function renderFavoritesView() {
        const $detail = $detailView;
        const ids = [...favoriteIds];

        if (!ids.length) {
            $detail.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">☆</div>
                    <div>No favorites yet.</div>
                    <div style="font-size:13px;margin-top:4px">Click the star on any voice actor to add them here.</div>
                </div>`;
            return;
        }

        const placeholders = ids.map(() => '?').join(',');
        const vas = query(`
            SELECT id, full_name, native_name, image
            FROM voice_actors
            WHERE id IN (${placeholders})
            ORDER BY full_name ASC
        `, ids);

        const cards = vas.map(va => vaCardHtml(va)).join('');

        $detail.innerHTML = `
            <h2 style="font-size:20px;font-weight:600;margin-bottom:20px">Favorite Voice Actors (${vas.length})</h2>
            <div class="grid">${cards}</div>
        `;
    }

    const LIST_PAGE_SIZE = 250;

    function paginationHtml(page, totalPages, prevFn, nextFn) {
        return `
            <div class="list-pagination">
                <button class="nav-arrow" ${page <= 1 ? 'disabled' : ''} onclick="${prevFn}">‹</button>
                <span class="list-page-label">Page ${page} of ${totalPages}</span>
                <button class="nav-arrow" ${page >= totalPages ? 'disabled' : ''} onclick="${nextFn}">›</button>
            </div>`;
    }

    // Anime list view: every anime in the DB, alphabetical, paged 250 at a time
    let animeListPage = 1;

    function showAnimeListView(noHistory) {
        if (!enterListView('anime-list', 'anime-list', noHistory)) return;
        animeListPage = 1;
        renderAnimeListView();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function changeAnimeListPage(delta) {
        animeListPage += delta;
        renderAnimeListView();
    }

    function renderAnimeListView() {
        const $detail = $detailView;
        const total = query(`SELECT COUNT(*) AS n FROM anime`)[0].n;
        const totalPages = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));
        animeListPage = Math.min(Math.max(1, animeListPage), totalPages);

        const rows = query(`
            SELECT id, romaji_title, english_title, cover_image, format, season, season_year
            FROM anime
            ORDER BY romaji_title ASC
            LIMIT ? OFFSET ?
        `, [LIST_PAGE_SIZE, (animeListPage - 1) * LIST_PAGE_SIZE]);

        const cards = rows.map(a => {
            const seasonLabel = a.season && a.season_year ? `${SEASON_LABELS[a.season] || a.season} ${a.season_year}` : (a.season_year || '');
            const sub = [a.format, seasonLabel].filter(Boolean).join(' · ');
            return `
            <div class="card" onclick="showDetail('anime', ${a.id})">
                <div class="card-header">
                    <img class="card-avatar" src="${a.cover_image || ''}" alt="" onerror="this.style.display='none'">
                    <div>
                        <div class="card-name">${escapeHtml(a.english_title || a.romaji_title)}</div>
                        <div class="card-sub">${escapeHtml(sub)}</div>
                    </div>
                </div>
            </div>`;
        }).join('');

        $detail.innerHTML = `
            <div class="section-header" style="margin-bottom:20px">
                <h2 style="font-size:20px;font-weight:600">All Anime (${total})</h2>
                ${paginationHtml(animeListPage, totalPages, 'changeAnimeListPage(-1)', 'changeAnimeListPage(1)')}
            </div>
            <div class="grid">${cards}</div>
        `;
    }

    // Character list view: every character in the DB, alphabetical, paged 250 at a time
    let charListPage = 1;

    function showCharacterListView(noHistory) {
        if (!enterListView('char-list', 'characters', noHistory)) return;
        charListPage = 1;
        renderCharacterListView();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function changeCharacterListPage(delta) {
        charListPage += delta;
        renderCharacterListView();
    }

    function renderCharacterListView() {
        const $detail = $detailView;
        const total = query(`SELECT COUNT(*) AS n FROM characters`)[0].n;
        const totalPages = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));
        charListPage = Math.min(Math.max(1, charListPage), totalPages);

        const rows = query(`
            SELECT c.id, c.full_name, c.native_name, c.image,
                   g.best_role_rank, g.anime_count, a.romaji_title AS sample_anime
            FROM characters c
            JOIN (
                SELECT character_id,
                       MIN(CASE role WHEN 'MAIN' THEN 0 WHEN 'SUPPORTING' THEN 1 ELSE 2 END) AS best_role_rank,
                       COUNT(DISTINCT anime_id) AS anime_count,
                       MIN(anime_id) AS sample_anime_id
                FROM character_anime
                GROUP BY character_id
            ) g ON g.character_id = c.id
            LEFT JOIN anime a ON a.id = g.sample_anime_id
            ORDER BY c.full_name ASC
            LIMIT ? OFFSET ?
        `, [LIST_PAGE_SIZE, (charListPage - 1) * LIST_PAGE_SIZE]);

        const cards = rows.map(c => {
            const animeLabel = c.anime_count > 1 ? `${c.sample_anime} +${c.anime_count - 1}` : (c.sample_anime || '—');
            return `
            <div class="card" onclick="showDetail('character', ${c.id})">
                <div class="card-header" style="margin-bottom:0">
                    <img class="card-avatar" src="${c.image || ''}" alt="" onerror="this.style.display='none'">
                    <div style="min-width:0">
                        <div class="card-name">${escapeHtml(c.full_name)}</div>
                        <div class="card-sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(animeLabel)}</div>
                    </div>
                </div>
            </div>`;
        }).join('');

        $detail.innerHTML = `
            <div class="section-header" style="margin-bottom:20px">
                <h2 style="font-size:20px;font-weight:600">All Characters (${total})</h2>
                ${paginationHtml(charListPage, totalPages, 'changeCharacterListPage(-1)', 'changeCharacterListPage(1)')}
            </div>
            <div class="grid">${cards}</div>
        `;
    }

    // Voice actor list view: every voice actor in the DB, sortable, paged 250 at a time
    let vaListPage = 1;
    let vaListSort = 'role_count';

    function showVoiceActorListView(noHistory) {
        if (!enterListView('va-list', 'voiceactors', noHistory)) return;
        vaListPage = 1;
        renderVoiceActorListView();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function changeVoiceActorListPage(delta) {
        vaListPage += delta;
        renderVoiceActorListView();
    }

    function changeVoiceActorListSort(sort) {
        vaListSort = sort;
        vaListPage = 1;
        renderVoiceActorListView();
    }

    function renderVoiceActorListView() {
        const $detail = $detailView;
        const total = query(`SELECT COUNT(*) AS n FROM voice_actors`)[0].n;
        const totalPages = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));
        vaListPage = Math.min(Math.max(1, vaListPage), totalPages);
        const orderClause = vaListSort === 'name' ? 'va.full_name ASC' : 'role_count DESC, va.full_name ASC';

        const rows = query(`
            SELECT va.id, va.full_name, va.native_name, va.image, COUNT(DISTINCT cava.character_id) AS role_count
            FROM voice_actors va
            LEFT JOIN character_anime_voice_actor cava ON cava.voice_actor_id = va.id
            GROUP BY va.id
            ORDER BY ${orderClause}
            LIMIT ? OFFSET ?
        `, [LIST_PAGE_SIZE, (vaListPage - 1) * LIST_PAGE_SIZE]);

        const cards = rows.map(va => vaCardHtml(va)).join('');

        $detail.innerHTML = `
            <div class="section-header" style="margin-bottom:20px">
                <h2 style="font-size:20px;font-weight:600">All Voice Actors (${total})</h2>
                <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
                    <select class="season-select" onchange="changeVoiceActorListSort(this.value)">
                        <option value="role_count" ${vaListSort === 'role_count' ? 'selected' : ''}>Most Roles</option>
                        <option value="name" ${vaListSort === 'name' ? 'selected' : ''}>Alphabetical (A–Z)</option>
                    </select>
                    ${paginationHtml(vaListPage, totalPages, 'changeVoiceActorListPage(-1)', 'changeVoiceActorListPage(1)')}
                </div>
            </div>
            <div class="grid">${cards}</div>
        `;
    }

    // Advanced search: let the user run their own read-only SQL against the DB
    const SQL_TEMPLATES = {
        topAnime: `SELECT romaji_title, english_title, average_score, season, season_year\nFROM anime\nWHERE average_score IS NOT NULL\nORDER BY average_score DESC\nLIMIT 10;`,
        busiestVas: `SELECT va.full_name, COUNT(DISTINCT cava.character_id) AS roles\nFROM voice_actors va\nJOIN character_anime_voice_actor cava ON cava.voice_actor_id = va.id\nGROUP BY va.id\nORDER BY roles DESC\nLIMIT 10;`,
    };

    function initAdvancedSearch() {
        $advancedToggleBtn.addEventListener('click', () => {
            const isOpen = $advancedPanel.classList.toggle('active');
            $advancedToggleBtn.classList.toggle('open', isOpen);
            if (isOpen) setTimeout(() => $sqlInput.focus(), 300);
        });

        $runSqlBtn.addEventListener('click', runAdvancedQuery);

        document.querySelectorAll('.sql-template-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                $sqlInput.value = SQL_TEMPLATES[btn.dataset.template] || '';
                $sqlInput.focus();
            });
        });

        // Ctrl/Cmd + Enter runs the query without leaving the textarea
        $sqlInput.addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') runAdvancedQuery();
        });
    }

    function runAdvancedQuery() {
        const sql = $sqlInput.value.trim();
        if (!sql) return;

        // Safety: only allow read-only SELECT/WITH statements, and only a single statement
        const normalized = sql.replace(/;+\s*$/, '').trim();
        if (/;/.test(normalized) || !/^(SELECT|WITH)\b/i.test(normalized)) {
            $sqlResults.innerHTML = '<div class="sql-error">Only a single SELECT (or WITH ... SELECT) statement is allowed.</div>';
            return;
        }

        try {
            const result = db.exec(normalized);
            if (!result.length) {
                $sqlResults.innerHTML = '<div class="sql-meta">Query ran successfully — no rows returned.</div>';
                return;
            }
            const { columns, values } = result[0];
            const rowsHtml = values.map(row =>
                `<tr>${row.map(cell => `<td>${escapeHtml(cell === null ? 'NULL' : String(cell))}</td>`).join('')}</tr>`
            ).join('');
            $sqlResults.innerHTML = `
                <div class="sql-meta">${values.length} row${values.length === 1 ? '' : 's'}</div>
                <table>
                    <thead><tr>${columns.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
                    <tbody>${rowsHtml}</tbody>
                </table>`;
        } catch (err) {
            $sqlResults.innerHTML = `<div class="sql-error">${escapeHtml(err.message)}</div>`;
        }
    }

    // Determine available seasons from the DB (only seasons with voice actor data)
    function initSeasons() {
        const seasons = query(`
            SELECT DISTINCT a.season, a.season_year
            FROM anime a
            JOIN character_anime_voice_actor cava ON cava.anime_id = a.id
            WHERE a.season IS NOT NULL AND a.season_year IS NOT NULL
        `);

        seasons.sort((a, b) => b.season_year - a.season_year || SEASON_ORDER[b.season] - SEASON_ORDER[a.season]);
        allSeasons = seasons;

        if (!allSeasons.length) {
            document.querySelector('.season-nav').style.display = 'none';
            document.getElementById('season-title').textContent = 'Voice Actors';
        } else {
            $seasonPrevBtn.addEventListener('click', () => changeSeason(1));
            $seasonNextBtn.addEventListener('click', () => changeSeason(-1));
            $seasonTitleBtn.addEventListener('click', e => {
                e.stopPropagation(); // prevent document outside-click from immediately closing
                toggleSeasonPicker();
            });

            // Single permanent delegation handler — survives innerHTML re-renders.
            // stopPropagation prevents the document outside-click handler from closing the panel.
            $seasonPickerPanel.addEventListener('click', e => {
                e.stopPropagation();

                // Decade nav buttons
                if (e.target.closest('#sppPrev')) {
                    picker.decadeStart -= 8;
                    renderPickerYearGrid();
                    return;
                }
                if (e.target.closest('#sppNext')) {
                    picker.decadeStart += 8;
                    renderPickerYearGrid();
                    return;
                }
                // Year cell — select year, refresh chips, keep panel open
                const yearCell = e.target.closest('.spp-year');
                if (yearCell && !yearCell.classList.contains('empty')) {
                    picker.selectedYear = parseInt(yearCell.dataset.year, 10);
                    renderPickerYearGrid();
                    return;
                }
                // Season chip — apply and keep panel open
                const chip = e.target.closest('.spp-season');
                if (chip && !chip.classList.contains('disabled')) {
                    const season = chip.dataset.season;
                    const idx = allSeasons.findIndex(s => s.season_year === picker.selectedYear && s.season === season);
                    if (idx !== -1) {
                        selectSeason(idx);
                        renderPickerYearGrid(); // re-render to update the ✓ highlight
                    }
                }
            });

            document.addEventListener('click', e => {
                if (!e.target.closest('.season-picker')) $seasonPickerPanel.classList.remove('active');
            });
        }

        $sortSelect.addEventListener('change', () => {
            currentSort = $sortSelect.value;
            seasonGridRows = 2;
            renderVoiceActorHighlights();
        });

        $loadMoreBtn.addEventListener('click', () => {
            seasonGridRows += 1;
            renderVoiceActorHighlights();
        });

        // Recompute how many cards fit per row whenever the window is resized,
        // so the grids keep showing exactly the intended number of full rows.
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                if (!db) return;
                if ($seasonSection.style.display !== 'none') {
                    renderVoiceActorHighlights();
                }
                if (staffDetailState && $detailView.dataset.view === 'staff') {
                    renderStaffDetail(true);
                }
                if (characterDetailState && $detailView.dataset.view === 'character') {
                    renderCharacterDetail(true);
                }
            }, 150);
        });

        updateSeasonNavState();
        renderVoiceActorHighlights();
    }

    // How many cards fit in one row of a given grid at the current width, matching
    // its CSS grid-template-columns: repeat(auto-fill, minmax(<minWidth>px, 1fr)) rule.
    function computeGridColumns(gridId, minWidth, gap) {
        const $grid = document.getElementById(gridId);
        const width = ($grid && ($grid.clientWidth || $grid.parentElement.clientWidth)) || 0;
        return Math.max(1, Math.floor((width + gap) / (minWidth + gap)));
    }

    function computeSeasonGridColumns() {
        return computeGridColumns('seasonGrid', 260, 12);
    }

    // Shared picker state — computed once when picker opens, mutated by nav/year clicks
    const picker = {
        availableSet: null,  // Set of "year|SEASON" strings
        years: null,         // sorted unique years with data
        minYear: 0,
        maxYear: 0,
        decadeStart: 0,      // first year shown in the 8-cell grid
        selectedYear: 0,     // highlighted year (step 1)
    };

    function toggleSeasonPicker() {
        if ($seasonPickerPanel.classList.contains('active')) {
            $seasonPickerPanel.classList.remove('active');
            return;
        }
        // Build lookup tables once
        picker.availableSet = new Set(allSeasons.map(s => `${s.season_year}|${s.season}`));
        picker.years = [...new Set(allSeasons.map(s => s.season_year))].sort((a, b) => a - b);
        picker.minYear = picker.years[0];
        picker.maxYear = picker.years[picker.years.length - 1];

        const currentYear = allSeasons[currentSeasonIdx].season_year;
        picker.selectedYear = currentYear;
        picker.decadeStart  = Math.floor(currentYear / 8) * 8;

        renderPickerYearGrid();
        $seasonPickerPanel.classList.add('active');
    }

    function renderPickerYearGrid() {
        const { availableSet, years, minYear, maxYear, decadeStart, selectedYear } = picker;
        const decadeEnd = decadeStart + 7;
        const gridYears = Array.from({ length: 8 }, (_, i) => decadeStart + i);
        const currentSelected = allSeasons[currentSeasonIdx];

        const yearCells = gridYears.map(y => {
            const hasData = years.includes(y);
            const isSel   = y === selectedYear;
            const cls     = ['spp-year', isSel ? 'sel' : '', !hasData ? 'empty' : ''].join(' ').trim();
            return `<div class="${cls}" data-year="${y}">${y}</div>`;
        }).join('');

        const seasonOrder = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
        const seasonChips = seasonOrder.map(s => {
            const exists = availableSet.has(`${selectedYear}|${s}`);
            const isSel  = selectedYear === currentSelected.season_year && s === currentSelected.season;
            const cls    = ['spp-season', isSel ? 'sel' : '', !exists ? 'disabled' : ''].join(' ').trim();
            return `<div class="${cls}" data-season="${s}">${SEASON_LABELS[s]}</div>`;
        }).join('');

        $seasonPickerPanel.innerHTML = `
            <div class="spp-header">
                <button class="spp-nav" id="sppPrev" ${decadeStart <= minYear ? 'disabled' : ''}>‹</button>
                <span class="spp-decade">${decadeStart} – ${decadeEnd}</span>
                <button class="spp-nav" id="sppNext" ${decadeEnd >= maxYear ? 'disabled' : ''}>›</button>
            </div>
            <div class="spp-year-grid" id="sppYearGrid">${yearCells}</div>
            <div class="spp-seasons" id="sppSeasons">${seasonChips}</div>
        `;
    }

    function selectSeason(idx) {
        currentSeasonIdx = idx;
        seasonGridRows = 2;
        updateSeasonNavState();
        renderVoiceActorHighlights();
        // Panel stays open so the user can keep browsing other seasons/years
    }

    function changeSeason(delta) {
        const newIdx = currentSeasonIdx + delta;
        if (newIdx < 0 || newIdx >= allSeasons.length) return;
        currentSeasonIdx = newIdx;
        seasonGridRows = 2;
        updateSeasonNavState();
        renderVoiceActorHighlights();
    }

    function updateSeasonNavState() {
        if (!allSeasons.length) return;
        const s = allSeasons[currentSeasonIdx];
        document.getElementById('season-title').textContent =
            `${SEASON_LABELS[s.season] || s.season} ${s.season_year}`;
        $seasonPrevBtn.disabled = currentSeasonIdx >= allSeasons.length - 1; // no older season left
        $seasonNextBtn.disabled = currentSeasonIdx <= 0;                    // already at the newest season
    }

    // Render the voice actor list — season-filtered, sortable, always full rows, with "Show more"
    function renderVoiceActorHighlights() {
        const $grid = document.getElementById('seasonGrid');
        const s = allSeasons.length ? allSeasons[currentSeasonIdx] : null;
        const limit = computeSeasonGridColumns() * seasonGridRows;

        if (currentSort === 'favorites' && !favoriteIds.size) {
            $grid.innerHTML = '<div class="loading">No favorites yet — click the star on any voice actor to add them here.</div>';
            $loadMoreBtn.style.display = 'none';
            return;
        }

        const conditions = [];
        const params = [];
        if (s) { conditions.push('a.season = ? AND a.season_year = ?'); params.push(s.season, s.season_year); }
        if (currentSort === 'favorites') {
            conditions.push(`va.id IN (${[...favoriteIds].map(() => '?').join(',')})`);
            params.push(...favoriteIds);
        }
        const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const orderClause = currentSort === 'name'
            ? 'va.full_name ASC'
            : 'role_count DESC, va.full_name ASC';

        const top = query(`
            SELECT va.id, va.full_name, va.native_name, va.image, COUNT(DISTINCT cava.character_id) AS role_count
            FROM voice_actors va
            JOIN character_anime_voice_actor cava ON cava.voice_actor_id = va.id
            JOIN anime a ON a.id = cava.anime_id
            ${whereClause}
            GROUP BY va.id
            ORDER BY ${orderClause}
            LIMIT ?
        `, [...params, limit]);

        if (!top.length) {
            $grid.innerHTML = currentSort === 'favorites'
                ? '<div class="loading">None of your favorites appear in this season.</div>'
                : '<div class="loading">No voice actor data for this season.</div>';
            $loadMoreBtn.style.display = 'none';
            return;
        }

        $grid.innerHTML = top.map(va => vaCardHtml(va, s)).join('');

        // "Show more" only when there are potentially more entries
        $loadMoreBtn.style.display = (top.length === limit) ? 'inline-flex' : 'none';
    }

    // Debounced search
    $input.addEventListener('input', e => {
        clearTimeout(debounceTimer);
        const q = e.target.value.trim();
        if (q.length < 2) { $results.classList.remove('active'); return; }
        $results.innerHTML = '<div class="loading">Searching...</div>';
        $results.classList.add('active');
        debounceTimer = setTimeout(() => doSearch(q), 200);
    });

    $input.addEventListener('focus', () => { if ($input.value.trim().length >= 2) $results.classList.add('active'); });
    document.addEventListener('click', e => { if (!e.target.closest('.search-box')) $results.classList.remove('active'); });

    function doSearch(q) {
        if (!db) return;
        const like = `%${q}%`;
        const items = [];

        // Search anime (romaji, english, native title)
        const animeResults = query(`
            SELECT id, romaji_title, english_title, native_title, cover_image, format, season_year
            FROM anime
            WHERE romaji_title LIKE ? OR english_title LIKE ? OR native_title LIKE ?
            LIMIT 5
        `, [like, like, like]);

        animeResults.forEach(a => {
            const meta = [a.format, a.season_year].filter(Boolean).join(' • ') || '—';
            items.push({ type: 'anime', id: a.id, name: a.english_title || a.romaji_title, native: a.native_title, img: a.cover_image, meta });
        });

        // Search characters (name + native), deduplicated across anime appearances.
        // LEFT JOIN so a character with no (or a broken) anime link still shows up.
        const chars = query(`
            SELECT c.id, c.full_name, c.native_name, c.image,
                   COUNT(DISTINCT ca.anime_id) AS anime_count, MIN(a.romaji_title) AS sample_anime
            FROM characters c
            LEFT JOIN character_anime ca ON ca.character_id = c.id
            LEFT JOIN anime a ON a.id = ca.anime_id
            WHERE c.full_name LIKE ? OR c.native_name LIKE ?
            GROUP BY c.id
            LIMIT 5
        `, [like, like]);

        chars.forEach(c => {
            const meta = c.anime_count > 1 ? `${c.anime_count} anime` : (c.sample_anime || '—');
            items.push({ type: 'character', id: c.id, name: c.full_name, native: c.native_name, img: c.image, meta });
        });

        // Search voice actors (name + native), incl. sample roles
        const staff = query(`
            SELECT id, full_name, native_name, image
            FROM voice_actors
            WHERE full_name LIKE ? OR native_name LIKE ?
            LIMIT 5
        `, [like, like]);

        staff.forEach(s => {
            const roles = query(`
                SELECT c.full_name AS character, a.romaji_title AS anime
                FROM character_anime_voice_actor cava
                JOIN characters c ON c.id = cava.character_id
                JOIN anime a ON a.id = cava.anime_id
                WHERE cava.voice_actor_id = ?
                LIMIT 2
            `, [s.id]);
            const meta = roles.map(r => `${r.character} (${r.anime})`).join(', ');
            items.push({ type: 'staff', id: s.id, name: s.full_name, native: s.native_name, img: s.image, meta });
        });

        renderDropdown(items);
    }

    function renderDropdown(items) {
        if (!items.length) { $results.innerHTML = '<div class="loading">No results.</div>'; return; }
        $results.innerHTML = items.map(i => {
            const badgeClass = i.type === 'staff' ? 'badge-staff' : (i.type === 'anime' ? 'badge-anime' : 'badge-char');
            const badgeLabel = i.type === 'staff' ? 'Voice Actor' : (i.type === 'anime' ? 'Anime' : 'Character');
            return `
            <div class="result-item" onclick="showDetail('${i.type}', ${i.id})">
                <img class="result-avatar" src="${i.img || ''}" alt="" onerror="this.style.display='none'">
                <div class="result-info">
                    <div class="result-name">${escapeHtml(i.name)}</div>
                    <div class="result-meta">${escapeHtml(i.native || '')} • ${escapeHtml(i.meta || '')}</div>
                </div>
                ${i.type === 'staff' ? favStarButtonResult(i.id) : ''}
                <span class="badge ${badgeClass}">${badgeLabel}</span>
            </div>`;
        }).join('');
    }

    // Detail View
    function showDetail(type, id) {
        $results.classList.remove('active');
        $input.value = '';
        $heroSection.style.display = 'none';
        $seasonSection.style.display = 'none';
        const $detail = $detailView;
        $detail.classList.add('active');
        $detail.dataset.view = '';

        if (type === 'anime') {
            showAnimeDetail(id);
            return;
        }

        if (type === 'staff') {
            showStaffDetail(id);
            return;
        }

        if (type === 'character') {
            showCharacterDetail(id);
            return;
        }
    }

    // Character detail view: profile + every anime appearance (role + voice actor), with "Show more"
    let characterDetailState = null;

    function showCharacterDetail(id, noHistory) {
        if (!noHistory) pushNav({ view: 'character', id });
        const rows = query(`SELECT id, full_name, native_name, image FROM characters WHERE id = ?`, [id]);
        if (!rows.length) { renderNotFound(); return; }
        const character = rows[0];
        $detailView.dataset.view = 'character';

        const appearanceRows = query(`
            SELECT ca.anime_id, a.romaji_title, a.english_title, a.cover_image, ca.role,
                   va.id AS va_id, va.full_name AS va_name
            FROM character_anime ca
            JOIN anime a ON a.id = ca.anime_id
            LEFT JOIN character_anime_voice_actor cava ON cava.character_id = ca.character_id AND cava.anime_id = ca.anime_id
            LEFT JOIN voice_actors va ON va.id = cava.voice_actor_id
            WHERE ca.character_id = ?
            ORDER BY CASE ca.role WHEN 'MAIN' THEN 0 WHEN 'SUPPORTING' THEN 1 ELSE 2 END, a.romaji_title
        `, [id]);

        // Group in case a character has more than one VA for the same anime (e.g. multiple dub languages)
        const appearancesByAnime = {};
        const order = [];
        appearanceRows.forEach(r => {
            if (!appearancesByAnime[r.anime_id]) {
                appearancesByAnime[r.anime_id] = {
                    animeId: r.anime_id,
                    title: r.english_title || r.romaji_title,
                    cover: r.cover_image,
                    role: r.role,
                    vas: [],
                };
                order.push(r.anime_id);
            }
            if (r.va_id) appearancesByAnime[r.anime_id].vas.push({ id: r.va_id, name: r.va_name });
        });

        characterDetailState = { character, appearances: order.map(aid => appearancesByAnime[aid]), rows: 2 };
        renderCharacterDetail();
    }

    function loadMoreCharacterAppearances() {
        if (!characterDetailState) return;
        characterDetailState.rows += 1;
        renderCharacterDetail(true);
    }

    function appearanceCardHtml(a) {
        const va = a.vas[0];
        return `
        <div class="role-card" onclick="showDetail('anime', ${a.animeId})">
            ${a.cover ? `<img src="${a.cover}" alt="" class="role-thumb" onerror="this.style.display='none'">` : ''}
            <div style="min-width:0;">
                <div class="role-char">${escapeHtml(a.title)}</div>
                <div class="role-anime">${va ? escapeHtml(va.name) : (a.role === 'MAIN' ? 'Main' : 'Supporting')}</div>
            </div>
        </div>`;
    }

    function renderCharacterDetail(noScroll) {
        const { character, appearances, rows } = characterDetailState;
        const $detail = $detailView;
        const avatar = character.image || '';
        const columns = computeRoleGridColumns();
        const limit = columns * rows;
        const shown = appearances.slice(0, limit);
        const hasMore = appearances.length > limit;

        $detail.innerHTML = `
            <div class="detail-header">
                ${avatar ? `<img class="detail-avatar" src="${avatar}" alt="" onerror="this.style.display='none'">` : ''}
                <div>
                    <h2 class="detail-title">${escapeHtml(character.full_name)}</h2>
                    <div style="color:var(--text-secondary);margin-bottom:12px">${escapeHtml(character.native_name || '')}</div>
                    <div class="detail-meta">
                        <span class="meta-item">Character</span>
                    </div>
                </div>
            </div>
            ${appearances.length ? `
                <div class="role-section-title">Appears In</div>
                <div class="role-grid">${shown.map(appearanceCardHtml).join('')}</div>
                ${hasMore ? `<div class="load-more-wrap"><button class="retry-btn" onclick="loadMoreCharacterAppearances()">Show all ${appearances.length} appearances</button></div>` : ''}
            ` : '<div class="loading" style="text-align:left;padding:0">No anime appearances in the database.</div>'}
        `;
        if (!noScroll) window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // Voice actor detail view: profile + roles grouped by main/supporting, with "Show more" per group
    let staffDetailState = null;

    function showStaffDetail(id, noHistory) {
        if (!noHistory) pushNav({ view: 'staff', id });
        const rows = query(`SELECT id, full_name, native_name, image FROM voice_actors WHERE id = ?`, [id]);
        if (!rows.length) { renderNotFound(); return; }
        const staff = rows[0];
        $detailView.dataset.view = 'staff';

        const allRoles = query(`
            SELECT cava.character_id AS char_id,
                   c.full_name AS character,
                   c.image AS char_image,
                   MIN(CASE ca.role WHEN 'MAIN' THEN 0 WHEN 'SUPPORTING' THEN 1 ELSE 2 END) AS role_rank,
                   CASE MIN(CASE ca.role WHEN 'MAIN' THEN 0 WHEN 'SUPPORTING' THEN 1 ELSE 2 END)
                       WHEN 0 THEN 'MAIN' WHEN 1 THEN 'SUPPORTING' ELSE 'BACKGROUND' END AS role,
                   COUNT(DISTINCT cava.anime_id) AS anime_count,
                   MIN(a.romaji_title) AS anime
            FROM character_anime_voice_actor cava
            JOIN characters c ON c.id = cava.character_id
            JOIN character_anime ca ON ca.character_id = cava.character_id AND ca.anime_id = cava.anime_id
            JOIN anime a ON a.id = cava.anime_id
            WHERE cava.voice_actor_id = ?
            GROUP BY cava.character_id
            ORDER BY role_rank, c.full_name
        `, [id]);

        // Last 4 seasons activity (roles per season, ordered newest → oldest)
        const activityRaw = query(`
            SELECT a.season, a.season_year, COUNT(DISTINCT cava.character_id) AS roles
            FROM character_anime_voice_actor cava
            JOIN anime a ON a.id = cava.anime_id
            WHERE cava.voice_actor_id = ?
              AND a.season IS NOT NULL AND a.season_year IS NOT NULL
            GROUP BY a.season, a.season_year
            ORDER BY a.season_year DESC,
                     CASE a.season WHEN 'FALL' THEN 4 WHEN 'SUMMER' THEN 3 WHEN 'SPRING' THEN 2 ELSE 1 END DESC
            LIMIT 4
        `, [id]);

        staffDetailState = {
            staff,
            mainRoles: allRoles.filter(r => r.role === 'MAIN'),
            supportingRoles: allRoles.filter(r => r.role !== 'MAIN'),
            activity: activityRaw.reverse(), // oldest → newest for left-to-right chart
            mainRows: 2,
            supportingRows: 2,
        };

        renderStaffDetail();
    }

    function loadMoreStaffRoles(section) {
        if (!staffDetailState) return;
        if (section === 'main') staffDetailState.mainRows += 1;
        else staffDetailState.supportingRows += 1;
        renderStaffDetail(true);
    }

    // How many role cards fit in one row of the detail view at the current width,
    // matching .role-grid's grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)) rule.
    function computeRoleGridColumns() {
        return computeGridColumns('detailView', 240, 10);
    }

    function roleCardHtml(r) {
        const animeLabel = r.anime_count > 1
            ? `${escapeHtml(r.anime || '')} <span style="color:var(--text-muted)">+${r.anime_count - 1}</span>`
            : escapeHtml(r.anime || '');
        return `
        <div class="role-card" onclick="showDetail('character', ${r.char_id})">
            ${r.char_image ? `<img src="${r.char_image}" alt="" class="role-thumb" onerror="this.style.display='none'">` : ''}
            <div style="min-width:0;">
                <div class="role-char">${escapeHtml(r.character || '')}</div>
                <div class="role-anime">${animeLabel}</div>
            </div>
        </div>`;
    }

    function roleSectionHtml(title, roles, limit, sectionKey) {
        if (!roles.length) return '';
        const shown = roles.slice(0, limit);
        const hasMore = roles.length > limit;
        const remaining = roles.length;
        return `
            <div class="role-section-title">${title}</div>
            <div class="role-grid">${shown.map(roleCardHtml).join('')}</div>
            ${hasMore ? `<div class="load-more-wrap"><button class="retry-btn" onclick="loadMoreStaffRoles('${sectionKey}')">Show all ${remaining} ${title.toLowerCase()}</button></div>` : ''}
        `;
    }

    function activityChartSvg(activity) {
        if (!activity || !activity.length) return '';
        const SEASON_SHORT = { WINTER: 'W', SPRING: 'Sp', SUMMER: 'Su', FALL: 'F' };
        const W = 140, H = 120, pad = 6, labelH = 16, tipH = 18;
        const barH   = H - labelH - pad;        // usable bar area height
        const barW   = Math.floor((W - pad * (activity.length + 1)) / activity.length);
        const maxRoles = Math.max(...activity.map(a => a.roles), 1);

        const bars = activity.map((a, i) => {
            const x      = pad + i * (barW + pad);
            const fillH  = Math.max(4, Math.round((a.roles / maxRoles) * barH));
            const barY   = barH - fillH;
            const label  = `${SEASON_SHORT[a.season] || '?'}${String(a.season_year).slice(2)}`;
            const roleLabel = `${a.roles} role${a.roles === 1 ? '' : 's'}`;

            // Tooltip: above bar normally, inside bar when bar reaches the top
            const tipW   = Math.max(roleLabel.length * 6 + 8, 42);
            const tipX   = Math.min(Math.max(x + barW / 2 - tipW / 2, 0), W - tipW);
            const spaceAbove = barY - tipH - 4;
            const tipY   = spaceAbove >= 0 ? spaceAbove : barY + 6; // inside bar if no room above
            const tipTextColor = spaceAbove >= 0 ? 'var(--text-primary)' : 'var(--bg)';
            const tipFill      = spaceAbove >= 0 ? 'var(--bg-tertiary)' : 'var(--accent)';
            const tipStroke    = spaceAbove >= 0 ? 'var(--border)' : 'transparent';

            return `
            <g class="bar-group">
                <rect class="bar-rect" x="${x}" y="${barY}" width="${barW}" height="${fillH}"
                      rx="3" fill="var(--accent)" opacity="0.65"/>
                <text x="${x + barW / 2}" y="${H - 3}" text-anchor="middle"
                      font-size="10" fill="var(--text-muted)">${label}</text>
                <g class="bar-tooltip">
                    <rect x="${tipX}" y="${tipY}" width="${tipW}" height="${tipH}"
                          rx="4" fill="${tipFill}" stroke="${tipStroke}" stroke-width="1"/>
                    <text x="${tipX + tipW / 2}" y="${tipY + tipH - 5}" text-anchor="middle"
                          font-size="10" font-weight="600" fill="${tipTextColor}">${roleLabel}</text>
                </g>
            </g>`;
        }).join('');

        return `<svg class="va-activity-chart" viewBox="0 0 ${W} ${H}"
                     xmlns="http://www.w3.org/2000/svg"
                     aria-label="Activity last ${activity.length} seasons">${bars}</svg>`;
    }

    function renderStaffDetail(noScroll) {
        const { staff, mainRoles, supportingRoles, activity, mainRows, supportingRows } = staffDetailState;
        const $detail = $detailView;
        const avatar = staff.image || '';
        const hasRoles = mainRoles.length || supportingRoles.length;
        const columns = computeRoleGridColumns();
        const mainLimit = columns * mainRows;
        const supportingLimit = columns * supportingRows;

        $detail.innerHTML = `
            <div class="detail-header">
                ${avatar ? `<img class="detail-avatar" src="${avatar}" alt="" onerror="this.style.display='none'">` : ''}
                <div style="flex:1;min-width:0">
                    <div class="va-detail-top">
                        <div>
                            <h2 class="detail-title">${escapeHtml(staff.full_name)}</h2>
                            <div style="color:var(--text-secondary);margin-bottom:10px">${escapeHtml(staff.native_name || '')}</div>
                            <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-start">
                                <span class="meta-item">Voice Actor</span>
                                ${favStarButtonInline(staff.id)}
                            </div>
                        </div>
                        ${activity && activity.length ? `
                        <div style="display:flex;flex-direction:column;align-items:center;gap:6px">
                            <span style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">Last ${activity.length} Seasons</span>
                            ${activityChartSvg(activity)}
                        </div>` : ''}
                    </div>
                </div>
            </div>
            ${hasRoles ? `
                ${roleSectionHtml('Main Roles', mainRoles, mainLimit, 'main')}
                ${roleSectionHtml('Supporting Roles', supportingRoles, supportingLimit, 'supporting')}
            ` : '<div class="loading" style="text-align:left;padding:0">No roles/media in the database.</div>'}
        `;
        if (!noScroll) window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    function showAnimeDetail(id, noHistory) {
        if (!noHistory) pushNav({ view: 'anime', id });
        const animeRows = query(`
            SELECT id, romaji_title, english_title, native_title, format, status, season, season_year,
                   episodes, duration, average_score, popularity, favourites, source, country_of_origin,
                   description, site_url, cover_image, banner_image
            FROM anime WHERE id = ?
        `, [id]);
        if (!animeRows.length) { renderNotFound(); return; }
        const anime = animeRows[0];

        // Characters + their voice actors (a character can have multiple VAs -> group them)
        const charRows = query(`
            SELECT c.id AS char_id, c.full_name AS char_name, c.native_name AS char_native, c.image AS char_image, ca.role,
                   va.id AS va_id, va.full_name AS va_name, va.image AS va_image
            FROM character_anime ca
            JOIN characters c ON c.id = ca.character_id
            LEFT JOIN character_anime_voice_actor cava ON cava.character_id = ca.character_id AND cava.anime_id = ca.anime_id
            LEFT JOIN voice_actors va ON va.id = cava.voice_actor_id
            WHERE ca.anime_id = ?
            ORDER BY CASE ca.role WHEN 'MAIN' THEN 0 WHEN 'SUPPORTING' THEN 1 ELSE 2 END, c.full_name
        `, [id]);

        const charactersById = {};
        const order = [];
        charRows.forEach(r => {
            if (!charactersById[r.char_id]) {
                charactersById[r.char_id] = { id: r.char_id, name: r.char_name, native: r.char_native, image: r.char_image, role: r.role, vas: [] };
                order.push(r.char_id);
            }
            if (r.va_id) charactersById[r.char_id].vas.push({ id: r.va_id, name: r.va_name, image: r.va_image });
        });
        const characters = order.map(cid => charactersById[cid]);
        const mainChars = characters.filter(c => c.role === 'MAIN');
        const supportingChars = characters.filter(c => c.role !== 'MAIN');

        renderAnimeDetail(anime, mainChars, supportingChars);
    }

    function charvaCard(char) {
        const va = char.vas[0]; // main voice actor (first entry); more may exist for a multi-language cast
        return `
        <div class="charva-card">
            <div class="charva-side">
                <img class="charva-avatar" src="${char.image || ''}" onclick="showDetail('character', ${char.id})" onerror="this.style.display='none'">
                <span class="charva-name" onclick="showDetail('character', ${char.id})">${escapeHtml(char.name)}</span>
            </div>
            <span class="charva-arrow">→</span>
            <div class="charva-side right">
                ${va ? `<img class="charva-avatar" src="${va.image || ''}" onclick="showDetail('staff', ${va.id})" onerror="this.style.display='none'">` : ''}
                <span class="charva-name" ${va ? `onclick="showDetail('staff', ${va.id})"` : ''} style="${va ? '' : 'color:var(--text-muted);cursor:default;'}">${va ? escapeHtml(va.name) : 'unknown'}</span>
            </div>
        </div>`;
    }

    function renderAnimeDetail(anime, mainChars, supportingChars) {
        const $detail = $detailView;
        const title = anime.english_title || anime.romaji_title;
        const infoBits = [anime.format, anime.status, anime.season && anime.season_year ? `${anime.season} ${anime.season_year}` : anime.season_year,
                           anime.episodes ? `${anime.episodes} episodes` : null, anime.average_score ? `${anime.average_score}% score` : null, anime.source]
                          .filter(Boolean);

        $detail.innerHTML = `
            <div class="detail-header">
                ${anime.cover_image ? `<img class="anime-cover" src="${anime.cover_image}" alt="" onerror="this.style.display='none'">` : ''}
                <div style="min-width:0;flex:1">
                    <h2 class="detail-title">${escapeHtml(title)}</h2>
                    <div style="color:var(--text-secondary);margin-bottom:4px">${escapeHtml(anime.romaji_title || '')}</div>
                    <div style="color:var(--text-secondary);margin-bottom:4px">${escapeHtml(anime.native_title || '')}</div>
                    <div class="anime-info-row">${infoBits.map(b => `<span>${escapeHtml(String(b))}</span>`).join('<span>·</span>')}</div>
                    ${anime.description ? `<div class="anime-description">${anime.description}</div>` : ''}
                    ${anime.site_url ? `<a href="${anime.site_url}" target="_blank" rel="noopener" style="font-size:13px;color:var(--accent);text-decoration:none;display:inline-block;margin-top:8px">View on AniList →</a>` : ''}
                </div>
            </div>

            ${mainChars.length ? `
            <div class="role-section-title">Main Characters</div>
            <div class="charva-grid">${mainChars.map(charvaCard).join('')}</div>` : ''}

            ${supportingChars.length ? `
            <div class="role-section-title">Supporting Characters</div>
            <div class="charva-grid">${supportingChars.map(charvaCard).join('')}</div>` : ''}

            ${(!mainChars.length && !supportingChars.length) ? '<div class="loading" style="text-align:left;padding:0">No characters in the database.</div>' : ''}
        `;
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function renderNotFound() {
        $detailView.innerHTML = '<div class="error-msg">Entry not found.<button class="retry-btn" onclick="showHome()">Back</button></div>';
    }

    function renderDetail(item, typeLabel, sectionTitle, roles, vaName, vaClick, favId) {
        const $detail = $detailView;
        const avatar = item.image || '';
        $detail.innerHTML = `
            <div class="detail-header">
                ${avatar ? `<img class="detail-avatar" src="${avatar}" alt="" onerror="this.style.display='none'">` : ''}
                <div>
                    <h2 class="detail-title">${escapeHtml(item.name)}</h2>
                    <div style="color:var(--text-secondary);margin-bottom:12px">${escapeHtml(item.native || '')}</div>
                    <div class="detail-meta">
                        <span class="meta-item">${typeLabel}</span>
                        ${vaName ? `<span class="meta-item" ${vaClick ? `style="cursor:pointer" onclick="${vaClick}"` : ''}>Voiced by ${escapeHtml(vaName)}</span>` : ''}
                        ${favId ? favStarButtonInline(favId) : ''}
                    </div>
                </div>
            </div>
            <h3 style="font-size:16px;font-weight:600;margin-bottom:12px">${sectionTitle}</h3>
            ${roles.length ? `
            <div class="role-grid">
                ${roles.slice(0, 12).map(r => `
                <div class="role-card" ${r.onclick ? `onclick="${r.onclick}"` : ''}>
                    ${r.img ? `<img src="${r.img}" alt="" class="role-thumb" onerror="this.style.display='none'">` : ''}
                    <div style="min-width:0;">
                        <div class="role-char">${escapeHtml(r.character || '')}</div>
                        <div class="role-anime">${escapeHtml(r.anime || '')}</div>
                    </div>
                </div>`).join('')}
            </div>` : '<div class="loading" style="text-align:left;padding:0">No roles/media in the database.</div>'}
        `;
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function showHome(noHistory) {
        if (!noHistory) pushNav({ view: 'home' });
        $heroSection.style.display = '';
        $seasonSection.style.display = '';
        $detailView.classList.remove('active');
        $detailView.innerHTML = '';
        $detailView.dataset.view = '';
        $input.value = '';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function escapeHtml(str) {
        if (str == null) return '';
        return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // Hide the nav bar when scrolling down, reveal it again when scrolling up
    (function initNavAutoHide() {
        const $nav = document.querySelector('nav');
        let lastY = window.scrollY;
        const threshold = 10; // ignore tiny scroll jitter

        window.addEventListener('scroll', () => {
            const currentY = window.scrollY;
            const delta = currentY - lastY;

            if (Math.abs(delta) < threshold) return;

            if (delta > 0 && currentY > 80) {
                $nav.classList.add('nav-hidden');   // scrolling down
            } else {
                $nav.classList.remove('nav-hidden'); // scrolling up
            }
            lastY = currentY;
        }, { passive: true });
    })();

    // ── Browser History (Back/Forward button support) ────────────────────────
    // pushNav() saves a state snapshot; restoreNav() replays it on popstate.
    function pushNav(state) {
        history.pushState(state, '');
    }

    function restoreNav(state) {
        if (!state || !db) return;
        switch (state.view) {
            case 'home':           showHome(true); break;
            case 'anime-list':     showAnimeListView(true); break;
            case 'char-list':      showCharacterListView(true); break;
            case 'va-list':        showVoiceActorListView(true); break;
            case 'favorites':      showFavoritesView(true); break;
            case 'anime':          showAnimeDetail(state.id, true); break;
            case 'character':      showCharacterDetail(state.id, true); break;
            case 'staff':          showStaffDetail(state.id, true); break;
        }
    }

    window.addEventListener('popstate', e => restoreNav(e.state));

    // Start
    // Push an initial home state so the first Back press returns home from a detail view
    history.replaceState({ view: 'home' }, '');
    init();