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
    loading = false;
  });

  async function loadAndProcessDb() {
    await loadDb();
    allStops = getAllStops();
    lines = getLines();
    activeNetworks = getActiveNetworks(foundStopIds, allStops);
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
    activeNetworks = getActiveNetworks(foundStopIds, allStops);
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

  function handleToggleLine(lineRef) {
    if (hiddenLines.includes(lineRef)) {
      hiddenLines = hiddenLines.filter(l => l !== lineRef);
    } else {
      hiddenLines = [...hiddenLines, lineRef];
    }
    storeData('hiddenLines', hiddenLines);
  }
</script>

<main>
  {#if loading}
    <div class="loading-overlay">
      <p>Chargement des données...</p>
    </div>
  {:else}
    <div class="app">
      <div class="top-bar">
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
  }

  .top-bar {
    background: white;
    border-bottom: 2px solid #e0e0e0;
    z-index: 100;
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
