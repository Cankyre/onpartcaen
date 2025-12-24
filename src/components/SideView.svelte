<script>
  import { getStoredData, storeData, exportFoundStops } from '../lib/storage.js';
  import { getStopsForLine } from '../lib/db.js';

  export let foundStopIds = [];
  export let allStops = []; // Enriched with .networks and .lines Sets
  export let lines = [];
  export let activeNetworks = [];
  export let hiddenLines = [];
  export let focusedLines = [];
  export let inFocusMode = false;
  export let onStopClick = null;
  export let onClearProgress = null;
  export let onToggleLine = null;

  let sortMode = 'chrono'; // 'chrono' | 'alpha' | 'by-line'
  let showAbout = false;

  $: {
    const stored = getStoredData('sideViewSortMode');
    if (stored) sortMode = stored;
  }

  function setSortMode(mode) {
    sortMode = mode;
    storeData('sideViewSortMode', mode);
  }

  // New categorical sorting function for lines
  function getLineOrder(ref) {
    if (typeof ref !== 'string') return 9999;
    const isTram = ref.startsWith('T');
    const isNomad = ref.startsWith('Nomad');
    const num = parseInt(ref.replace('Nomad ', ''), 10);

    if (isTram) return 1000 + num;
    if (isNomad) return 5000 + num;
    if (!isNaN(num)) {
      if (num < 100) return 2000 + num;
      return 4000 + num;
    }
    return 3000; // Fallback for 'NOCTIBUS', etc.
  }

  // Determine line category for phases
  function getLineCategory(ref) {
    if (typeof ref !== 'string') return 'other';
    if (ref.startsWith('T')) return 'tram';
    const num = parseInt(ref, 10);
    if (!isNaN(num) && num < 100) return 'regular';
    return 'other'; // Complementary lines (100+, NOCTIBUS, etc.)
  }

  // Determine which lines are actually visible
  $: visibleLineRefs = (() => {
    const activeAndLoadedLines = lines.filter(line => activeNetworks.includes(line.network)).map(line => line.ref);
    
    if (inFocusMode) {
      return focusedLines.filter(ref => activeAndLoadedLines.includes(ref));
    } else {
      return activeAndLoadedLines.filter(ref => !hiddenLines.includes(ref));
    }
  })();

  // Map of all stops for quick lookup
  $: allStopsMap = new Map(allStops.map(s => [s.id, s]));

  // Build flat list of found stops with their lines
  $: flatStops = (() => {
    const foundSet = new Set(foundStopIds);
    const stopDetails = new Map(); // Map: stop.id -> {id, name, lat, lon, lineRefs: Set<string>, firstFoundIndex}
    
    // For each visible line, get its stops
    for (const lineRef of visibleLineRefs) {
      const lineData = lines.find(l => l.ref === lineRef);
      if (!lineData) continue;

      // Use db.getStopsForLine to get ordered stops for this line
      const stopsOnThisLine = getStopsForLine(lineRef); // This returns {id, name, lat, lon}
      
      stopsOnThisLine.forEach(stop => {
        if (!stopDetails.has(stop.id)) {
          stopDetails.set(stop.id, {
            id: stop.id,
            name: stop.name,
            lat: stop.lat,
            lon: stop.lon,
            lineRefs: new Set(),
            firstFoundIndex: foundSet.has(stop.id) ? foundStopIds.indexOf(stop.id) : Infinity // Initialize with actual index or infinity
          });
        }
        stopDetails.get(stop.id).lineRefs.add(lineRef);
      });
    }

    const arr = Array.from(stopDetails.values())
      .filter(stop => foundSet.has(stop.id) || sortMode === 'by-line') // Only show found stops in chrono/alpha, show all in by-line
      .map(s => ({
      ...s,
      lineRefs: Array.from(s.lineRefs).sort((a, b) => getLineOrder(a) - getLineOrder(b)),
      lines: Array.from(s.lineRefs).map(ref => lines.find(l => l.ref === ref)).filter(Boolean), // Get full line objects
      found: foundSet.has(s.id)
    }));

    // Sort
    if (sortMode === 'chrono') {
      arr.sort((a, b) => {
        // Sort by firstFoundIndex (most recent found first), then by name
        if (a.firstFoundIndex !== b.firstFoundIndex) {
            return b.firstFoundIndex - a.firstFoundIndex;
        }
        return a.name.localeCompare(b.name);
      });
    } else if (sortMode === 'alpha') {
      arr.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortMode === 'by-line') {
      // Group stops by line and maintain route order from database
      const lineSortedStops = [];
      const addedStops = new Set(); // Track stop_id + line_ref to avoid duplicates
      
      for (const lineRef of visibleLineRefs.sort((a, b) => getLineOrder(a) - getLineOrder(b))) {
        const stopsOnCurrentLine = getStopsForLine(lineRef); // Already in route order from database
        
        stopsOnCurrentLine.forEach((stop, stopIndex) => {
          const stopKey = `${stop.id}_${lineRef}`;
          if (!addedStops.has(stopKey)) {
            addedStops.add(stopKey);
            lineSortedStops.push({
              id: stop.id,
              name: stop.name,
              lat: stop.lat,
              lon: stop.lon,
              lineRefs: [lineRef],
              lines: [lines.find(l => l.ref === lineRef)],
              found: foundSet.has(stop.id),
              singleLine: lines.find(l => l.ref === lineRef),
              sortKey: `${getLineOrder(lineRef).toString().padStart(5, '0')}-${stopIndex.toString().padStart(5, '0')}`
            });
          }
        });
      }
      return lineSortedStops;
    }

    return arr;
  })();

  // Trigger re-render when activeNetworks changes to update line icons
  $: activeNetworks, flatStops;

  // Calculate progress by phase (Tram, Regular Bus, Complementary)
  $: phaseProgress = (() => {
    const foundSet = new Set(foundStopIds);
    const phases = {
      tram: { found: new Set(), total: new Set() },
      regular: { found: new Set(), total: new Set() },
      complementary: { found: new Set(), total: new Set() }
    };
    
    for (const line of lines.filter(l => activeNetworks.includes(l.network))) {
      const category = getLineCategory(line.ref);
      const targetPhase = category === 'tram' ? 'tram' 
                        : category === 'regular' ? 'regular' 
                        : 'complementary'; // other (complementary)
      
      getStopsForLine(line.ref).forEach(s => {
        phases[targetPhase].total.add(s.id);
        if (foundSet.has(s.id)) {
          phases[targetPhase].found.add(s.id);
        }
      });
    }

    return {
      tram: { 
        found: phases.tram.found.size, 
        total: phases.tram.total.size,
        percent: phases.tram.total.size > 0 ? Math.round((phases.tram.found.size / phases.tram.total.size) * 100) : 0
      },
      regular: { 
        found: phases.regular.found.size, 
        total: phases.regular.total.size,
        percent: phases.regular.total.size > 0 ? Math.round((phases.regular.found.size / phases.regular.total.size) * 100) : 0
      },
      complementary: { 
        found: phases.complementary.found.size, 
        total: phases.complementary.total.size,
        percent: phases.complementary.total.size > 0 ? Math.round((phases.complementary.found.size / phases.complementary.total.size) * 100) : 0
      }
    };
  })();

  // Calculate total progress and current phase
  $: totalProgress = (() => {
    const totalFound = phaseProgress.tram.found + phaseProgress.regular.found + phaseProgress.complementary.found;
    const totalStops = phaseProgress.tram.total + phaseProgress.regular.total + phaseProgress.complementary.total;
    
    // Determine current phase: complete previous phases to unlock next
    let currentPhase = 1;
    let currentFound = phaseProgress.tram.found;
    let currentTotal = phaseProgress.tram.total;
    let currentPercent = phaseProgress.tram.percent;
    
    if (phaseProgress.tram.found >= phaseProgress.tram.total && phaseProgress.tram.total > 0) {
      currentPhase = 2;
      currentFound = phaseProgress.regular.found;
      currentTotal = phaseProgress.regular.total;
      currentPercent = phaseProgress.regular.percent;
      
      if (phaseProgress.regular.found >= phaseProgress.regular.total && phaseProgress.regular.total > 0) {
        currentPhase = 3;
        currentFound = phaseProgress.complementary.found;
        currentTotal = phaseProgress.complementary.total;
        currentPercent = phaseProgress.complementary.percent;
      }
    }
    
    return { 
      found: totalFound, 
      total: totalStops, 
      percent: totalStops > 0 ? Math.round((totalFound / totalStops) * 100) : 0,
      currentPhase,
      currentFound,
      currentTotal,
      currentPercent
    };
  })();


  // Calculate completed lines (all stops found)
  $: completedLines = (() => {
    const foundSet = new Set(foundStopIds);
    const completed = [];
    
    for (const line of lines.filter(l => activeNetworks.includes(l.network))) {
      const stopsOnLine = getStopsForLine(line.ref);
      if (stopsOnLine.length === 0) continue; // Line with no stops isn't completable

      let allStopsFoundOnLine = true;
      for (const stop of stopsOnLine) {
        if (!foundSet.has(stop.id)) {
          allStopsFoundOnLine = false;
          break;
        }
      }
      if (allStopsFoundOnLine) {
        completed.push(line.ref);
      }
    }
    return completed;
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

  function handleLineClick(lineRef, event) {
    event.preventDefault();
    if (onToggleLine) onToggleLine(lineRef, event.shiftKey);
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
            stroke="{totalProgress.currentPhase === 1 ? '#23A638' : totalProgress.currentPhase === 2 ? '#EF3C3C' : '#0096DD'}"
            stroke-width="3"
            stroke-dasharray="{totalProgress.currentPercent}, 100"
          />
          <text x="18" y="21" text-anchor="middle" font-size="10" font-weight="bold">{totalProgress.currentPercent}%</text>
        </svg>
      </div>
      <div class="progress-text">
        Phase {totalProgress.currentPhase}/3 
        {#if totalProgress.currentPhase === 1}(Tram){:else if totalProgress.currentPhase === 2}(Bus){:else}(Complémentaire){/if}: 
        <strong>{totalProgress.currentFound}</strong> / {totalProgress.currentTotal}
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
        <p>Un jeu développé par <a href="mailto:cankyre@caen.lol">Cankyre</a>.</p>
        <p>Cette application n'est en aucun cas affiliée à <em>Twisto</em> ou <em>RATP Dev</em>.</p>
        <p><strong>Données :</strong> GTFS (General Transit Feed Specification) officiel de Twisto.</p>
        <p>Fortement inspiré par <a href="https://memory.pour.paris">Memory Pour Paris</a>. Merci.</p>
        <p style="font-size: 2pt">Dédicace à Fabetsol, l'arrêt Guynemer (y'a rien), et à la ligne 33, paix à son âme.</p>
        <button on:click={toggleAbout}>Fermer</button>
      </div>
    </div>
  {/if}

  <div class="line-filters">
    <h3>Lignes visibles</h3>
    <div class="line-filter-grid">
      {#each lines.filter(line => activeNetworks.includes(line.network)).sort((a, b) => getLineOrder(a.ref) - getLineOrder(b.ref)) as line}
        <button 
          class="line-filter-btn" 
          class:hidden={hiddenLines.includes(line.ref)}
          class:isolated={inFocusMode && focusedLines.includes(line.ref)}
          on:click={(e) => handleLineClick(line.ref, e)}
          title="{inFocusMode && focusedLines.includes(line.ref) ? 'Shift+Clic pour tout afficher' : 'Clic: masquer/afficher | Shift+Clic: isoler'}"
        >
          <img src="/icons/{line.ref}.png" alt="Ligne {line.ref}" on:error={(e) => e.target.style.display = 'none'} />
          {#if hiddenLines.includes(line.ref)}
            <span class="eye-slash">👁️</span>
          {/if}
          {#if completedLines.includes(line.ref)}
            <span class="crown">👑</span>
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
        <li class:not-found={sortMode === 'by-line' && !stop.found}>
          <button 
            class="stop-item" 
            class:not-found={sortMode === 'by-line' && !stop.found}
            on:click={() => onStopClick && onStopClick(stop.id)}
            type="button"
            disabled={sortMode === 'by-line' && !stop.found}
          >
          {#if !stop.found && sortMode === 'by-line'}
            <span class="stop-name not-found-label">Arrêt à trouver</span>
          {:else}
            <span class="stop-name">{stop.name}</span>
          {/if}
            <div class="line-icons">
              {#if sortMode === 'by-line' && stop.singleLine}
                <img src="/icons/{stop.singleLine.ref}.png" alt="Ligne {stop.singleLine.ref}" class="line-icon-small" on:error={(e) => e.target.style.display = 'none'} />
              {:else}
                {#each stop.lines.sort((a,b) => getLineOrder(a.ref) - getLineOrder(b.ref)) as line, i}
                  <img src="/icons/{line.ref}.png" alt="Ligne {line.ref}" class="line-icon-small" style="z-index: {stop.lines.length - i}; margin-left: {i > 0 ? '-8px' : '0'};" on:error={(e) => e.target.style.display = 'none'} />
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
    padding: 0.5rem;
    background: white;
    border-bottom: 1px solid #e0e0e0;
  }

  .line-filters h3 {
    margin: 0 0 0.4rem 0;
    font-size: 0.8rem;
    font-weight: 600;
    color: #333;
  }

  .line-filter-grid {
    display: grid;
    width: 100%;
    grid-template-columns: repeat(auto-fill, minmax(32px, 1fr));
    gap: 0.3rem;
  }

  .line-filter-btn {
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    padding: 0.15rem;
    border: 1px solid #ddd;
    background: white;
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    -webkit-user-select: none;
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

  .line-filter-btn.isolated {
    border: 2px solid #007bff;
    box-shadow: 0 0 8px rgba(0, 123, 255, 0.5);
  }

  .line-filter-btn .eye-slash {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 1rem;
  }

  .line-filter-btn .crown {
    position: absolute;
    top: -10px;
    right: -4px;
    font-size: 1rem;
    transform: rotate(25deg);
    filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));
  }

  .stop-item.not-found {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .stop-item.not-found:hover {
    background: white;
  }

  .not-found-label {
    font-size: 0.75rem;
    color: #999;
    font-style: italic;
    margin-left: 0.5rem;
  }

  li.not-found {
    opacity: 0.5;
  }

</style>

