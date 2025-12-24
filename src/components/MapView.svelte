<script>
  import { onMount, afterUpdate } from 'svelte';
  import maplibregl from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';

  export let foundStopIds = [];
  export let allStops = []; // Enriched with .networks and .lines Sets
  export let lines = [];
  export let activeNetworks = [];
  export let hiddenLines = [];

  let mapContainer;
  let map;
  let updateTimer = null;
  let visibilityRecheckTimer = null;

  afterUpdate(() => {
    // Debounce map updates to prevent race conditions on rapid state changes
    clearTimeout(updateTimer);
    updateTimer = setTimeout(() => {
      if (map && map.loaded()) {
        updateLinesAndStopsOnMap();
        
        // Schedule a recheck after 500ms to catch any race conditions
        clearTimeout(visibilityRecheckTimer);
        visibilityRecheckTimer = setTimeout(() => {
          if (map && map.loaded()) {
            updateLinesAndStopsOnMap(); // Recheck both lines and stops visibility
          }
          visibilityRecheckTimer = null;
        }, 500);
      }
    }, 50); // 50ms delay is usually enough to batch rapid clicks
  });

  onMount(() => {
    map = new maplibregl.Map({
      container: mapContainer,
      style: '/style.json',
      center: [-0.37, 49.18],
      zoom: 12,
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    map.on('load', () => {
      initializeLayers();
      updateLinesAndStopsOnMap(); // Initial update
    });
    
    return () => {
      clearTimeout(updateTimer);
      clearTimeout(visibilityRecheckTimer);
      map.remove();
    };
  });

  function initializeLayers() {
    map.addSource('stops', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    map.addLayer({
      id: 'stops-unfound',
      type: 'circle',
      source: 'stops',
      filter: ['all', ['!', ['get', 'found']], ['==', ['get', 'visible'], true]],
      paint: { 'circle-radius': 4, 'circle-color': '#ffffff', 'circle-stroke-width': 1, 'circle-stroke-color': '#888888' }
    });

    map.addLayer({
      id: 'stops-found',
      type: 'circle',
      source: 'stops',
      filter: ['all', ['get', 'found'], ['==', ['get', 'visible'], true]],
      paint: { 'circle-radius': 5, 'circle-color': ['get', 'color'], 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' }
    });

    map.addLayer({
      id: 'stops-labels',
      type: 'symbol',
      source: 'stops',
      filter: ['all', ['get', 'found'], ['==', ['get', 'visible'], true]],
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'], 'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top' },
      paint: { 'text-color': '#333333', 'text-halo-color': '#ffffff', 'text-halo-width': 1 }
    });
  }

  function updateLinesAndStopsOnMap() {
    addOrUpdateLines();
    updateStopsOnMap();
  }

  function addOrUpdateLines() {
    if (!lines) return;
    
    lines.forEach(line => {
      const sourceId = `line-${line.ref}`;
      const layerId = `line-layer-${line.ref}`;
      
      // 1. Add source and layer if they don't exist
      if (!map.getSource(sourceId)) {
        if (line.geojson && line.geojson.coordinates && line.geojson.coordinates.length > 0) {
          map.addSource(sourceId, { type: 'geojson', data: line.geojson });
          map.addLayer({
            id: layerId,
            type: 'line',
            source: sourceId,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': line.color_hex || '#888', 'line-width': 2.5, 'line-opacity': 0.8 }
          }, 'stops-unfound');
        }
      }

      // 2. Always update visibility
      if (map.getLayer(layerId)) {
        const isVisible = activeNetworks.includes(line.network) && !hiddenLines.includes(line.ref);
        map.setLayoutProperty(layerId, 'visibility', isVisible ? 'visible' : 'none');
      }
    });
  }

  function updateStopsOnMap() {
    const foundSet = new Set(foundStopIds);

    const features = allStops.map(stop => {
      const stopLines = stop.lines ? Array.from(stop.lines) : [];
      const activeVisibleLines = stopLines.filter(lineRef => {
        const line = lines.find(l => l.ref === lineRef);
        return line && activeNetworks.includes(line.network) && !hiddenLines.includes(line.ref);
      });

      const isVisible = activeVisibleLines.length > 0;
      const firstVisibleLineRef = isVisible ? activeVisibleLines[0] : null;
      const color = firstVisibleLineRef ? lines.find(l => l.ref === firstVisibleLineRef)?.color_hex : '#888';

      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [stop.lon, stop.lat] },
        properties: {
          id: stop.id,
          name: stop.name,
          found: foundSet.has(stop.id),
          visible: isVisible || foundSet.has(stop.id), // A stop is always visible if found
          color: color
        }
      };
    });
    
    const source = map.getSource('stops');
    if (source) {
      source.setData({ type: 'FeatureCollection', features: features });
    }
  }
  
  // This function is called from App.svelte to handle rapid toggling
  export function setHiddenLines(newHidden) {
    hiddenLines = newHidden;
    // The debounced afterUpdate will handle the map update
  }

  export function centerOnStop(stopId) {
    const stop = allStops.find(s => s.id === stopId);
    if (stop && map) {
      map.flyTo({ center: [stop.lon, stop.lat], zoom: 15, duration: 1000 });
      new maplibregl.Popup({ closeButton: false, offset: 15 })
        .setLngLat([stop.lon, stop.lat])
        .setHTML(`<strong>${stop.name}</strong>`)
        .addTo(map);
    }
  }
</script>

<div class="map-wrap" bind:this={mapContainer}></div>

<style>
  .map-wrap {
    width: 100%;
    height: 100%;
  }
</style>
