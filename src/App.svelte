<script>
  import { onMount } from 'svelte';
  import MapView from './components/MapView.svelte';
  import SideView from './components/SideView.svelte';
  import GuessInput from './components/GuessInput.svelte';
  import { loadDb, getAllStops, getActiveStops, getLines, getStopById } from './lib/db.js';
  import { getStoredData, storeData, clearAllData } from './lib/storage.js';
  import { getActiveNetworks } from './lib/progression.js';
  import { matchStops } from './lib/search.js';
  import { levenshtein } from './lib/distance.js';

  let allStops = [];
  let lines = [];
  let foundStopIds = [];
  let activeNetworks = [];
  let hiddenLines = [];
  let focusedLines = []; // Lines visible in focus mode
  let hiddenLinesBeforeFocus = []; // Hidden lines before entering focus mode
  let inFocusMode = false;
  let loading = true;
  let mapViewRef;
  let guessInputRef;

  onMount(async () => {
    const storedFoundStopIds = getStoredData('foundStopIds');
    if (storedFoundStopIds && Array.isArray(storedFoundStopIds)) {
      foundStopIds = storedFoundStopIds;
    }
    const storedHiddenLines = getStoredData('hiddenLines');
    if (storedHiddenLines && Array.isArray(storedHiddenLines)) {
      hiddenLines = storedHiddenLines;
    }
    await loadAndProcessDb();
    
    // Update found stops to include all lines at matching stop names when phase changes
    updateFoundStopsForPhase();
    
    loading = false;
  });

  async function loadAndProcessDb() {
    await loadDb();
    allStops = getAllStops();
    lines = getLines();
    activeNetworks = getActiveNetworks(foundStopIds, allStops);
  }

  // Update found stops to include all active network stops at the same location
  function updateFoundStopsForPhase() {
    if (foundStopIds.length === 0) return;
    
    const foundSet = new Set(foundStopIds);
    const foundStopNames = new Set();
    
    // Collect all found stop names (normalized)
    for (const stopId of foundStopIds) {
      const stop = allStops.find(s => s.id === stopId);
      if (stop) {
        foundStopNames.add(stop.name.toLowerCase().trim());
      }
    }
    
    // Find all stops in active networks matching found names
    const newFoundIds = [];
    for (const stop of allStops) {
      if (activeNetworks.includes(stop.network)) {
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
      activeNetworks.includes(s.network) && !foundStopIds.includes(s.id)
    );

    const matchedIds = matchStops(guess, availableStops, levenshtein);

    if (matchedIds.length === 0) {
      guessInputRef?.showFeedback('Aucun arrêt trouvé', 'error');
      return;
    }

    // Update found stops
    foundStopIds = [...foundStopIds, ...matchedIds];
    const previousActiveNetworks = [...activeNetworks];
    activeNetworks = getActiveNetworks(foundStopIds, allStops);
    
    // If phase changed, update all previously found stops
    if (previousActiveNetworks.length !== activeNetworks.length) {
      updateFoundStopsForPhase();
    }
    
    storeData('foundStopIds', foundStopIds);

    // Show feedback
    const count = matchedIds.length;
    guessInputRef?.showFeedback(
      `${count} arrêt${count > 1 ? 's' : ''} trouvé${count > 1 ? 's' : ''} !`,
      'success'
    );
  }

  function handleStopClick(stopId) {
    mapViewRef?.centerOnStop(stopId);
  }

  function handleClearProgress() {
    foundStopIds = [];
    activeNetworks = getActiveNetworks([], allStops);
    storeData('foundStopIds', []);
    // Note: clearAllData supprime aussi expandedLines et sortModes
    // Pour éviter de tout perdre, on stocke juste foundStopIds vide
  }

  function handleToggleLine(lineRef, shiftKey = false) {
    const displayRefMap = { '6A': '6', '6B': '6' };
    
    if (shiftKey) {
      // Shift-click behavior
      if (inFocusMode && focusedLines.includes(lineRef)) {
        // Shift-click on a focused line: exit focus mode
        inFocusMode = false;
        hiddenLines = [...hiddenLinesBeforeFocus];
        focusedLines = [];
        hiddenLinesBeforeFocus = [];
      } else {
        // Shift-click on non-focused line: enter/change focus mode
        const allLineRefs = lines
          .filter(line => activeNetworks.includes(line.network))
          .reduce((acc, line) => {
            const displayRef = displayRefMap[line.ref] || line.ref;
            if (!acc.includes(displayRef)) acc.push(displayRef);
            return acc;
          }, []);
        
        if (!inFocusMode) {
          // Entering focus mode: save current hidden lines
          hiddenLinesBeforeFocus = [...hiddenLines];
        }
        
        inFocusMode = true;
        focusedLines = [lineRef];
        // Hide all lines except the focused one
        hiddenLines = allLineRefs.filter(ref => ref !== lineRef);
      }
    } else {
      if (hiddenLines.includes(lineRef)) {
        hiddenLines = hiddenLines.filter(l => l !== lineRef);
        if (inFocusMode && !focusedLines.includes(lineRef)) {
          // showing a line in focus mode -> include in focusedLines
          focusedLines = [...focusedLines, lineRef];
        }
      } else {
        hiddenLines = [...hiddenLines, lineRef];
        if (inFocusMode) {
          // hiding a line in focus mode -> remove from focusedLines
          focusedLines = focusedLines.filter(l => l !== lineRef);
        }
      }
    }

    // Ensure focused lines are always visible (not present in hiddenLines)
    if (focusedLines.length > 0) {
      hiddenLines = hiddenLines.filter(h => !focusedLines.includes(h));
    }

    // If not in focus mode, clear focusedLines
    if (!inFocusMode) {
      focusedLines = [];
    }

    storeData('hiddenLines', hiddenLines);
    // Force immediate map update to avoid races when toggling rapidly
    if (mapViewRef) {
      mapViewRef.setHiddenLines(hiddenLines);
    }
  }

  const displayRefMap = { '6A': '6', '6B': '6' };
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
