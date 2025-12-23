import initSqlJs from 'sql.js';

let db = null;
let dbPromise = null;

export async function loadDb() {
  if (dbPromise) return dbPromise;
  if (db) return db;

  dbPromise = (async () => {
    const SQL = await initSqlJs({
      locateFile: file => file
    });

    const dbBytes = await fetch('/stops.sqlite').then(res => res.arrayBuffer());
    db = new SQL.Database(new Uint8Array(dbBytes));
    
    return db;
  })();

  try {
    return await dbPromise;
  } finally {
    dbPromise = null; // Reset promise after completion
  }
}

/**
 * Get all stops from database
 * @returns {Array} Array of stop objects
 */
export function getAllStops() {
  if (!db) return [];
  
  const results = db.exec("SELECT * FROM stops");
  if (!results.length) return [];
  
  return results[0].values.map(row => ({
    id: row[0],
    name: row[1],
    aliases: row[2] ? row[2].split('|') : [],
    lat: row[3],
    lon: row[4],
    line: row[5],
    line_ref: row[6],
    network: row[7],
    operator: row[8],
    stop_group: row[9]
  }));
}

/**
 * Get stops filtered by active networks
 * @param {Array<string>} activeNetworks - Array of network names
 * @returns {Array} Filtered stops
 */
export function getActiveStops(activeNetworks) {
  const allStops = getAllStops();
  return allStops.filter(s => activeNetworks.includes(s.network));
}

/**
 * Get all stops belonging to a stop_group
 * @param {number} groupId - The stop_group ID
 * @returns {Array} Array of stops in the group
 */
export function getStopsByGroup(groupId) {
  if (!db || !groupId) return [];
  
  const results = db.exec("SELECT * FROM stops WHERE stop_group = ?", [groupId]);
  if (!results.length) return [];
  return results[0].values.map(row => ({
    id: row[0],
    name: row[1],
    aliases: row[2] ? row[2].split('|') : [],
    lat: row[3],
    lon: row[4],
    line: row[5],
    line_ref: row[6],
    network: row[7],
    operator: row[8],
    stop_group: row[9]
  }));
}

/**
 * Get all lines from database
 * @returns {Array} Array of line objects
 */
export function getLines() {
  if (!db) return [];
  
  const results = db.exec("SELECT * FROM lines");
  if (!results.length) return [];
  
  return results[0].values.map(row => ({
    id: row[0],
    ref: row[1],
    name: row[2],
    color_hex: row[3],
    network: row[4],
    geojson: row[5]
  }));
}

/**
 * Get lines filtered by active networks
 * @param {Array<string>} activeNetworks - Array of network names
 * @returns {Array} Filtered lines
 */
export function getActiveLines(activeNetworks) {
  const allLines = getLines();
  return allLines.filter(l => activeNetworks.includes(l.network));
}

/**
 * Get stop by ID
 * @param {number} stopId - Stop ID
 * @returns {object|null} Stop object or null
 */
export function getStopById(stopId) {
  if (!db) return null;
  
  const results = db.exec("SELECT * FROM stops WHERE id = ?", [stopId]);
  if (!results.length || !results[0].values.length) return null;
  
  const row = results[0].values[0];
  return {
    id: row[0],
    name: row[1],
    aliases: row[2] ? row[2].split('|') : [],
    lat: row[3],
    lon: row[4],
    line: row[5],
    line_ref: row[6],
    network: row[7],
    operator: row[8],
    stop_group: row[9]
  };
}

