// node lab/checks/watched-remote-memo.test.mjs
// watchedItemsRepository.getAll reuses the flattened Trakt list while the Trakt caches return the same
// arrays, and rebuilds it when they change. Local items are never cached.
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

const { watchedItemsRepository: repo } =
  await import("../../js/data/repository/watchedItemsRepository.js");
const { TraktAuthService } = await import("../../js/data/repository/traktAuthService.js");
const { TraktSettingsStore, WatchProgressSource } =
  await import("../../js/data/local/traktSettingsStore.js");

const show = (id, episodes) => ({
  contentId: id,
  title: id,
  seasons: [
    {
      number: 1,
      episodes: episodes.map((n) => ({
        number: n,
        plays: 1,
        lastWatchedAt: "2026-01-01T00:00:00Z"
      }))
    }
  ]
});
let remoteShows = [show("tt0000001", [1, 2, 3])];
let remoteMovies = [{ contentId: "tt0000009", contentType: "movie", title: "m", watchedAt: 1 }];
const calls = { movies: 0, shows: 0 };
TraktAuthService.isAuthenticated = () => true;
TraktAuthService.fetchWatchedMovies = async () => (calls.movies++, remoteMovies);
TraktAuthService.fetchWatchedShows = async () => (calls.shows++, remoteShows);
const realGet = TraktSettingsStore.get.bind(TraktSettingsStore);
TraktSettingsStore.get = () => ({ ...realGet(), watchProgressSource: WatchProgressSource.TRAKT });

const ids = (items) =>
  items.map((i) => `${i.contentId}:${i.season ?? ""}:${i.episode ?? ""}`).sort();
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

await test("first call flattens movies and episodes", async () => {
  const all = await repo.getAll();
  assert.deepEqual(ids(all), ["tt0000001:1:1", "tt0000001:1:2", "tt0000001:1:3", "tt0000009::"]);
});

await test("second call reuses the derived list while the Trakt arrays are unchanged", async () => {
  const before = repo._traktRemoteDerived;
  assert.ok(before?.remoteKeys instanceof Set, "derived Trakt list is kept after the first call");
  const a = await repo.getAll();
  assert.equal(repo._traktRemoteDerived, before);
  const b = await repo.getAll();
  assert.deepEqual(ids(a), ids(b));
  assert.equal(calls.shows, 1, "Trakt fetched once inside the 30 s cache");
});

await test("concurrent getAll and isWatched agree, as on a details open", async () => {
  const [all, watched, notWatched] = await Promise.all([
    repo.getAll(),
    repo.isWatched("tt0000009"),
    repo.isWatched("tt0000404")
  ]);
  assert.equal(all.length, 4);
  assert.equal(watched, true);
  assert.equal(notWatched, false);
});

await test("returned arrays are fresh, so a caller cannot corrupt the cache", async () => {
  const a = await repo.getAll();
  a.length = 0;
  assert.equal((await repo.getAll()).length, 4);
});

await test("local items are read every call and deduplicated against Trakt", async () => {
  await repo.mark({ contentId: "tt0000009", contentType: "movie" }, { skipTrackingWrite: true });
  await repo.mark({ contentId: "tt0000777", contentType: "movie" }, { skipTrackingWrite: true });
  const all = await repo.getAll();
  assert.deepEqual(ids(all), [
    "tt0000001:1:1",
    "tt0000001:1:2",
    "tt0000001:1:3",
    "tt0000009::",
    "tt0000777::"
  ]);
});

await test("new Trakt data after invalidation is not hidden by the reuse", async () => {
  remoteShows = [show("tt0000001", [1, 2, 3, 4])];
  const before = repo._traktRemoteDerived;
  await repo.mark({ contentId: "tt0000888", contentType: "movie" }, { skipTrackingWrite: true }); // invalidates caches
  const all = await repo.getAll();
  assert.notEqual(
    repo._traktRemoteDerived,
    before,
    "derived list rebuilt from the new Trakt arrays"
  );
  assert.ok(ids(all).includes("tt0000001:1:4"), "episode 4 from the refreshed Trakt list");
});

await test("lab switch off (nuvioLabOff=watchedMemo) rebuilds every call with the same result", async () => {
  const on = ids(await repo.getAll());
  localStorage.setItem("nuvioLabOff", "watchedMemo");
  const before = repo._traktRemoteDerived;
  const off = ids(await repo.getAll());
  assert.notEqual(repo._traktRemoteDerived, before);
  assert.deepEqual(off, on);
  localStorage.removeItem("nuvioLabOff");
});

console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);
