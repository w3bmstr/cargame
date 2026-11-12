const PREFIX = 'cd3_';

export function readNumber(key, fallback = 0) {
  try {
    const value = Number.parseFloat(localStorage.getItem(PREFIX + key) || '');
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writeNumber(key, value) {
  try {
    localStorage.setItem(PREFIX + key, String(value));
  } catch {
    // Storage can be unavailable in private or embedded browser contexts.
  }
}
