import { getStopsForLine } from './db.js';

export const PHASES = {
  TRAM: {
    networks: ['tram'],
    lineCategories: ['tram'],
    unlocks: 'REGULAR_BUS',
    threshold: 0.5, // 50% of tram stops
  },
  REGULAR_BUS: {
    networks: ['tram', 'bus'],
    lineCategories: ['tram', 'regular'],
    unlocks: 'COMPLEMENTARY',
    threshold: 0.33, // 33% of regular network (tram + regular bus 1-42)
  },
  COMPLEMENTARY: {
    networks: ['tram', 'bus'],
    lineCategories: ['tram', 'regular', 'complementary'],
  },
};

/**
 * Determines line category based on ref
 * Regular: 1-42, NAVETTE CAEN, NOCTIBUS
 * Complementary: 100+
 */
export function getLineCategory(ref) {
  if (typeof ref !== 'string') return 'complementary';
  if (ref.startsWith('T')) return 'tram';
  if (ref === 'NAVETTE CAEN' || ref === 'NOCTIBUS') return 'regular';
  const num = parseInt(ref, 10);
  if (!isNaN(num)) {
    if (num >= 1 && num <= 42) return 'regular';
    if (num >= 100) return 'complementary';
  }
  return 'complementary';
}

/**
 * Check if a line should be visible in the current phase
 */
export function isLineInCurrentPhase(lineRef, activeNetworks) {
  const category = getLineCategory(lineRef);
  
  // Determine current phase based on activeNetworks
  if (activeNetworks.length === 1 && activeNetworks.includes('tram')) {
    // Phase 1: Only tram
    return category === 'tram';
  } else if (activeNetworks.includes('bus') && activeNetworks.includes('tram')) {
    // Phase 2 or 3 - need to check which lines are allowed
    // We need to know if we're in phase 2 or 3
    // Phase 2: tram + regular only
    // Phase 3: all categories
    
    // For now, return based on PHASES.REGULAR_BUS categories as default
    // This will be overridden by checking actual phase
    return true; // Will be refined in getActiveLines
  }
  return false;
}

/**
 * Get the current phase name based on active networks and progression
 */
export function getCurrentPhase(foundStopIds, allLines) {
  const foundSet = new Set(foundStopIds);
  
  // Phase 1: Tram lines only
  const tramLines = allLines.filter(l => getLineCategory(l.ref) === 'tram');
  const tramStopIds = new Set();
  tramLines.forEach(line => {
    getStopsForLine(line.ref).forEach(s => tramStopIds.add(s.id));
  });
  
  const foundTramCount = Array.from(tramStopIds).filter(id => foundSet.has(id)).length;
  const tramProgress = tramStopIds.size > 0 ? foundTramCount / tramStopIds.size : 0;
  
  if (tramProgress < PHASES.TRAM.threshold) {
    return 'TRAM';
  }
  
  // Phase 2: Tram + Regular bus lines
  const regularLines = allLines.filter(l => {
    const cat = getLineCategory(l.ref);
    return cat === 'tram' || cat === 'regular';
  });
  const regularStopIds = new Set();
  regularLines.forEach(line => {
    getStopsForLine(line.ref).forEach(s => regularStopIds.add(s.id));
  });
  
  const foundRegularCount = Array.from(regularStopIds).filter(id => foundSet.has(id)).length;
  const regularProgress = regularStopIds.size > 0 ? foundRegularCount / regularStopIds.size : 0;
  
  if (regularProgress < PHASES.REGULAR_BUS.threshold) {
    return 'REGULAR_BUS';
  }
  
  return 'COMPLEMENTARY';
}

/**
 * Get list of line categories allowed in current phase
 */
export function getActiveLineCategories(foundStopIds, allLines) {
  const phase = getCurrentPhase(foundStopIds, allLines);
  return PHASES[phase].lineCategories;
}

/**
 * Determines the current active networks based on player progression.
 * @param {Array<string>} foundStopIds - Array of found stop IDs.
 * @param {Array<object>} allLines - All lines from the database.
 * @returns {Array<string>} - A list of active network names.
 */
export function getActiveNetworks(foundStopIds, allLines) {
  const phase = getCurrentPhase(foundStopIds, allLines);
  return PHASES[phase].networks;
}
