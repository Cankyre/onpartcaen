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
 * @param {Array<number>} foundStopIds - Array of found stop IDs.
 * @param {Array<object>} allStops - All stops from the database.
 * @returns {Array<string>} - A list of active network names.
 */
export function getActiveNetworks(foundStopIds, allStops) {
  const tramStops = allStops.filter(s => s.network === 'tram');
  
  if (tramStops.length === 0) {
    return PHASES.BUS.networks;
  }
  
  const foundTramStopIds = new Set(foundStopIds);
  const foundTramCount = tramStops.filter(s => foundTramStopIds.has(s.id)).length;

  // Check for Bus unlock condition (50% of tram)
  if (foundTramCount / tramStops.length >= PHASES.TRAM.threshold) {
    return PHASES.BUS.networks;
  }

  // Default is Tram only
  return PHASES.TRAM.networks;
}

