<script>
  import { onMount } from 'svelte';
  import MapView from './components/MapView.svelte';
  import SideView from './components/SideView.svelte';
  import GuessInput from './components/GuessInput.svelte';
  import { loadDb, getAllStops, getLines, getStopsForLine } from './lib/db.js';
  import { getStoredData, storeData } from './lib/storage.js';
  import { getActiveNetworks, getActiveLineCategories, getLineCategory } from './lib/progression.js';
  import { matchStops } from './lib/search.js';
  import { levenshtein } from './lib/distance.js';

  let allStops = []; // This will become the enriched list of stops
  let lines = [];
  let foundStopIds = [];
  let activeNetworks = [];
  let activeLineCategories = [];
  let hiddenLines = [];
  let focusedLines = [];
  let hiddenLinesBeforeFocus = [];
  let inFocusMode = false;
  let loading = true;
  let devMode = false;
  let mapViewRef;
  let guessInputRef;
  let showAboutMobile = false;

  function getLineOrder(ref) {
    if (typeof ref !== 'string') return 9999;
    const isTram = ref.startsWith('T');
    const num = parseInt(ref.replace('Nomad ', ''), 10);
    if (isTram) return 1000 + num;
    if (!isNaN(num)) {
      if (num < 100) return 2000 + num;
      return 4000 + num;
    }
    return 3000;
  }

  // Filter lines by both network AND category
  $: activeLines = lines.filter(line => {
    const inNetwork = activeNetworks.includes(line.network);
    const inCategory = activeLineCategories.includes(getLineCategory(line.ref));
    return inNetwork && inCategory;
  });

  $: visibleLines = activeLines
    .filter(line => !hiddenLines.includes(line.ref))
    .sort((a, b) => getLineOrder(a.ref) - getLineOrder(b.ref));

  function calculateMobileProgress() {
    if (activeLines.length === 0) return 0;
    const allStopsInActiveLines = new Set();
    activeLines.forEach(line => {
      getStopsForLine(line.ref).forEach(s => allStopsInActiveLines.add(s.id));
    });
    const foundInActive = foundStopIds.filter(id => allStopsInActiveLines.has(id)).length;
    return allStopsInActiveLines.size > 0 ? Math.round((foundInActive / allStopsInActiveLines.size) * 100) : 0;
  }

  function toggleAboutMobile() {
    showAboutMobile = !showAboutMobile;
  }

  function handleExportMobile() {
    const json = JSON.stringify(foundStopIds);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'foundStops.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportMobile() {
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

  onMount(async () => {
    const urlParams = new URLSearchParams(window.location.search);
    devMode = urlParams.has('dev');

    const storedFoundStopIds = getStoredData('foundStopIds');
    if (storedFoundStopIds && Array.isArray(storedFoundStopIds)) {
      foundStopIds = storedFoundStopIds;
    }
    const storedHiddenLines = getStoredData('hiddenLines');
    if (storedHiddenLines && Array.isArray(storedHiddenLines)) {
      hiddenLines = storedHiddenLines;
    }
    
    await loadAndProcessDb();
    
    if (!devMode) {
      updateFoundStopsForPhase();
    }
    
    loading = false;
  });

  async function loadAndProcessDb() {
    await loadDb();
    const basicStops = getAllStops();
    lines = getLines();

    // Pre-process stops to map them to their lines and networks for efficient access
    const stopDetailsMap = new Map();
    for (const line of lines) {
      const stopsOnLine = getStopsForLine(line.ref);
      for (const stop of stopsOnLine) {
        if (!stopDetailsMap.has(stop.id)) {
          stopDetailsMap.set(stop.id, { networks: new Set(), lines: new Set() });
        }
        const details = stopDetailsMap.get(stop.id);
        details.networks.add(line.network);
        details.lines.add(line.ref);
      }
    }

    // Enrich the main allStops array
    allStops = basicStops.map(stop => ({
      ...stop,
      ...(stopDetailsMap.get(stop.id) || { networks: new Set(), lines: new Set() })
    }));

    if (devMode) {
      activeNetworks = ['tram', 'bus'];
      activeLineCategories = ['tram', 'regular', 'complementary'];
    } else {
      activeNetworks = getActiveNetworks(foundStopIds, lines);
      activeLineCategories = getActiveLineCategories(foundStopIds, lines);
    }
  }

  function updateFoundStopsForPhase() {
    if (foundStopIds.length === 0 || devMode) return;
    
    const foundSet = new Set(foundStopIds);
    const foundStopNames = new Set();
    
    for (const stopId of foundStopIds) {
      const stop = allStops.find(s => s.id === stopId);
      if (stop) {
        foundStopNames.add(stop.name.toLowerCase().trim());
      }
    }
    
    const newFoundIds = [];
    for (const stop of allStops) {
      // Check if stop belongs to an active line (network AND category)
      const stopActiveLines = Array.from(stop.lines).filter(lineRef => {
        const line = lines.find(l => l.ref === lineRef);
        if (!line) return false;
        const inNetwork = activeNetworks.includes(line.network);
        const inCategory = activeLineCategories.includes(getLineCategory(line.ref));
        return inNetwork && inCategory;
      });
      
      if (stopActiveLines.length > 0) {
        const normalizedName = stop.name.toLowerCase().trim();
        if (foundStopNames.has(normalizedName) && !foundSet.has(stop.id)) {
          newFoundIds.push(stop.id);
        }
      }
    }
    
    if (newFoundIds.length > 0) {
      foundStopIds = [...foundStopIds, ...newFoundIds];
      storeData('foundStopIds', foundStopIds);
    }
  }

  function handleGuess(event) {
    const { guess } = event.detail;

    const availableStops = allStops.filter(s => {
      // Check if stop belongs to an active line (network AND category)
      const hasActiveLine = Array.from(s.lines).some(lineRef => {
        const line = lines.find(l => l.ref === lineRef);
        if (!line) return false;
        const inNetwork = activeNetworks.includes(line.network);
        const inCategory = activeLineCategories.includes(getLineCategory(line.ref));
        return inNetwork && inCategory;
      });
      return hasActiveLine && !foundStopIds.includes(s.id);
    });

    const matchedIds = matchStops(guess, availableStops, levenshtein);

    if (matchedIds.length === 0) {
      guessInputRef?.showFeedback('Aucun arrêt trouvé', 'error');
      return;
    }

    foundStopIds = [...foundStopIds, ...matchedIds];
    
    if (!devMode) {
      const previousActiveNetworks = [...activeNetworks];
      activeNetworks = getActiveNetworks(foundStopIds, lines);
      activeLineCategories = getActiveLineCategories(foundStopIds, lines);
      if (previousActiveNetworks.length !== activeNetworks.length) {
        updateFoundStopsForPhase();
      }
    }
    
    storeData('foundStopIds', foundStopIds);

    const count = matchedIds.length;
    const firstStopName = allStops.find(s => s.id === matchedIds[0])?.name || '';
    guessInputRef?.showFeedback(
      count > 1 ? `${count} arrêts trouvés !` : `Arrêt "${firstStopName}" trouvé !`,
      'success'
    );
  }

  function handleStopClick(stopId) {
    mapViewRef?.centerOnStop(stopId);
  }

  function handleClearProgress() {
    foundStopIds = [];
    if (!devMode) {
      activeNetworks = getActiveNetworks([], lines);
      activeLineCategories = getActiveLineCategories([], lines);
    }
    storeData('foundStopIds', []);
  }

  function handleToggleLine(lineRef, shiftKey = false) {
    if (shiftKey) {
      if (inFocusMode && focusedLines.includes(lineRef)) {
        inFocusMode = false;
        hiddenLines = [...hiddenLinesBeforeFocus];
        focusedLines = [];
        hiddenLinesBeforeFocus = [];
      } else {
        const allActiveLineRefs = activeLines.map(line => line.ref);
        
        if (!inFocusMode) {
          hiddenLinesBeforeFocus = [...hiddenLines];
        }
        
        inFocusMode = true;
        focusedLines = [lineRef];
        hiddenLines = allActiveLineRefs.filter(ref => ref !== lineRef);
      }
    } else {
      if (hiddenLines.includes(lineRef)) {
        hiddenLines = hiddenLines.filter(l => l !== lineRef);
        if (inFocusMode && !focusedLines.includes(lineRef)) {
          focusedLines = [...focusedLines, lineRef];
        }
      } else {
        hiddenLines = [...hiddenLines, lineRef];
        if (inFocusMode) {
          focusedLines = focusedLines.filter(l => l !== lineRef);
        }
      }
    }

    if (focusedLines.length > 0) {
      hiddenLines = hiddenLines.filter(h => !focusedLines.includes(h));
    }

    if (!inFocusMode) {
      focusedLines = [];
    }

    storeData('hiddenLines', hiddenLines);
    if (mapViewRef) {
      mapViewRef.setHiddenLines(hiddenLines);
    }
  }
</script>

<main>
  {#if loading}
    <div class="loading-overlay">
      <p>Chargement des données...</p>
    </div>
  {:else}
    <div class="app">
      <div class="main-content">
        <div class="map-area">
          <MapView 
            bind:this={mapViewRef}
            {foundStopIds} 
            {allStops} 
            {lines}
            {activeNetworks}
            {activeLineCategories}
            {hiddenLines}
          />
        </div>
        <aside class="side-panel right">
          <SideView 
            {foundStopIds} 
            {allStops} 
            {activeNetworks}
            {activeLineCategories}
            {lines}
            {hiddenLines}
            {focusedLines}
            {inFocusMode}
            onStopClick={handleStopClick}
            onClearProgress={handleClearProgress}
            onToggleLine={handleToggleLine}
          />
        </aside>
      </div>
      
      <!-- Mobile compact header (phase progress + actions) -->
      <div class="mobile-header">
        <div class="mobile-progress">
          <div class="progress-circle-small">
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
                stroke-dasharray="{calculateMobileProgress()}, 100"
              />
              <text x="18" y="21" text-anchor="middle" font-size="10" font-weight="bold">{calculateMobileProgress()}%</text>
            </svg>
          </div>
          <div class="progress-text-small">
            <strong>{foundStopIds.length}</strong> arrêts
          </div>
        </div>
        <div class="mobile-actions">
          <button on:click={handleExportMobile} title="Exporter">💾</button>
          <button on:click={handleImportMobile} title="Importer">📂</button>
          <button on:click={handleClearProgress} title="Réinitialiser">🔄</button>
          <button on:click={toggleAboutMobile} title="À propos">ℹ️</button>
        </div>
      </div>
      
      {#if showAboutMobile}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="about-modal" on:click={() => showAboutMobile = false}>
          <div class="about-content" on:click|stopPropagation>
            <h2>À propos</h2>
            <p><strong>On Part Caen ?</strong></p>
            <p>Un jeu développé par <a href="mailto:cankyre@caen.lol">Cankyre</a>.</p>
            <p>Cette application n'est en aucun cas affiliée à <em>Twisto</em> ou <em>RATP Dev</em>.</p>
            <p><strong>Données :</strong> GTFS officiel de Twisto.</p>
            <p>Inspiré par <a href="https://memory.pour.paris">Memory Pour Paris</a>.</p>
            <button on:click={() => showAboutMobile = false}>Fermer</button>
          </div>
        </div>
      {/if}
      
      <!-- Mobile line ribbon -->
      <div class="mobile-line-ribbon">
        {#each activeLines.sort((a, b) => getLineOrder(a.ref) - getLineOrder(b.ref)) as line}
          <button 
            class="line-ribbon-btn"
            class:hidden={hiddenLines.includes(line.ref)}
            on:click={(e) => handleToggleLine(line.ref, e.shiftKey)}
            title="Ligne {line.ref}"
          >
            <img src="/icons/{line.ref}.png" alt="Ligne {line.ref}" on:error={(e) => e.target.style.display = 'none'} />
            {#if hiddenLines.includes(line.ref)}
              <span class="eye-slash-small">👁️</span>
            {/if}
          </button>
        {/each}
      </div>
      
      <div class="floating-input">
        <GuessInput 
          bind:this={guessInputRef}
          on:submit={handleGuess} 
        />
      </div>
    </div>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen,
      Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
    color: #333;
  }
  
  main {
    height: 100vh;
    width: 100vw;
    overflow: hidden;
  }

  .loading-overlay {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100%;
    font-size: 1.2rem;
  }

  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    position: relative;
  }

  .floating-input {
    position: fixed;
    bottom: 1rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1000;
    width: 90%;
    max-width: 500px;
  }

  .main-content {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .map-area {
    flex: 1;
    height: 100%;
    overflow: hidden;
  }

  .side-panel.right {
    width: 400px;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: #f5f5f5;
    border-left: 2px solid #e0e0e0;
    overflow-y: auto;
  }

  .mobile-header {
    display: none;
  }

  .mobile-line-ribbon {
    display: none;
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
    z-index: 2000;
  }

  .about-content {
    background: white;
    padding: 2rem;
    border-radius: 8px;
    max-width: 400px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    max-height: 80vh;
    overflow-y: auto;
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

  @media (max-width: 768px) {
    .side-panel.right {
      display: none;
    }

    .floating-input {
      bottom: 0.5rem;
      width: calc(100% - 1rem);
      max-width: none;
    }

    .mobile-header {
      display: flex;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: white;
      border-bottom: 2px solid #e0e0e0;
      padding: 0.5rem;
      z-index: 1001;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    .mobile-progress {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .progress-circle-small {
      width: 40px;
      height: 40px;
      flex-shrink: 0;
    }

    .progress-circle-small svg {
      width: 100%;
      height: 100%;
    }

    .progress-text-small {
      font-size: 0.85rem;
      color: #333;
    }

    .mobile-actions {
      display: flex;
      gap: 0.3rem;
    }

    .mobile-actions button {
      padding: 0.4rem 0.6rem;
      border: 1px solid #ddd;
      background: white;
      cursor: pointer;
      border-radius: 4px;
      font-size: 1rem;
    }

    .mobile-actions button:hover {
      background: #f0f0f0;
    }

    .mobile-line-ribbon {
      display: flex;
      position: fixed;
      bottom: 100px;
      left: 0;
      right: 0;
      background: white;
      border-top: 2px solid #e0e0e0;
      overflow-x: auto;
      scrollbar-width: none;
      white-space: nowrap;
      padding: 0.5rem;
      z-index: 1000;
      box-shadow: 0 -2px 4px rgba(0,0,0,0.1);
      gap: 0.4rem;
    }

    .line-ribbon-btn {
      position: relative;
      width: 40px;
      height: 40px;
      padding: 0.2rem;
      border: 1px solid #ddd;
      background: white;
      cursor: pointer;
      border-radius: 4px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .line-ribbon-btn img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }

    .line-ribbon-btn.hidden {
      opacity: 0.3;
      filter: grayscale(1);
    }

    .eye-slash-small {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 0.9rem;
    }

    .main-content {
      padding-top: 60px;
      padding-bottom: 0;
    }

    .map-area {
      height: calc(100vh - 60px - 135px);
    }
  }
</style>