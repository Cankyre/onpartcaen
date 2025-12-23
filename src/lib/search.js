/**
 * Normalizes a string by converting it to lower case, removing diacritics,
 * removing hyphens, reducing multiple spaces, and removing Caen city names.
 * @param {string} str - The input string.
 * @returns {string} - The normalized string.
 */
export function normalizeString(str) {
  if (!str) return '';
  
  const cityNames = ['caen', 'herouville', 'herouville saint clair', 'mondeville', 'ifs', 'fleury sur orne', 'cormelles le royal'];
  
  let normalized = str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/-/g, ' ') // Replace hyphens with spaces
    .replace(/\s+/g, ' ') // Reduce multiple spaces
    .trim();
  
  // Remove city names
  for (const city of cityNames) {
    normalized = normalized.replace(new RegExp(`\\b${city}\\b`, 'g'), '').trim();
  }
  
  return normalized.replace(/\s+/g, ' ').trim();
}

/**
 * Match input against stops with perfect and fuzzy matching, including stop_group support
 * @param {string} guess - User input
 * @param {Array} availableStops - Stops to search through
 * @param {Function} levenshteinFn - Levenshtein distance function
 * @returns {Array} Array of matched stop IDs
 */
export function matchStops(guess, availableStops, levenshteinFn) {
  const normalizedGuess = normalizeString(guess);
  const matchedStopIds = new Set();
  
  // Pass 1: Perfect match on name or aliases
  const perfectMatches = availableStops.filter(s => {
    const nameMatch = normalizeString(s.name) === normalizedGuess;
    const aliasMatch = s.aliases.some(alias => normalizeString(alias) === normalizedGuess);
    return nameMatch || aliasMatch;
  });
  
  if (perfectMatches.length > 0) {
    // Add all perfect matches
    for (const stop of perfectMatches) {
      matchedStopIds.add(stop.id);
      
      // If this stop has a stop_group, add all stops in that group
      if (stop.stop_group) {
        const groupStops = availableStops.filter(s => s.stop_group === stop.stop_group);
        groupStops.forEach(gs => matchedStopIds.add(gs.id));
      }
    }
    
    return Array.from(matchedStopIds);
  }
  
  // Pass 2: Fuzzy match via Levenshtein
  const candidates = [];
  
  for (const stop of availableStops) {
    const allNames = [stop.name, ...stop.aliases];
    for (const name of allNames) {
      const normalizedName = normalizeString(name);
      const dist = levenshteinFn(normalizedGuess, normalizedName);
      const threshold = normalizedName.length > 8 ? 2 : 1;
      
      if (dist <= threshold) {
        candidates.push({ stop, distance: dist });
        break;
      }
    }
  }
  
  // Refuse if too many ambiguous candidates
  if (candidates.length > 5) {
    return [];
  }
  
  if (candidates.length > 0) {
    // Add all fuzzy matches and their groups
    for (const { stop } of candidates) {
      matchedStopIds.add(stop.id);
      
      if (stop.stop_group) {
        const groupStops = availableStops.filter(s => s.stop_group === stop.stop_group);
        groupStops.forEach(gs => matchedStopIds.add(gs.id));
      }
    }
  }
  
  return Array.from(matchedStopIds);
}

