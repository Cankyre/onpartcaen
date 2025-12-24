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
 * Helper function to map query results to objects for 'stops' table
 * New schema: id, name, lat, lon
 */
function mapStopRow(row) {
  return {
    id: row[0],
    name: row[1],
    lat: row[2],
    lon: row[3]
  };
}

/**
 * Helper function to map query results to objects for 'lines' table
 * New schema: ref, name, color_hex, network, geojson
 */
function mapLineRow(row) {
  return {
    ref: row[0],
    name: row[1],
    color_hex: row[2],
    network: row[3],
    geojson: JSON.parse(row[4]) // GeoJSON is stored as TEXT, parse it back to object
  };
}

/**
 * Get all stops from database
 * @returns {Array} Array of stop objects (id, name, lat, lon)
 */
export function getAllStops() {
  if (!db) return [];
  
  const results = db.exec("SELECT id, name, lat, lon FROM stops");
  if (!results.length) return [];
  
  return results[0].values.map(mapStopRow);
}

/**
 * Get all lines from database
 * @returns {Array} Array of line objects (ref, name, color_hex, network, geojson)
 */
export function getLines() {
  if (!db) return [];
  
  const results = db.exec("SELECT ref, name, color_hex, network, geojson FROM lines");
  if (!results.length) return [];
  
  return results[0].values.map(mapLineRow);
}

/**
 * Get lines filtered by active networks
 * @param {Array<string>} activeNetworks - Array of network names
 * @returns {Array} Filtered lines
 */
export function getActiveLines(activeNetworks) {
  if (!db) return [];
  const results = db.exec(`SELECT ref, name, color_hex, network, geojson FROM lines WHERE network IN (${activeNetworks.map(n => `'${n}'`).join(',')})`);
  if (!results.length) return [];
  return results[0].values.map(mapLineRow);
}

/**
 * Get stop by ID
 * @param {string} stopId - Stop ID (TEXT in new schema)
 * @returns {object|null} Stop object (id, name, lat, lon) or null
 */
export function getStopById(stopId) {
  if (!db) return null;
  
  const results = db.exec("SELECT id, name, lat, lon FROM stops WHERE id = ?", [stopId]);
  if (!results.length || !results[0].values.length) return null;
  
  return mapStopRow(results[0].values[0]);
}

/**
 * Get line by Ref
 * @param {string} lineRef - Line Ref (TEXT in new schema, which is the PK)
 * @returns {object|null} Line object or null
 */
export function getLineByRef(lineRef) {
  if (!db) return null;
  
  const results = db.exec("SELECT ref, name, color_hex, network, geojson FROM lines WHERE ref = ?", [lineRef]);
  if (!results.length || !results[0].values.length) return null;
  
  return mapLineRow(results[0].values[0]);
}


/**
 * Get all stops belonging to a specific line, in order.
 * @param {string} lineRef - The line reference (e.g., 'T1', 'Nomad 101')
 * @returns {Array} Array of stop objects (id, name, lat, lon)
 */
export function getStopsForLine(lineRef) {
  if (!db) return [];

  const results = db.exec(`
    SELECT
      s.id, s.name, s.lat, s.lon
    FROM
      line_stops ls
    JOIN
      stops s ON ls.stop_id = s.id
    WHERE
      ls.line_ref = ?
    ORDER BY
      ls.stop_sequence ASC
  `, [lineRef]);

  if (!results.length) return [];
  return results[0].values.map(mapStopRow);
}

/**
 * Get all lines serving a specific stop.
 * @param {string} stopId - The stop ID
 * @returns {Array} Array of line objects (ref, name, color_hex, network)
 */
export function getLinesForStop(stopId) {
  if (!db) return [];

  const results = db.exec(`
    SELECT DISTINCT
      l.ref, l.name, l.color_hex, l.network
    FROM
      line_stops ls
    JOIN
      lines l ON ls.line_ref = l.ref
    WHERE
      ls.stop_id = ?
  `, [stopId]);

  if (!results.length) return [];
  // Need a custom mapper for this query as it doesn't include geojson
  return results[0].values.map(row => ({
    ref: row[0],
    name: row[1],
    color_hex: row[2],
    network: row[3]
  }));
}