import { labFixEnabled } from "../../core/labSwitch.js";

// Lab experiment "traktStaleRead": the Trakt watched lists expire after 30 s and every
// reader then waited for a full refetch. On the TV that held the Details first render
// for about 1.4 s after its metadata was ready. Serving the expired list while the
// refetch runs keeps that wait off the screen. Writes invalidate the cache to null,
// so a user's own watched changes are never served stale.
export const TRAKT_WATCHED_STALE_MAX_AGE_MS = 10 * 60 * 1000;

export function staleTraktWatchedItems(cache, profileId, now = Date.now()) {
  if (!labFixEnabled("traktStaleRead")) {
    return null;
  }
  if (cache?.profileId !== profileId || !Array.isArray(cache.items)) {
    return null;
  }
  if (now - Number(cache.fetchedAt || 0) > TRAKT_WATCHED_STALE_MAX_AGE_MS) {
    return null;
  }
  return cache.items;
}
