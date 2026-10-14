// node lab/checks/trakt-stale-read.test.mjs
// Lab switch "traktStaleRead": the Trakt watched movie/show lists are cached for 30 s, then every reader waits for a
// full refetch. On the TV, Details first render waited 2.47 s for that refetch while its metadata was ready at
// 1.09 s (MEASURED, logpoints on the loadDetail Promise.all). Serve the expired list while the refresh runs.
import assert from "node:assert/strict";
import fs from "node:fs";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};

const { staleTraktWatchedItems, TRAKT_WATCHED_STALE_MAX_AGE_MS } = await import("../../js/data/repository/traktWatchedStaleRead.js");

const now = 1_000_000_000;
const items = [{ contentId: "tt1" }];
const cache = (ageMs, profileId = "p1") => ({ profileId, fetchedAt: now - ageMs, items });

// Expired but recent list for the same profile: served.
assert.equal(staleTraktWatchedItems(cache(60_000), "p1", now), items);
// Other profile, no cache, invalidated cache, or too old: not served (caller waits for the refetch).
assert.equal(staleTraktWatchedItems(cache(60_000, "p2"), "p1", now), null);
assert.equal(staleTraktWatchedItems(null, "p1", now), null);
assert.equal(staleTraktWatchedItems({ profileId: "p1", fetchedAt: now, items: null }, "p1", now), null);
assert.equal(staleTraktWatchedItems(cache(TRAKT_WATCHED_STALE_MAX_AGE_MS + 1), "p1", now), null);

// Switch off restores the old behavior: never serve stale.
localStorage.setItem("nuvioLabOff", "traktStaleRead");
assert.equal(staleTraktWatchedItems(cache(60_000), "p1", now), null);
localStorage.removeItem("nuvioLabOff");

// Wiring: both readers start the refetch first (so it is in flight and deduplicated), then return the stale list.
const repo = fs.readFileSync(new URL("../../js/data/repository/watchedItemsRepository.js", import.meta.url), "utf8");
for (const kind of ["Movies", "Shows"]) {
  assert.match(
    repo,
    new RegExp(
      `traktWatched${kind}InFlight = \\{ profileId, promise \\};\\s*` +
        `return staleTraktWatchedItems\\(traktWatched${kind}Cache, profileId, now\\) \\|\\| promise;`
    ),
    `${kind} reader wiring`
  );
  assert.match(
    repo,
    new RegExp(
      `if \\(traktWatched${kind}InFlight\\?\\.profileId === profileId\\) \\{\\s*` +
        `return staleTraktWatchedItems\\(traktWatched${kind}Cache, profileId, now\\) \\|\\| traktWatched${kind}InFlight\\.promise;`
    ),
    `${kind} in-flight wiring`
  );
}

console.log("trakt stale read: 7 cases passed");
