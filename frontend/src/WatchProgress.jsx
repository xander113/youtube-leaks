const maxClips = 24;
const storagePrefix = 'ytl:progress:';

export function progressKey(accountId) {
  return storagePrefix + (accountId ?? 'guest');
}

export function readProgress(key) {
  try {
    const entries = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(entries) ? entries.filter(entry =>
      typeof entry?.id === 'string' && Number.isFinite(entry.time) && entry.time >= 1 &&
      Number.isFinite(entry.duration) && entry.duration > entry.time
    ).slice(0, maxClips) : [];
  } catch {
    return [];
  }
}

export function saveProgress(key, id, time, duration) {
  if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) return;
  const entries = readProgress(key);
  const remaining = entries.filter(entry => entry.id !== id);
  const finished = time >= duration - Math.min(5, duration * 0.06);
  if (time >= 1 && !finished) remaining.unshift({ id, time, duration });
  else if (entries.length === remaining.length) return;
  try {
    localStorage.setItem(key, JSON.stringify(remaining.slice(0, maxClips)));
  } catch {
    // Playback also works when browser storage is disabled.
  }
}
