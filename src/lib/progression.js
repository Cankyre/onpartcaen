import { getStopsForLine } from './db.js';

export const PHASES = {
  TRAM: {
    networks: ['tram'],
    unlocks: 'BUS',
    threshold: 0.5, // 50% of tram stops
  },
  BUS: {
    networks: ['tram', 'bus'],
  },
};

/**
 * Determines the current active networks based on player progression.
 * @param {Array<string>} foundStopIds - Array of found stop IDs.
 * @param {Array<object>} allLines - All lines from the database.
 * @returns {Array<string>} - A list of active network names.
 */
export function getActiveNetworks(foundStopIds, allLines) {
  const tramLines = allLines.filter(l => l.network === 'tram');
  
  if (tramLines.length === 0) {
    return PHASES.BUS.networks; // If no tram lines, unlock everything by default
  }
  
  const tramStopIds = new Set();
  tramLines.forEach(line => {
    const stopsForLine = getStopsForLine(line.ref);
    stopsForLine.forEach(s => tramStopIds.add(s.id));
  });

  if (tramStopIds.size === 0) {
    return PHASES.BUS.networks;
  }
  
  const foundTramCount = foundStopIds.filter(id => tramStopIds.has(id)).length;

  // Check for Bus unlock condition (50% of tram)
  if (foundTramCount / tramStopIds.size >= PHASES.TRAM.threshold) {
    return PHASES.BUS.networks;
  }

  // Default is Tram only
  return PHASES.TRAM.networks;
}
