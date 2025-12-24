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
  let mobileMenuOpen = false;

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
      
      <!-- Mobile hamburger menu -->
      <button class="mobile-menu-toggle" on:click={() => mobileMenuOpen = !mobileMenuOpen}>
        ☰
      </button>
      
      {#if mobileMenuOpen}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="mobile-menu-overlay" on:click={() => mobileMenuOpen = false}>
          <div class="mobile-menu" on:click|stopPropagation>
            <SideView 
              {foundStopIds} 
              {allStops} 
              {activeNetworks}
              {lines}
              {hiddenLines}
              {focusedLines}
              {inFocusMode}
              onStopClick={(stopId) => { handleStopClick(stopId); mobileMenuOpen = false; }}
              onClearProgress={handleClearProgress}
              onToggleLine={handleToggleLine}
            />
          </div>
        </div>
      {/if}
      
      <!-- Mobile line ribbon -->
      <div class="mobile-line-ribbon">
        {#each visibleLines as line}
          <div class="line-ribbon-item">
            <img src="/icons/{line.ref}.png" alt="Ligne {line.ref}" on:error={(e) => e.target.style.display = 'none'} />
          </div>
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

  .mobile-menu-toggle {
    display: none;
    position: fixed;
    top: 1rem;
    right: 1rem;
    z-index: 1100;
    width: 50px;
    height: 50px;
    border-radius: 50%;
    border: 2px solid #333;
    background: white;
    font-size: 1.5rem;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  }

  .mobile-menu-overlay {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.5);
    z-index: 1200;
  }

  .mobile-menu {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 80%;
    max-width: 400px;
    background: white;
    overflow-y: auto;
    box-shadow: -2px 0 8px rgba(0,0,0,0.3);
  }

  .mobile-line-ribbon {
    display: none;
    position: fixed;
    bottom: 80px;
    left: 0;
    right: 0;
    background: white;
    border-top: 2px solid #e0e0e0;
    overflow-x: auto;
    white-space: nowrap;
    padding: 0.5rem;
    z-index: 999;
    box-shadow: 0 -2px 8px rgba(0,0,0,0.1);
  }

  .line-ribbon-item {
    display: inline-block;
    margin-right: 0.5rem;
  }

  .line-ribbon-item img {
    width: 40px;
    height: 40px;
    object-fit: contain;
  }

  @media (max-width: 768px) {
    .side-panel.right {
      display: none;
    }

    .mobile-menu-toggle {
      display: block;
    }

    .mobile-menu-overlay {
      display: block;
    }

    .mobile-line-ribbon {
      display: block;
    }

    .floating-input {
      max-width: none;
      width: calc(100% - 2rem);
    }
  }
</style>
