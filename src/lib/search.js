/**
 * Normalizes a string by converting it to lower case, removing diacritics,
 * removing hyphens, reducing multiple spaces, and removing Caen city names.
 * @param {string} str - The input string.
 * @returns {string} - The normalized string.
 */
export function normalizeString(str) {
  if (!str) return '';
  
  let normalized = str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/-/g, ' ') // Replace hyphens with spaces
    .replace(/\s+/g, ' ') // Reduce multiple spaces
    .trim();
  
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
  
  // Pass 1: Perfect match on name
  const perfectMatches = availableStops.filter(s => {
    return normalizeString(s.name) === normalizedGuess;
  });
  
  if (perfectMatches.length > 0) {
    perfectMatches.forEach(stop => matchedStopIds.add(stop.id));
    return Array.from(matchedStopIds);
  }
  
  // Pass 2: Fuzzy match via Levenshtein
  const candidates = [];
  
  for (const stop of availableStops) {
    const normalizedName = normalizeString(stop.name);
    const dist = levenshteinFn(normalizedGuess, normalizedName);
    const threshold = normalizedName.length > 8 ? 2 : 1; // Levenshtein threshold
    
    if (dist <= threshold) {
      candidates.push({ stop, distance: dist });
    }
  }
  
  // Refuse if too many ambiguous candidates
  if (candidates.length > 5) {
    return [];
  }
  
  if (candidates.length > 0) {
    candidates.forEach(({ stop }) => matchedStopIds.add(stop.id));
  }
  
  return Array.from(matchedStopIds);
}

