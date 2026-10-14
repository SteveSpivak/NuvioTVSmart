// node lab/checks/watched-identity-index.test.mjs
// The identity index (lab fix "identityIndex") must give exactly the same answers as the pairwise
// watchedItemsShareIdentity checks it replaces, on Home (getTitleWatchedItems) and in details
// (buildEpisodeState). Also prints a SYNTHETIC timing for the Home filter.
import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  key: (i) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  }
};
globalThis.window = globalThis;

const { watchedIdentityIndex, watchedItemHasIdentityIn, watchedItemsShareIdentity } =
  await import("../../js/data/repository/watchedIdentity.js");

let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log("PASS", name);
  } catch (e) {
    failed++;
    console.log("FAIL", name, e.message);
  }
}

// Deterministic pseudo-random items that mix every identity field the matcher reads.
let seed = 7; // mulberry32
const rnd = (n) => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) % n;
};
const pick = (...xs) => xs[rnd(xs.length)];
function randomItem() {
  const n = rnd(40);
  const item = {};
  if (rnd(3)) item.contentId = pick(`tt${n}`, `TT${n}`, `tmdb:${n}`, ` tt${n} `, `kitsu:${n}`);
  if (!rnd(4)) item.id = pick(`tt${n}`, `trakt:${n}`);
  if (!rnd(3)) item.imdbId = pick(`tt${n}`, `imdb:tt${n}`);
  if (!rnd(3)) item.tmdbId = pick(n, `tmdb:${n}`, `TMDB:${n}`, String(n));
  if (!rnd(4)) item.traktId = pick(n, `trakt:${n}`);
  if (!rnd(5)) item.ids = { imdb: `tt${n}`, tmdb: n, slug: `show-${n}` };
  if (!rnd(6)) item.slug = `show-${n}`;
  return item;
}

await test("index lookup equals pairwise matching on 20,000 random cases", () => {
  for (let i = 0; i < 20000; i++) {
    const list = Array.from({ length: rnd(6) }, randomItem);
    const entry = randomItem();
    const pairwise = list.some((x) => watchedItemsShareIdentity(entry, x));
    assert.equal(
      watchedItemHasIdentityIn(entry, watchedIdentityIndex(list)),
      pairwise,
      JSON.stringify({ entry, list })
    );
  }
});

await test("empty list and empty item never match", () => {
  assert.equal(watchedItemHasIdentityIn({ contentId: "tt1" }, watchedIdentityIndex([])), false);
  assert.equal(watchedItemHasIdentityIn({}, watchedIdentityIndex([{ contentId: "tt1" }])), false);
});

// Home: getTitleWatchedItems with the fix on and off returns the same items.
const { watchedTitleStateRepository: titleRepo } =
  await import("../../js/data/repository/watchedTitleStateRepository.js");
const { watchedItemsRepository } =
  await import("../../js/data/repository/watchedItemsRepository.js");
const { metaRepository } = await import("../../js/data/repository/metaRepository.js");
const { TraktAuthService } = await import("../../js/data/repository/traktAuthService.js");
const { TraktSettingsStore, WatchProgressSource } =
  await import("../../js/data/local/traktSettingsStore.js");
TraktAuthService.isAuthenticated = () => true;
const realGet = TraktSettingsStore.get.bind(TraktSettingsStore);
TraktSettingsStore.get = () => ({ ...realGet(), watchProgressSource: WatchProgressSource.TRAKT });

const SHOWS = +(process.env.SHOWS || 300);
const ep = (s, e) => ({ number: e, plays: 1 });
const remoteShows = Array.from({ length: SHOWS }, (_, n) => ({
  contentId: `tt${n}`,
  imdbId: `tt${n}`,
  tmdbId: 1000 + n,
  title: `s${n}`,
  // even shows: 2 of 3 episodes watched (partial); odd shows: all 3 (fully watched)
  seasons: [{ number: 1, episodes: (n % 2 ? [1, 2, 3] : [1, 2]).map((e) => ep(1, e)) }]
}));
watchedItemsRepository.getRemoteTraktWatchedShows = async () => remoteShows;
metaRepository.getMetaFromAllAddons = async (type, id) => ({
  status: "success",
  data: {
    id,
    type: "series",
    videos: [1, 2, 3].map((e) => ({
      id: `${id}:1:${e}`,
      season: 1,
      episode: e,
      released: "2020-01-01T00:00:00Z"
    }))
  }
});
const catalog = remoteShows.map((s) => ({
  id: s.contentId,
  type: "series",
  name: s.title,
  tmdbId: s.tmdbId
}));
// Watched roots as Home holds them: earlier fully-watched markers for every show, plus episodes.
const base = [
  ...remoteShows.map((s) => ({
    contentId: s.contentId,
    contentType: "series",
    tmdbId: s.tmdbId,
    watchedAt: 1
  })),
  ...remoteShows.map((s) => ({
    contentId: s.contentId,
    contentType: "series",
    season: 1,
    episode: 1,
    watchedAt: 1
  })),
  { contentId: "tt999999", contentType: "movie", watchedAt: 1 }
];
const key = (i) => `${i.contentId}|${i.season ?? ""}|${i.episode ?? ""}|${i.source ?? ""}`;

let onMs = 0;
let offMs = 0;
await test("Home projection: same items with the fix on and off", async () => {
  localStorage.setItem("nuvioLabOff", "identityIndex");
  let t = performance.now();
  const off = await titleRepo.getTitleWatchedItems(catalog, { baseWatchedItems: base });
  offMs = performance.now() - t;
  localStorage.removeItem("nuvioLabOff");
  t = performance.now();
  const on = await titleRepo.getTitleWatchedItems(catalog, { baseWatchedItems: base });
  onMs = performance.now() - t;
  assert.deepEqual(on.map(key).sort(), off.map(key).sort());
  // Sanity: partial shows lost their root marker, fully watched shows got a new one.
  assert.ok(!on.some((i) => i.contentId === "tt0" && i.season == null && i.source == null));
  assert.ok(on.some((i) => i.contentId === "tt1" && i.source === "trakt_fully_watched_series"));
});

// Details: buildEpisodeState with the fix on and off sets the same episode state.
const { createMetaDetailsScreenMethods05 } =
  await import("../../js/ui/screens/detail/metaDetailsScreenMethods-05-resolve-initial-selected-season.js");
const { buildEpisodeState } = createMetaDetailsScreenMethods05();
await test("details episode state: same keys with the fix on and off", () => {
  const watched = [];
  const progress = [];
  for (let i = 0; i < 3000; i++) {
    const it = randomItem();
    it.season = rnd(3);
    it.episode = rnd(12);
    (rnd(2) ? watched : progress).push({
      ...it,
      progressPercent: rnd(100),
      source: pick("trakt", "simkl_playback", "local")
    });
  }
  for (const contentId of ["tt3", "tmdb:5", "trakt:7", "kitsu:9"]) {
    const ctx = {
      params: { itemId: contentId },
      meta: { id: contentId, imdbId: "tt3", tmdbId: 5 },
      episodes: []
    };
    localStorage.setItem("nuvioLabOff", "identityIndex");
    buildEpisodeState.call(ctx, progress, watched);
    const off = {
      p: [...ctx.episodeProgressMap.keys()].sort(),
      w: [...ctx.watchedEpisodeKeys].sort()
    };
    localStorage.removeItem("nuvioLabOff");
    buildEpisodeState.call(ctx, progress, watched);
    const on = {
      p: [...ctx.episodeProgressMap.keys()].sort(),
      w: [...ctx.watchedEpisodeKeys].sort()
    };
    assert.deepEqual(on, off, contentId);
    assert.ok(off.w.length + off.p.length > 0, `test data matches ${contentId}`);
  }
});

console.log(
  `SYNTHETIC Home projection, ${SHOWS} shows: fix off ${offMs.toFixed(1)} ms, fix on ${onMs.toFixed(1)} ms`
);
console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);
