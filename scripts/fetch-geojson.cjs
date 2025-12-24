const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const OVERPASS_API_URL = 'https://overpass.kumi.systems/api/interpreter';

function buildQuery(lineRef) {
  return `
[out:json][timeout:60];
area["name"="Communauté urbaine Caen la Mer"]["boundary"="local_authority"]->.caen;
relation(area.caen)["type"="route"]["network"="Twisto"]["ref"="${lineRef}"];
out geom;
`;
}

function relationToGeoJSON(relation) {
  if (!relation.members) return null;
  const seenWays = new Set();
  const lines = [];
  for (const member of relation.members) {
    if (member.type === 'way' && member.geometry) {
      const line = member.geometry.map(p => [p.lon, p.lat]);
      if (line.length < 2) continue;
      const key = line.map(c => c.join(',')).join(';');
      if (seenWays.has(key)) continue;
      seenWays.add(key);
      lines.push(line);
    }
  }
  if (lines.length === 0) return null;
  return {
    type: 'Feature',
    properties: { ref: relation.tags.ref, name: relation.tags.name, network: relation.tags.network },
    geometry: { type: 'MultiLineString', coordinates: lines }
  };
}

async function fetchLineGeoJSON(lineRef) {
  console.log(`[OSM] Fetching GeoJSON for line ${lineRef}...`);
  const query = buildQuery(lineRef);
  try {
    const response = await fetch(OVERPASS_API_URL, {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const relations = data.elements.filter(e => e.type === 'relation');
    if (relations.length === 0) {
      console.warn(`[OSM] No relation found for line ${lineRef}`);
      return null;
    }
    const features = relations.map(relationToGeoJSON).filter(Boolean);
    if (features.length === 0) {
      console.warn(`[OSM] No geometry found for line ${lineRef}`);
      return null;
    }
    const allCoords = features.flatMap(f => f.geometry.coordinates);
    if (allCoords.length === 0) {
        console.warn(`[OSM] No coordinates found for line ${lineRef}`);
        return null;
    }
    const finalGeoJSON = { type: 'MultiLineString', coordinates: allCoords };
    console.log(`[OSM] Fetched ${allCoords.length} segments for line ${lineRef}.`);
    return finalGeoJSON;
  } catch (error) {
    console.error(`[OSM] Failed to fetch line ${lineRef}: ${error.message}`);
    return null;
  }
}

async function fetchAndSaveLines(linesToFetch, outputDir) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  for (const lineRef of linesToFetch) {
    const geojson = await fetchLineGeoJSON(lineRef);
    if (geojson) {
      const outputPath = path.join(outputDir, `${lineRef}.geojson`);
      fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
      console.log(`[OSM] Saved GeoJSON for ${lineRef} to ${outputPath}`);
    }
    // Delay to avoid overloading the API
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

// Allow this script to be run directly or imported as a module
if (require.main === module) {
  const LINES = [
    'T1', 'T2', 'T3', '1', '2', '3', '4', '5', '6A', '6B', '7', '8', '9', '10', '11', '12', '20', '21', '22', '23', '30', '31', '32', '34'
  ];
  const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'geo', 'lines');
  
  console.log('--- Starting OSM GeoJSON Fetch ---');
  fetchAndSaveLines(LINES, OUTPUT_DIR)
    .then(() => console.log('--- OSM GeoJSON Fetch Complete ---'))
    .catch(console.error);
}

module.exports = { fetchLineGeoJSON, fetchAndSaveLines };