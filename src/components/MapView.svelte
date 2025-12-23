<script>
  import { onMount } from 'svelte';
  import maplibregl from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';

  export let foundStopIds = [];
  export let allStops = [];
  export let lines = [];
  export let activeNetworks = [];
  export let hiddenLines = [];

  let mapContainer;
  let map;
  let loadedGeoJSONs = new Map();
  let visibilityRecheckTimer = null;

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
      // charger immédiatement les tracés si les lignes/networks sont déjà disponibles
      loadLinesGeoJSON();
    });
    
    return () => map.remove();
  });

  function initializeLayers() {
    // Add source for stops
    map.addSource('stops', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: []
      }
    });

    // Add circle layer for all stops (unfound)
    map.addLayer({
      id: 'stops-unfound',
      type: 'circle',
      source: 'stops',
      filter: ['!', ['get', 'found']],
      paint: {
        'circle-radius': 4,
        'circle-color': '#ffffff',
        'circle-stroke-width': 1,
        'circle-stroke-color': '#888888'
      }
    });

    // Add circle layer for found stops
    map.addLayer({
      id: 'stops-found',
      type: 'circle',
      source: 'stops',
      filter: ['get', 'found'],
      paint: {
        'circle-radius': 5,
        'circle-color': ['get', 'color'],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff'
      }
    });

    // Add label layer for found stops
    map.addLayer({
      id: 'stops-labels',
      type: 'symbol',
      source: 'stops',
      filter: ['get', 'found'],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
        'text-size': 11,
        'text-offset': [0, 1.2],
        'text-anchor': 'top'
      },
      paint: {
        'text-color': '#333333',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1
      }
    });

    // Load initial data
    updateStopsLayer();
  }

  // Load GeoJSON for active lines only
  $: {
    if (map && map.loaded() && lines.length > 0 && activeNetworks.length > 0) {
      loadLinesGeoJSON();
    }
  }

  // Update layer visibility when hiddenLines changes
  $: {
    if (map && map.loaded() && loadedGeoJSONs.size > 0) {
      hiddenLines;
      updateLayerVisibility();
      
      // Schedule a recheck 1 second later to catch any race conditions
      if (visibilityRecheckTimer) {
        clearTimeout(visibilityRecheckTimer);
      }
      visibilityRecheckTimer = setTimeout(() => {
        updateLayerVisibility();
        visibilityRecheckTimer = null;
      }, 1000);
    }
  }

  function updateLayerVisibility() {
    console.log('[updateLayerVisibility] Called with hiddenLines:', hiddenLines);
    console.log('[updateLayerVisibility] loadedGeoJSONs:', Array.from(loadedGeoJSONs.keys()));
    
    for (const [lineRef, layers] of loadedGeoJSONs.entries()) {
      const isHidden = hiddenLines.includes(lineRef);
      const targetVisibility = isHidden ? 'none' : 'visible';
      
      for (const { layerId } of layers) {
        const layerExists = map.getLayer(layerId);
        console.log(`[updateLayerVisibility] Layer ${layerId}: exists=${!!layerExists}, target=${targetVisibility}`);
        
        if (layerExists) {
          const currentVis = map.getLayoutProperty(layerId, 'visibility');
          console.log(`[updateLayerVisibility] Layer ${layerId} current visibility: ${currentVis}`);
          map.setLayoutProperty(layerId, 'visibility', targetVisibility);
          const newVis = map.getLayoutProperty(layerId, 'visibility');
          console.log(`[updateLayerVisibility] Layer ${layerId} NEW visibility: ${newVis}`);
        } else {
          console.error(`[updateLayerVisibility] Layer ${layerId} DOES NOT EXIST in map!`);
        }
      }
    }
    
    // Force map to repaint
    map.triggerRepaint();
  }

  async function loadLinesGeoJSON() {
    // Filter lines by active networks
    const activeLines = lines.filter(line => activeNetworks.includes(line.network));
    const displayRefMap = { '6A': '6', '6B': '6' };

    // Remove layers for inactive lines (network changed)
    for (const lineRef of Array.from(loadedGeoJSONs.keys())) {
      const isActive = activeLines.some(l => (displayRefMap[l.ref] || l.ref) === lineRef);
      if (!isActive) {
        const ids = loadedGeoJSONs.get(lineRef) || [];
        for (const { layerId, sourceId } of ids) {
          if (map.getLayer(layerId)) map.removeLayer(layerId);
          if (map.getSource(sourceId)) map.removeSource(sourceId);
        }
        loadedGeoJSONs.delete(lineRef);
      }
    }

    // Load new active lines
    for (const line of activeLines) {
      const displayRef = displayRefMap[line.ref] || line.ref;
      
      // Load if not already loaded
      if (!loadedGeoJSONs.has(displayRef)) {
        try {
          const response = await fetch(`/geo/lines/${displayRef}.geojson`);
          if (!response.ok) continue;

          const geojson = await response.json();
          const sourceId = `line-${displayRef}`;
          const layerId = `line-layer-${displayRef}`;

          if (!map.getSource(sourceId)) {
            map.addSource(sourceId, { type: 'geojson', data: geojson });
          }

          if (!map.getLayer(layerId)) {
            map.addLayer({
              id: layerId,
              type: 'line',
              source: sourceId,
              layout: { 'line-join': 'round', 'line-cap': 'round' },
              paint: {
                'line-color': line.color_hex || '#888888',
                'line-width': 2.5,
                'line-opacity': 0.8,
                'line-blur': 0
              }
            }, 'stops-unfound');
          }

          loadedGeoJSONs.set(displayRef, [{ layerId, sourceId }]);
        } catch (error) {
          console.warn(`Could not load GeoJSON for line ${displayRef}:`, error);
        }
      }
    }
    
    // Update visibility for all loaded layers
    updateLayerVisibility();
  }

  // Reactive updates when stops, foundStopIds or activeNetworks change
  $: {
    if (map && map.getSource('stops')) {
      // reference reactive inputs to ensure this block runs when they change
      foundStopIds; allStops; activeNetworks; lines; hiddenLines;
      updateStopsLayer();
    }
  }

  function updateStopsLayer() {
    const foundSet = new Set(foundStopIds);
    const lineColors = {};
    for (const line of lines) {
      lineColors[line.ref] = line.color_hex;
    }

    const displayRefMap = { '6A': '6', '6B': '6' };

    // Filter stops by active networks and non-hidden lines
    const activeStops = allStops.filter(s => {
      if (!activeNetworks.includes(s.network)) return false;
      const displayRef = displayRefMap[s.line_ref] || s.line_ref;
      return !hiddenLines.includes(displayRef);
    });

    const features = activeStops.map(stop => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [stop.lon, stop.lat]
      },
      properties: {
        id: stop.id,
        name: stop.name,
        line: stop.line_ref,
        found: foundSet.has(stop.id),
        color: lineColors[stop.line_ref] || '#888888'
      }
    }));

    map.getSource('stops').setData({
      type: 'FeatureCollection',
      features
    });
  }

  export function setHiddenLines(newHidden) {
    hiddenLines = Array.isArray(newHidden) ? newHidden.slice() : [];
    if (map) {
      updateLayerVisibility();
      updateStopsLayer();
    }
  }

  export function centerOnStop(stopId) {
    const stop = allStops.find(s => s.id === stopId);
    if (stop && map) {
      map.flyTo({
        center: [stop.lon, stop.lat],
        zoom: 15,
        duration: 1000
      });

      // Show popup
      new maplibregl.Popup()
        .setLngLat([stop.lon, stop.lat])
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
