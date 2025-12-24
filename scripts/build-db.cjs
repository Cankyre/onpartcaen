const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const fetch = require('node-fetch');
const AdmZip = require('adm-zip');
const { parse } = require('csv-parse/sync');
const { fetchLineGeoJSON } = require('./fetch-geojson.cjs');

// --- CONFIGURATION ---
const USE_OSM_GEOJSON_FOR = ['T1', 'T2', 'T3', '1', '2', '3', '4', '5', '6A', '6B', '7', '8', '9', '10', '10 EXPRESS', '11', '11 EXPRESS', '12', '20', '21', '22', '23', '30', '31', '32', '34', 'NOCTIBUS', 'NAVETTE CAEN'];
const GTFS_URL = 'https://data.twisto.fr/api/v2/catalog/datasets/fichier-gtfs-du-reseau-twisto/alternative_exports/gtfs_twisto_zip';
const DB_PATH = path.join(__dirname, '..', 'public', 'stops.sqlite');
const TEMP_GTFS_DIR = path.join(__dirname, 'gtfs_temp');
// --- END CONFIGURATION ---

async function downloadAndUnzipGTFS() {
    console.log(`Downloading GTFS data from ${GTFS_URL}...`);
    const response = await fetch(GTFS_URL);
    if (!response.ok) throw new Error(`Failed to download GTFS data: ${response.statusText}`);
    const buffer = await response.buffer();

    console.log('Unzipping GTFS data...');
    if (fs.existsSync(TEMP_GTFS_DIR)) {
        fs.rmSync(TEMP_GTFS_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEMP_GTFS_DIR);

    const zip = new AdmZip(buffer);
    zip.extractAllTo(TEMP_GTFS_DIR, true);
    console.log(`GTFS data extracted to ${TEMP_GTFS_DIR}`);
}

function readGtfsFile(filename) {
    const filePath = path.join(TEMP_GTFS_DIR, filename);
    if (!fs.existsSync(filePath)) throw new Error(`GTFS file not found: ${filename}`);
    const content = fs.readFileSync(filePath);
    return parse(content, { columns: true, skip_empty_lines: true });
}

function normalizeRef(ref) {
    ref = ref.replace("NVCV", "NAVETTE CAEN").replace("NUIT", "NOCTIBUS")
    if (['137A', '137B', '138C', '138D'].includes(ref)) return null;
    if (ref === '6A' || ref === '6B') return '6';
    const nomadMergeMatch = ref.match(/^(Nomad\s+\d+)[A-Z]?$/i);
    if (nomadMergeMatch) return nomadMergeMatch[1];
    const suffixMatch = ref.match(/^(\d+)[A-Z]$/);
    if (suffixMatch && ref.length > 1 && !ref.startsWith('T')) return suffixMatch[1];
    return ref;
}

async function processData() {
    console.log('Reading GTFS files...');
    const routes = readGtfsFile('routes.txt');
    const stops = readGtfsFile('stops.txt');
    const trips = readGtfsFile('trips.txt');
    const stopTimes = readGtfsFile('stop_times.txt');
    const shapes = readGtfsFile('shapes.txt');
    const calendar = readGtfsFile('calendar.txt');

    const osmGeoJsonMap = new Map();
    if (USE_OSM_GEOJSON_FOR.length > 0) {
        console.log(`--- Fetching ${USE_OSM_GEOJSON_FOR.length} GeoJSON(s) from OSM ---`);
        for (const lineRef of USE_OSM_GEOJSON_FOR) {
            const geojson = await fetchLineGeoJSON(lineRef);
            if (geojson) osmGeoJsonMap.set(lineRef, geojson);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        console.log('--- OSM GeoJSON Fetch Complete ---');
    }

    console.log('Filtering out weekend-only trips...');
    const weekendOnlyServiceIds = new Set(
        calendar.filter(c => c.monday === '0' && c.tuesday === '0' && c.wednesday === '0' && c.thursday === '0' && c.friday === '0').map(c => c.service_id)
    );
    const tripsForProcessing = trips.filter(t => !weekendOnlyServiceIds.has(t.service_id));

    console.log('Processing all lines and stops...');
    const linesMap = new Map();
    for (const route of routes) {
        const ref = normalizeRef(route.route_short_name);
        if (!ref) continue;

        let shouldInclude = false;
        let networkType = 'bus';
        if (ref.startsWith('T') && route.route_type === '0') {
            shouldInclude = true;
            networkType = 'tram';
        }
        const numericRef = parseInt(ref.replace('Nomad ', ''), 10);
        if (!isNaN(numericRef)) {
            if ((numericRef >= 1 && numericRef <= 42) || (numericRef >= 100 && numericRef <= 138)) {
                shouldInclude = true;
            }
        } else if (ref === 'NOCTIBUS' || ref === 'NAVETTE CAEN') {
            shouldInclude = true;
        }
        // Exclude Nomad lines for now (distorted traces)
        if (ref.startsWith('Nomad')) {
            shouldInclude = false;
        }
        if (!shouldInclude) continue;

        if (!linesMap.has(ref)) {
            linesMap.set(ref, {
                ref,
                name: `Ligne ${ref}`,
                network: networkType,
                color_hex: `#${route.route_color}` || '#333333',
                route_ids: new Set()
            });
        }
        linesMap.get(ref).route_ids.add(route.route_id);
    }
    
    const shapesByShapeId = shapes.reduce((acc, shape) => {
        if (!acc[shape.shape_id]) acc[shape.shape_id] = [];
        acc[shape.shape_id].push({ lat: parseFloat(shape.shape_pt_lat), lon: parseFloat(shape.shape_pt_lon), seq: parseInt(shape.shape_pt_sequence, 10) });
        return acc;
    }, {});
    
    const tripsByRouteId = tripsForProcessing.reduce((acc, trip) => {
        if (!acc[trip.route_id]) acc[trip.route_id] = [];
        acc[trip.route_id].push(trip);
        return acc;
    }, {});

    const stopTimesByTripId = stopTimes.reduce((acc, st) => {
        if (!acc[st.trip_id]) acc[st.trip_id] = [];
        acc[st.trip_id].push(st);
        return acc;
    }, {});

    for (const line of linesMap.values()) {
        if (osmGeoJsonMap.has(line.ref)) {
            line.geojson = JSON.stringify(osmGeoJsonMap.get(line.ref));
            continue;
        }

        const shapeIds = new Set();
        for (const routeId of line.route_ids) {
            (tripsByRouteId[routeId] || []).forEach(trip => {
                if (trip.shape_id) shapeIds.add(trip.shape_id);
            });
        }

        const uniqueLineStrings = new Set();
        for (const shapeId of shapeIds) {
            const points = shapesByShapeId[shapeId];
            if (points && points.length > 1) {
                points.sort((a, b) => a.seq - b.seq);
                const lineString = points.map(p => [p.lon, p.lat]);
                uniqueLineStrings.add(JSON.stringify(lineString));
            }
        }
        
        line.geojson = JSON.stringify({ type: 'MultiLineString', coordinates: Array.from(uniqueLineStrings).map(s => JSON.parse(s)) });
    }

    const lineStops = [];
    for (const line of linesMap.values()) {
        let longestTripStops = [];
        for (const routeId of line.route_ids) {
            for (const trip of (tripsByRouteId[routeId] || [])) {
                const stopsForTrip = stopTimesByTripId[trip.trip_id] || [];
                if (stopsForTrip.length > longestTripStops.length) {
                    longestTripStops = stopsForTrip;
                }
            }
        }
        longestTripStops.sort((a, b) => parseInt(a.stop_sequence, 10) - parseInt(b.stop_sequence, 10));
        longestTripStops.forEach(st => {
            lineStops.push({
                line_ref: line.ref,
                stop_id: st.stop_id,
                stop_sequence: parseInt(st.stop_sequence, 10)
            });
        });
    }

    return {
        stops: stops.map(s => ({ id: s.stop_id, name: s.stop_name, lat: s.stop_lat, lon: s.stop_lon })),
        lines: Array.from(linesMap.values()),
        lineStops
    };
}

function createDatabase({ stops, lines, lineStops }) {
    console.log('Creating database...');
    if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

    const db = new sqlite3.Database(DB_PATH);

    db.serialize(() => {
        db.run(`CREATE TABLE stops (id TEXT PRIMARY KEY, name TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL)`);
        const stopStmt = db.prepare(`INSERT INTO stops (id, name, lat, lon) VALUES (?, ?, ?, ?)`);
        stops.forEach(s => stopStmt.run(s.id, s.name, s.lat, s.lon));
        stopStmt.finalize();
        console.log(`Inserted ${stops.length} stops.`);

        db.run(`CREATE TABLE lines (ref TEXT PRIMARY KEY, name TEXT NOT NULL, color_hex TEXT NOT NULL, network TEXT NOT NULL, geojson TEXT)`);
        const lineStmt = db.prepare(`INSERT INTO lines (ref, name, color_hex, network, geojson) VALUES (?, ?, ?, ?, ?)`);
        lines.forEach(l => lineStmt.run(l.ref, l.name, l.color_hex, l.network, l.geojson));
        lineStmt.finalize();
        console.log(`Inserted ${lines.length} lines.`);

        db.run(`CREATE TABLE line_stops (line_ref TEXT NOT NULL, stop_id TEXT NOT NULL, stop_sequence INTEGER NOT NULL, PRIMARY KEY (line_ref, stop_sequence))`);
        const seqStmt = db.prepare(`INSERT OR IGNORE INTO line_stops (line_ref, stop_id, stop_sequence) VALUES (?, ?, ?)`);
        lineStops.forEach(ls => seqStmt.run(ls.line_ref, ls.stop_id, ls.stop_sequence));
        seqStmt.finalize();
        console.log(`Inserted stop sequences.`);
    });

    db.close(err => {
        if (err) return console.error('Error closing database:', err.message);
        console.log(`Database created successfully at ${DB_PATH}`);
    });
}

async function main() {
    try {
        await downloadAndUnzipGTFS();
        const data = await processData();
        createDatabase(data);
    } catch (error) {
        console.error('An error occurred:', error);
    } finally {
        if (fs.existsSync(TEMP_GTFS_DIR)) {
            fs.rmSync(TEMP_GTFS_DIR, { recursive: true, force: true });
            console.log('Cleaned up temporary GTFS directory.');
        }
    }
}

main();