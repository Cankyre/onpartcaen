<script>
  import { onMount } from 'svelte';
  import MapView from './components/MapView.svelte';
  import SideView from './components/SideView.svelte';
  import GuessInput from './components/GuessInput.svelte';
  import { loadDb, getAllStops, getLines, getStopsForLine } from './lib/db.js';
  import { getStoredData, storeData } from './lib/storage.js';
  import { getActiveNetworks } from './lib/progression.js';
  import { matchStops } from './lib/search.js';
  import { levenshtein } from './lib/distance.js';

  let allStops = []; // This will become the enriched list of stops
  let lines = [];
  let foundStopIds = [];
  let activeNetworks = [];
  let hiddenLines = [];
  let focusedLines = [];
  let hiddenLinesBeforeFocus = [];
  let inFocusMode = false;
  let loading = true;
  let devMode = false;
  let mapViewRef;
  let guessInputRef;

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
    } else {
      activeNetworks = getActiveNetworks(foundStopIds, lines);
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
      if (Array.from(stop.networks).some(n => activeNetworks.includes(n))) {
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

    const availableStops = allStops.filter(s => 
      Array.from(s.networks).some(n => activeNetworks.includes(n)) && !foundStopIds.includes(s.id)
    );

    const matchedIds = matchStops(guess, availableStops, levenshtein);

    if (matchedIds.length === 0) {
      guessInputRef?.showFeedback('Aucun arrêt trouvé', 'error');
      return;
    }

    foundStopIds = [...foundStopIds, ...matchedIds];
    
    if (!devMode) {
      const previousActiveNetworks = [...activeNetworks];
      activeNetworks = getActiveNetworks(foundStopIds, lines);
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
        const allLineRefs = lines
          .filter(line => activeNetworks.includes(line.network))
          .map(line => line.ref);
        
        if (!inFocusMode) {
          hiddenLinesBeforeFocus = [...hiddenLines];
        }
        
        inFocusMode = true;
        focusedLines = [lineRef];
        hiddenLines = allLineRefs.filter(ref => ref !== lineRef);
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
      <div class="floating-input">
        <GuessInput 
          bind:this={guessInputRef}
          on:submit={handleGuess} 
        />
      </div>
      <div class="main-content">
        <div class="map-area">
          <MapView 
            bind:this={mapViewRef}
            {foundStopIds} 
            {allStops} 
            {lines}
            {activeNetworks}
            {hiddenLines}
          />
        </div>
        <aside class="side-panel right">
          <SideView 
            {foundStopIds} 
            {allStops} 
            {activeNetworks}
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
    top: 1rem;
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

  @media (max-width: 768px) {
    .main-content {
      flex-direction: column;
    }

    .map-area {
      height: 50%;
    }

    .side-panel.right {
      width: 100%;
      height: 50%;
      border-left: none;
      border-top: 2px solid #e0e0e0;
    }
  }
</style>
