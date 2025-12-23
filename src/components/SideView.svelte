<script>
// @ts-nocheck

  import App from '../App.svelte';
import { getStoredData, storeData, exportFoundStops, clearAllData } from '../lib/storage.js';
  
  export let foundStopIds = [];
  export let allStops = [];
  export let activeNetworks = [];
  export let lines = [];
  export let hiddenLines = [];
  export let onStopClick = null;
  export let onClearProgress = null;
  export let onToggleLine = null;

  let sortMode = 'chrono'; // 'chrono' | 'alpha' | 'by-line'
  let showAbout = false;

  // Load/save sort mode
  $: {
    const stored = getStoredData('sideViewSortMode');
    if (stored) sortMode = stored;
  }

  function setSortMode(mode) {
    sortMode = mode;
    storeData('sideViewSortMode', mode);
  }

  const displayRefMap = { '6A': '6', '6B': '6' };

  // Official line order for sorting
  const lineOrder = ['T1', 'T2', 'T3', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '10 EXPRESS', '11', '11 EXPRESS', '12', '20', '21', '22', '23', '30', '31', '32', '34', '40', '42', 'NAVETTE CAEN', 'NOCTIBUS'];
  function getLineOrder(ref) {
    const idx = lineOrder.indexOf(ref);
    return idx >= 0 ? idx : 999;
  }

  // Build flat list of found stops with their lines
  $: flatStops = (() => {
    const foundSet = new Set(foundStopIds);
    const activeStops = allStops.filter(s => activeNetworks.includes(s.network) && foundSet.has(s.id));

    // Build line color/icon map
    const lineMap = new Map();
    for (const line of lines) {
      const displayRef = displayRefMap[line.ref] || line.ref;
      if (!lineMap.has(displayRef)) {
        lineMap.set(displayRef, { ref: displayRef, color: line.color_hex, icon: `/icons/${displayRef}.png`, network: line.network });
      }
    }

    // Group stops by normalized name only (not by location to avoid duplicates like "Saint-Pierre")
    const stopsMap = new Map();
    for (const stop of activeStops) {
      const key = stop.name.toLowerCase().trim();
      if (!stopsMap.has(key)) {
        const firstIdx = foundStopIds.indexOf(stop.id);
        stopsMap.set(key, {
          id: stop.id,
          name: stop.name,
          lat: stop.lat,
          lon: stop.lon,
          lineRefs: new Set(),
          firstFoundIndex: firstIdx >= 0 ? firstIdx : 99999
        });
      }
      const entry = stopsMap.get(key);
      const displayRef = displayRefMap[stop.line_ref] || stop.line_ref;
      entry.lineRefs.add(displayRef);
      // update firstFoundIndex to earliest
      const idx = foundStopIds.indexOf(stop.id);
      if (idx >= 0 && idx < entry.firstFoundIndex) entry.firstFoundIndex = idx;
    }

    const arr = Array.from(stopsMap.values()).map(s => ({
      ...s,
      lineRefs: Array.from(s.lineRefs).sort((a, b) => getLineOrder(a) - getLineOrder(b)),
      lines: Array.from(s.lineRefs).map(r => lineMap.get(r)).filter(Boolean)
    }));

    // Sort
    if (sortMode === 'chrono') {
      arr.sort((a, b) => b.firstFoundIndex - a.firstFoundIndex); // recent first
    } else if (sortMode === 'alpha') {
      arr.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortMode === 'by-line') {
      // duplicate per line, flatten and sort by line order then name
      const expanded = [];
      for (const s of arr) {
        for (const lr of s.lineRefs) {
          const line = lineMap.get(lr);
          expanded.push({ ...s, singleLine: line, sortKey: `${getLineOrder(lr).toString().padStart(3, '0')}|${s.name}` });
        }
      }
      expanded.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
      return expanded;
    }

    return arr;
  })();

  // Trigger re-render when activeNetworks changes to update line icons
  $: activeNetworks, flatStops;

  // Calculate total progress (dedupe by name only)
  $: totalProgress = (() => {
    const foundSet = new Set(foundStopIds);
    const activeStops = allStops.filter(s => activeNetworks.includes(s.network));
    // dedupe by normalized name only
    const unique = new Map();
    for (const s of activeStops) {
      const key = s.name.toLowerCase().trim();
      if (!unique.has(key)) unique.set(key, { found: foundSet.has(s.id) });
      else if (foundSet.has(s.id)) unique.get(key).found = true;
    }
    const total = unique.size;
    const found = Array.from(unique.values()).filter(u => u.found).length;
    return { found, total, percent: total > 0 ? Math.round((found / total) * 100) : 0 };
  })();

  function handleExport() {
    const json = exportFoundStops(foundStopIds);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'foundStops.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      try {
        const data = JSON.parse(text);
        if (Array.isArray(data)) {
          storeData('foundStopIds', data);
          location.reload();
        } else {
          alert('Format de fichier invalide.');
        }
      } catch (err) {
        alert('Erreur lors de la lecture du fichier.');
      }
    };
    input.click();
  }

  function handleClear() {
    if (confirm('Êtes-vous sûr de vouloir réinitialiser votre progression ?')) {
      if (onClearProgress) onClearProgress();
    }
  }

  function toggleAbout() {
    showAbout = !showAbout;
  }
</script>

<div class="side-view">
  <div class="header">
    <h1>On Part Caen ?</h1>
    <div class="total-progress">
      <div class="progress-circle">
        <svg viewBox="0 0 36 36">
          <path
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            fill="none"
            stroke="#eee"
            stroke-width="3"
          />
          <path
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            fill="none"
            stroke="#4CAF50"
            stroke-width="3"
            stroke-dasharray="{totalProgress.percent}, 100"
          />
          <text x="18" y="21" text-anchor="middle" font-size="10" font-weight="bold">{totalProgress.percent}%</text>
        </svg>
      </div>
      <div class="progress-text">
        Phase {totalProgress.total <= 37 ? '1' : '2'}: <strong>{totalProgress.found}</strong> / {totalProgress.total}
      </div>
    </div>
    <div class="actions">
      <button on:click={handleExport} title="Exporter la progression">💾</button>
      <button on:click={handleImport} title="Importer une sauvegarde">📂</button>
      <button on:click={handleClear} title="Réinitialiser">🔄</button>
      <button on:click={toggleAbout} title="À propos">ℹ️</button>
    </div>
  </div>

  {#if showAbout}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="about-modal" on:click={toggleAbout}>
      <div class="about-content" on:click|stopPropagation>
        <h2>À propos</h2>
        <p><strong>On Part Caen ?</strong></p>
        <p>Un jeu développé par <a href="https://cankyre.eu">Cankyre</a>.</p>
        <p>Cette application n'est en aucun cas affiliée à <em>Twisto</em> ou <em>RATP Dev</em>.</p>
        <p><strong>Données :</strong> OpenStreetMap via Overpass API</p>
        <button on:click={toggleAbout}>Fermer</button>
      </div>
    </div>
  {/if}

  <div class="line-filters">
    <h3>Lignes visibles</h3>
    <div class="line-filter-grid">
      {#each lines.filter(line => activeNetworks.includes(line.network)).reduce((acc, line) => {
        const displayRef = displayRefMap[line.ref] || line.ref;
        if (!acc.find(l => l.ref === displayRef)) {
          acc.push({ ref: displayRef, color: line.color_hex, icon: `/icons/${displayRef}.png` });
        }
        return acc;
      }, []).sort((a, b) => getLineOrder(a.ref) - getLineOrder(b.ref)) as line}
        <button 
          class="line-filter-btn" 
          class:hidden={hiddenLines.includes(line.ref)}
          on:click={() => onToggleLine && onToggleLine(line.ref)}
          title="{hiddenLines.includes(line.ref) ? 'Afficher' : 'Masquer'} la ligne {line.ref}"
        >
          <img src={line.icon} alt="Ligne {line.ref}" on:error={(e) => e.target.style.display = 'none'} />
          {#if hiddenLines.includes(line.ref)}
            <span class="eye-slash">👁️‍🗨️</span>
          {/if}
        </button>
      {/each}
    </div>
  </div>

  <div class="sort-controls">
    <!-- svelte-ignore a11y_label_has_associated_control -->
    <label>Tri:</label>
    <button class:active={sortMode === 'chrono'} on:click={() => setSortMode('chrono')}>Chronologique</button>
    <button class:active={sortMode === 'alpha'} on:click={() => setSortMode('alpha')}>Alphabétique</button>
    <button class:active={sortMode === 'by-line'} on:click={() => setSortMode('by-line')}>Par ligne</button>
  </div>

  <div class="stops-container">
    <ul class="flat-stops-list">
      {#each flatStops as stop}
        <li>
          <button 
            class="stop-item" 
            on:click={() => onStopClick && onStopClick(stop.id)}
            type="button"
          >
            <span class="stop-name">{stop.name}</span>
            <div class="line-icons">
              {#if sortMode === 'by-line' && stop.singleLine}
                <img src={stop.singleLine.icon} alt="Ligne {stop.singleLine.ref}" class="line-icon-small" on:error={(e) => e.target.style.display = 'none'} />
              {:else}
                {#each stop.lines.sort((a,b) => lineOrder.indexOf(a.ref) > lineOrder.indexOf(b.ref)) as line, i}
                  <img src={line.icon} alt="Ligne {line.ref}" class="line-icon-small" style="z-index: {stop.lines.length - i}; margin-left: {i > 0 ? '-8px' : '0'};" on:error={(e) => e.target.style.display = 'none'} />
                {/each}
              {/if}
            </div>
          </button>
        </li>
      {/each}
    </ul>
  </div>
</div>

<style>
  .side-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #f5f5f5;
    overflow-y: auto;
  }

  .header {
    padding: 1.5rem;
    background: white;
    border-bottom: 2px solid #e0e0e0;
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .header h1 {
    margin: 0 0 1rem 0;
    font-size: 1.5rem;
    color: #333;
  }

  .total-progress {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .progress-circle {
    width: 60px;
    height: 60px;
  }

  .progress-text {
    font-size: 1.2rem;
    color: #333;
  }

  .actions {
    display: flex;
    justify-content: center;
    gap: 0.5rem;
  }

  .actions button {
    padding: 0.5rem 1rem;
    border: 1px solid #ddd;
    background: white;
    cursor: pointer;
    border-radius: 4px;
    font-size: 1.2rem;
  }

  .actions button:hover {
    background: #f0f0f0;
  }

  .sort-controls {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 1rem;
    background: white;
    border-bottom: 1px solid #e0e0e0;
  }

  .sort-controls label {
    font-size: 0.9rem;
    font-weight: 600;
  }

  .sort-controls button {
    padding: 0.4rem 0.8rem;
    border: 1px solid #ddd;
    background: white;
    color: black;
    cursor: pointer;
    border-radius: 4px;
    font-size: 0.85rem;
    transition: all 0.2s;
  }

  .sort-controls button:hover {
    background: #f0f0f0;
  }

  .sort-controls button.active {
    background: #4CAF50;
    color: white;
    border-color: #4CAF50;
  }

  .stops-container {
    flex: 1;
    overflow-y: auto;
  }

  .flat-stops-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .flat-stops-list li {
    margin: 0;
    padding: 0;
    border-bottom: 1px solid #e0e0e0;
  }

  .stop-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    cursor: pointer;
    transition: background 0.2s;
    width: 100%;
    border: none;
    background: white;
    text-align: left;
    font-family: inherit;
  }

  .stop-item:hover {
    background: #f9f9f9;
  }

  .line-icons {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .line-icon-small {
    width: 24px;
    height: 24px;
    object-fit: contain;
  }

  .stop-name {
    color: #333;
    flex: 1;
    font-size: 0.95rem;
    font-weight: 500;
  }

  .about-modal {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .about-content {
    background: white;
    padding: 2rem;
    border-radius: 8px;
    max-width: 400px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  .about-content h2 {
    margin: 0 0 1rem 0;
    font-size: 1.5rem;
    color: #333;
  }

  .about-content p {
    margin: 0.5rem 0;
    font-size: 0.95rem;
    color: #666;
  }

  .about-content button {
    margin-top: 1rem;
    padding: 0.5rem 1rem;
    border: 1px solid #ddd;
    background: #4CAF50;
    color: white;
    cursor: pointer;
    border-radius: 4px;
    font-size: 1rem;
    font-weight: 600;
  }

  .about-content button:hover {
    background: #45a049;
  }

  .line-filters {
    padding: 1rem;
    background: white;
    border-bottom: 1px solid #e0e0e0;
  }

  .line-filters h3 {
    margin: 0 0 0.75rem 0;
    font-size: 0.9rem;
    font-weight: 600;
    color: #333;
  }

  .line-filter-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
    gap: 0.5rem;
  }

  .line-filter-btn {
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    padding: 0.25rem;
    border: 2px solid #ddd;
    background: white;
    cursor: pointer;
    border-radius: 6px;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .line-filter-btn img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .line-filter-btn:hover {
    transform: scale(1.05);
    border-color: #007bff;
  }

  .line-filter-btn.hidden {
    opacity: 0.3;
    filter: grayscale(1);
  }

  .line-filter-btn .eye-slash {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 1.2rem;
  }
</style>
