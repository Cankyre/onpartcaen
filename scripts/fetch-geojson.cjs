#!/usr/bin/env node

/**
 * Script pour télécharger les tracés GeoJSON des lignes depuis Overpass API
 * Sauvegarde dans /public/geo/lines/{ref}.geojson
 */

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const OVERPASS_API_URL = 'https://overpass.kumi.systems/api/interpreter';
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'geo', 'lines');

// Créer le dossier de sortie
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Lignes à télécharger (selon vos besoins)
const LINES = [
  'T1', 'T2', 'T3',
  '1', '2', '3', '4', '5', '6A', '6B', '7', '8', '9', '10', '10 EXPRESS',
  '11', '11 EXPRESS', '12',
  '20', '21', '22', '23',
  '30', '31', '32', '34',
  '40', '42', 'NOCTIBUS', 'NAVETTE CAEN'
  // '100', '101', '102', '103', '104', '107', '109',
  // '110', '111', '112', '113', '114', '115', '116', '118', '119',
  // '120', '121', '122', '123', '124', '125', '126', '127', '128',
  // '130', '131', '133', '134', '135', '136', '137', '138'
];

/**
 * Construire la requête Overpass pour une ligne
 */
function buildQuery(lineRef) {
  return `
[out:json][timeout:60];
area["name"="Communauté urbaine Caen la Mer"]["boundary"="local_authority"]->.caen;
relation(area.caen)["type"="route"]["network"="Twisto"]["ref"="${lineRef}"];
out geom;
`;
}

/**
 * Convertir une relation Overpass en GeoJSON LineString
 */
function relationToGeoJSON(relation) {
  if (!relation.members) return null;

  // collect each way as a separate line (array of coordinates)
  const seenWays = new Set();
  const lines = [];

  for (const member of relation.members) {
    if (member.type === 'way' && member.geometry) {
      const line = [];
      for (const point of member.geometry) {
        const coord = [point.lon, point.lat];
        const last = line[line.length - 1];
        // avoid consecutive duplicate points
        if (!last || last[0] !== coord[0] || last[1] !== coord[1]) {
          line.push(coord);
        }
      }

      if (line.length < 2) continue;

      // dedupe identical ways by simple serialization
      const key = line.map(c => c.join(',')).join(';');
      if (seenWays.has(key)) continue;
      seenWays.add(key);
      lines.push(line);
    }
  }

  if (lines.length === 0) return null;

  return {
    type: 'Feature',
    properties: {
      ref: relation.tags.ref,
      name: relation.tags.name || `Ligne ${relation.tags.ref}`,
      network: relation.tags.network,
      from: relation.tags.from,
      to: relation.tags.to
    },
    geometry: {
      type: lines.length === 1 ? 'LineString' : 'MultiLineString',
      coordinates: lines.length === 1 ? lines[0] : lines
    }
  };
}

/**
 * Télécharger le tracé d'une ligne
 */
async function fetchLineGeoJSON(lineRef) {
  console.log(`📡 Téléchargement ligne ${lineRef}...`);
  
  const query = buildQuery(lineRef);
  
  try {
    const response = await fetch(OVERPASS_API_URL, {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    const relations = data.elements.filter(e => e.type === 'relation');
    
    if (relations.length === 0) {
      console.log(`⚠️  Ligne ${lineRef}: aucune relation trouvée`);
      return null;
    }
    
    // Fusionner toutes les variantes de la ligne (ne pas limiter, on prendra tous les ways)
    const features = relations
      .map(rel => relationToGeoJSON(rel))
      .filter(Boolean);
    
    if (features.length === 0) {
      console.log(`⚠️  Ligne ${lineRef}: aucune géométrie extraite`);
      return null;
    }
    
    // Regrouper les variantes en un seul fichier MultiLineString par ligne
    const displayRefMap = { '6A': '6', '6B': '6' };
    const displayRef = displayRefMap[lineRef] || lineRef;

    // Construire MultiLineString en rassemblant chaque way (depuis chaque relation), en enlevant les doublons
    const multilineCoords = [];
    const seen = new Set();
    for (const f of features) {
      if (!f || !f.geometry) continue;
      const coordsArr = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const line of coordsArr) {
        const key = line.map(c => c.join(',')).join(';');
        if (seen.has(key)) continue;
        seen.add(key);
        multilineCoords.push(line);
      }
    }

    if (multilineCoords.length === 0) {
      console.log(`⚠️  Ligne ${lineRef}: aucune géométrie conservée`);
      return null;
    }

    const geojsonOut = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {
          ref: displayRef,
          originalRefs: Array.from(new Set(features.map(f => f.properties.ref))),
          network: features[0].properties.network || 'Twisto'
        },
        geometry: {
          type: multilineCoords.length === 1 ? 'LineString' : 'MultiLineString',
          coordinates: multilineCoords.length === 1 ? multilineCoords[0] : multilineCoords
        }
      }]
    };

    const outputPath = path.join(OUTPUT_DIR, `${displayRef}.geojson`);
    fs.writeFileSync(outputPath, JSON.stringify(geojsonOut, null, 2));

    console.log(`✅ Ligne ${lineRef} -> ${displayRef}: ${multilineCoords.length} segment(s) sauvegardé(s)`);
    return geojsonOut;
    
  } catch (error) {
    console.error(`❌ Ligne ${lineRef}: ${error.message}`);
    return null;
  }
}

/**
 * Fonction principale avec délai entre requêtes
 */
async function main() {
  console.log('🗺️  Téléchargement des tracés GeoJSON des lignes Twisto\n');
  console.log(`📁 Destination: ${OUTPUT_DIR}\n`);
  
  let successCount = 0;
  let failCount = 0;
  
  for (let i = 0; i < LINES.length; i++) {
    const lineRef = LINES[i];
    const result = await fetchLineGeoJSON(lineRef);
    
    if (result) {
      successCount++;
    } else {
      failCount++;
    }
    
    // Délai de 2 secondes entre chaque requête pour ne pas surcharger l'API
    if (i < LINES.length - 1) {
      console.log('⏳ Pause 2s...\n');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log(`✅ Téléchargement terminé !`);
  console.log(`   Succès: ${successCount}/${LINES.length}`);
  console.log(`   Échecs: ${failCount}/${LINES.length}`);
  console.log('='.repeat(60));
}

main().catch(console.error);
