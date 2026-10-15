// node lab/checks/identity-prefix-pattern.test.mjs
// Lab switch "identityPrefixPattern": watchedItemIdentityValues built a new RegExp for the tmdb and trakt
// prefixes on every call. On Back, watched getAll rebuilds the identity keys of every Trakt watched episode,
// and the RegExp construction was ~120 ms self time of a ~300 ms rebuild on the TV (MEASURED, CPU profile
// after Back). Reusing two patterns must give exactly the same identities. Also prints a SYNTHETIC timing.
import assert from "node:assert/strict";
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};
const url = new URL("../../js/data/repository/watchedIdentity.js", import.meta.url).href;
const on = await import(`${url}?on`);
localStorage.setItem("nuvioLabOff", "identityPrefixPattern");
const off = await import(`${url}?off`);
localStorage.removeItem("nuvioLabOff");
assert.equal(on.identityPrefixPatternEnabled, true);
assert.equal(off.identityPrefixPatternEnabled, false);

const samples = [
  {},
  { contentId: "tt0111161", tmdbId: 278, traktId: "481" },
  { id: "tmdb:278", tmdb_id: "TMDB:278", trakt_id: "trakt:481" },
  { ids: { imdb: "tt1", tmdb: " tmdb:9 ", trakt: "Trakt:7", slug: "a-show" } },
  { external_ids: { tmdb: "tmdb:tmdb:5" }, imdbId: "imdb:tt2" },
  { tmdbId: "  ", traktId: null, slug: "Mixed-Case" },
  { tmdbId: "tmdbx:3", traktId: "TRAKT:" }
];
for (const item of samples) {
  assert.deepEqual([...on.watchedItemIdentityValues(item)], [...off.watchedItemIdentityValues(item)], JSON.stringify(item));
}
// Repeated calls reuse the pattern without carrying state between calls.
assert.deepEqual([...on.watchedItemIdentityValues(samples[2])], [...on.watchedItemIdentityValues(samples[2])]);

const many = Array.from({ length: 6000 }, (_, i) => ({ contentId: `tt${i}`, ids: { tmdb: i, trakt: `trakt:${i}`, imdb: `tt${i}` }, season: 1, episode: i }));
const time = (fn) => { const t = performance.now(); many.forEach(fn); return Math.round(performance.now() - t); };
time(off.watchedItemIdentityValues); time(on.watchedItemIdentityValues);
console.log(`SYNTHETIC node, 6000 items: off ${time(off.watchedItemIdentityValues)} ms, on ${time(on.watchedItemIdentityValues)} ms`);
console.log("identity prefix pattern: 8 cases passed");
