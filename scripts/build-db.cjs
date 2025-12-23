const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const fetch = require('node-fetch');

const overpassQuery = `
[out:json][timeout:360];
area["name"="Communauté urbaine Caen la Mer"]["boundary"="local_authority"]->.caen;
(
  node(area.caen)["public_transport"="platform"];
  node(area.caen)["highway"="bus_stop"];
  node(area.caen)["railway"="tram_stop"];
)->.caen_stops;
relation(bn.caen_stops)["type"="route"]["route"~"bus|tram"]->.all_routes;
(
  node(r.all_routes)["public_transport"="platform"];
  node(r.all_routes)["highway"="bus_stop"];
  node(r.all_routes)["railway"="tram_stop"];
)->.all_stops;
(.all_routes; .all_stops;);
out body;
`;

const DB_PATH = path.join(__dirname, '..', 'public', 'stops.sqlite');
const OVERPASS_API_URL = 'https://overpass.kumi.systems/api/interpreter';

async function fetchOverpassData() {
  console.log('Fetching all routes and stops touching Caen...');
  const response = await fetch(OVERPASS_API_URL, {
    method: 'POST',
    body: `data=${encodeURIComponent(overpassQuery)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Overpass API request failed: ${response.statusText}. Body: ${errorText}`);
  }
  console.log('Data fetched successfully.');
  return response.json();
}

function getNetworkType(tags) {
    if (!tags || !tags.ref) return null;
    if (tags.ref.toUpperCase().startsWith('T')) return 'tram';
    return 'bus';
}

function processData(data) {
  console.log('Processing data...');
  
  const twistoRoutes = data.elements.filter(e => e.type === 'relation' && e.tags.network === 'Twisto');
  console.log(`Found ${twistoRoutes.length} Twisto route relations.`);

  const nodes = data.elements.filter(e => e.type === 'node');
  const stopsMap = new Map(nodes.map(node => [node.id, node]));
  
  const dbEntries = [];
  const stopGroupMap = new Map(); // Track stop groups (multi-quai stops)
  let stopGroupCounter = 1;

  // Multi-quai stops to group (customize based on actual data)
  const multiQuaiStops = {
    'Théâtre': 1,
    'Hôtel de Ville': 2,
    'place courtonne': 3
  };

  for (const rel of twistoRoutes) {
    const network = getNetworkType(rel.tags);
    if (!network || !rel.tags.ref) continue;

    for (const member of rel.members) {
      if (member.type === 'node' && (member.role === 'platform' || member.role.includes('stop') || member.role === '' )) {
        const stopNode = stopsMap.get(member.ref);
        if (stopNode && stopNode.tags && stopNode.tags.name) {
          
          const aliases = [
            stopNode.tags.alt_name,
            stopNode.tags.short_name,
            stopNode.tags.official_name,
            stopNode.tags.name.replace(/Quai \d+/, "") !== stopNode.tags.name ? stopNode.tags.name.replace(/Quai \d+/, "") : undefined
          ].filter(Boolean);

          const normalizedName = stopNode.tags.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          const stopGroup = multiQuaiStops[normalizedName] || null;

          dbEntries.push({
            name: stopNode.tags.name,
            aliases: aliases.join('|'),
            lat: stopNode.lat,
            lon: stopNode.lon,
            line: rel.tags.ref,
            line_ref: rel.tags.ref,
            network: network,
            operator: 'Twisto',
            stop_group: stopGroup
          });
        }
      }
    }
  }

  const uniqueEntries = Array.from(new Map(dbEntries.map(e => [`${e.name.toLowerCase()}-${e.line.toLowerCase()}`, e])).values());
  console.log(`Processing complete. Found ${uniqueEntries.length} unique stop-line entries for the Twisto network.`);
  
  // Grouper routes par ref pour GeoJSON
  const routesByRef = new Map();
  for (const route of twistoRoutes) {
    if (!route.tags || !route.tags.ref) continue;
    const ref = route.tags.ref;
    if (!routesByRef.has(ref)) {
      routesByRef.set(ref, []);
    }
    routesByRef.get(ref).push(route);
  }
  
  return { stops: uniqueEntries, routes: Array.from(routesByRef.entries()) };
}

function createDatabase(data) {
  console.log('Creating final database with stops and lines tables...');
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
  }

  const db = new sqlite3.Database(DB_PATH);

  db.serialize(() => {
    // Create stops table with stop_group field
    db.run(`CREATE TABLE stops (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      aliases TEXT,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      line TEXT NOT NULL,
      line_ref TEXT NOT NULL,
      network TEXT NOT NULL,
      operator TEXT NOT NULL,
      stop_group INTEGER
    )`);

    // Create lines table
    db.run(`CREATE TABLE lines (
      id INTEGER PRIMARY KEY,
      ref TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      color_hex TEXT NOT NULL,
      network TEXT NOT NULL,
      geojson TEXT
    )`);

    // Insert stops
    const stopStmt = db.prepare(`INSERT INTO stops (name, aliases, lat, lon, line, line_ref, network, operator, stop_group) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    db.run('BEGIN TRANSACTION');
    for (const entry of data.stops) {
      if (parseInt(entry.line.slice(0, 3)) >= 100) continue;
      stopStmt.run(entry.name, entry.aliases, entry.lat, entry.lon, entry.line, entry.line_ref, entry.network, entry.operator, entry.stop_group);
    }
    db.run('COMMIT');
    stopStmt.finalize();

    // Insert lines with official colors (extracted from PNG icons)
    const lineColors = {
      'T1': '#23A638',
      'T2': '#E73132',
      'T3': '#009ADF',
      '1': '#D8005B',
      '2': '#0975B8',
      '3': '#C4CE10',
      '4': '#DA609F',
      '5': '#642580',
      '6A': '#FCDD19',
      '6B': '#FCDD19',
      '7': '#8E5F2C',
      '8': '#00804B',
      '9': '#86BCE7',
      '10': '#B0368C',
      '10 EXPRESS': '#F29FC5',
      '11': '#EA5B0C',
      '11 EXPRESS': '#F39768',
      '12': '#009D99',
      '20': '#F59C00',
      '21': '#153F8D',
      '22': '#F3A3B9',
      '23': '#E94861',
      '30': '#D186B2',
      '31': '#969328',
      '32': '#82C491',
      '34': '#7F2110',
      '40': '#7D6FA5',
      '42': '#7C6FA6',
      '100': '#702283',
      '101': '#702283',
      '102': '#702283',
      '103': '#702283',
      '104': '#702283',
      '107': '#702283',
      '109': '#702283',
      '110': '#702283',
      '111': '#702283',
      '112': '#702283',
      '113': '#702283',
      '114': '#702283',
      '115': '#702283',
      '116': '#702283',
      '118': '#702283',
      '119': '#702283',
      '120': '#702283',
      '121': '#702283',
      '122': '#702283',
      '123': '#702283',
      '124': '#702283',
      '125': '#702283',
      '126': '#702283',
      '127': '#702283',
      '128': '#702283',
      '130': '#702283',
      '131': '#702283',
      '133': '#702283',
      '134': '#702283',
      '135': '#702283',
      '136': '#702283',
      '137': '#702283',
      '138': '#702283',
      'NAVETTE CAEN': '#E84133',
      'NOCTIBUS': '#011337'
    };

    const linesSet = new Map();
    for (const [_, route] of data.routes) {
      if (!route[0].tags || !route[0].tags.ref) continue;
      if (parseInt(_) >= 100) continue;
      const ref = route[0].tags.ref;
      const network = getNetworkType(route[0].tags);
      const betterName = route[0].tags.name.replace(/→.*→|→/, '-')
      linesSet.set(ref, {
        ref,
        name: betterName || `Ligne ${ref}`,
        color_hex: lineColors[ref] || '#333333',
        network: network || 'bus'
      });
    }

    const lineStmt = db.prepare(`INSERT INTO lines (ref, name, color_hex, network, geojson) VALUES (?, ?, ?, ?, ?)`);
    db.run('BEGIN TRANSACTION');
    for (const [ref, lineData] of linesSet) {
      lineStmt.run(lineData.ref, lineData.name, lineData.color_hex, lineData.network, null);
    }
    db.run('COMMIT');
    lineStmt.finalize();
  });

  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Database created successfully at public/stops.sqlite');
  });
}

async function main() {
  try {
    const data = await fetchOverpassData();
    const processedData = processData(data);
    createDatabase(processedData);
  } catch (error) {
    console.error('An error occurred:', error);
  }
}

main();
