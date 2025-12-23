const PREFIX = 'memorypourcaen_';

export function getStoredData(key) {
  try {
    const data = localStorage.getItem(PREFIX + key);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    console.error(`Failed to retrieve data for key ${key}`, e);
    return null;
  }
}

export function storeData(key, data) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(data));
  } catch (e) {
    console.error(`Failed to store data for key ${key}`, e);
  }
}

/**
 * Clear all stored data
 */
export function clearAllData() {
  try {
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith(PREFIX)) {
        localStorage.removeItem(key);
      }
    });
  } catch (e) {
    console.error('Failed to clear data', e);
  }
}

/**
 * Export found stops as JSON for debugging
 * @param {Array<number>} foundStopIds - Array of found stop IDs
 * @returns {string} JSON string
 */
export function exportFoundStops(foundStopIds) {
  return JSON.stringify(foundStopIds, null, 2);
}

