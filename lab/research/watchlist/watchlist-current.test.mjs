import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { SimklSyncService } from "../../../js/data/repository/simklSyncService.js";
import { TraktAuthService } from "../../../js/data/repository/traktAuthService.js";
import {
  connectSimkl,
  connectTrakt,
  libraryRepository,
  LocalStore,
  readCachedRemoteState,
  readCachedWatchlistIds,
  remoteStoreKeyFor,
  resetWatchlistHarness,
  seedRemoteWatchlist,
  traktMovieEntry,
  traktSeasonEntry,
  waitUntil,
  watchlistItemTypes,
  WatchlistHttpMock
} from "./harness.mjs";

let http;

beforeEach(async () => {
  await resetWatchlistHarness();
  http = new WatchlistHttpMock().install();
});

afterEach(() => {
  http?.restore();
});

function movies(count, start = 1) {
  return Array.from({ length: count }, (_, index) => traktMovieEntry(start + index));
}

async function assertCompleteRefresh(count) {
  connectTrakt();
  http.watchlistItems = movies(count);
  const ok = await libraryRepository.refreshNow();
  const ids = await readCachedWatchlistIds();
  assert.equal(ok, true);
  assert.equal(ids.length, count);
  if (count > 0) {
    assert.equal(ids[0], "tt0000001");
    assert.equal(ids[count - 1], `tt${String(count).padStart(7, "0")}`);
  }
}

test("complete header walk stores 0 Watchlist entries as a successful empty snapshot", async () => {
  await assertCompleteRefresh(0);
  const state = await readCachedRemoteState();
  assert.ok(state.syncedAt > 0);
});

test("complete header walk stores 1 Watchlist entry", async () => {
  await assertCompleteRefresh(1);
});

test("complete header walk stores 100 Watchlist entries", async () => {
  await assertCompleteRefresh(100);
});

test("complete header walk stores 200 Watchlist entries", async () => {
  await assertCompleteRefresh(200);
});

test("complete header walk stores 250 Watchlist entries", async () => {
  await assertCompleteRefresh(250);
});

test("complete header walk stores 251 Watchlist entries", async () => {
  await assertCompleteRefresh(251);
});

test("complete header walk stores 350 Watchlist entries", async () => {
  await assertCompleteRefresh(350);
});

test("complete header walk stores 1001 Watchlist entries", async () => {
  await assertCompleteRefresh(1001);
  assert.ok(http.watchlistGetCount() >= 11);
});

test("missing pagination metadata still walks until an empty page", async () => {
  connectTrakt();
  http.watchlistItems = movies(105);
  http.omitPageCount = true;
  http.omitLimitHeader = true;

  const ok = await libraryRepository.refreshNow();
  const ids = await readCachedWatchlistIds();

  assert.equal(ok, true);
  assert.equal(ids.length, 105);
});

test("failure on a later Watchlist page preserves the previous snapshot", async () => {
  connectTrakt();
  await seedRemoteWatchlist([{ contentId: "tt-kept", contentType: "movie", title: "Kept" }]);
  http.watchlistItems = movies(250);
  http.watchlistErrorStatus = 500;
  http.watchlistErrorPage = 2;

  const ok = await libraryRepository.refreshNow();
  assert.equal(ok, false);
  assert.deepEqual(await readCachedWatchlistIds(), ["tt-kept"]);
});

test("two refreshes completing in reverse order keep the newer snapshot", async () => {
  connectTrakt();
  const [firstGet, secondGet] = http.holdWatchlistGets(2);

  const first = libraryRepository.refreshNow();
  await waitUntil(() => http.watchlistGetCount() >= 1, { message: "first Watchlist GET missing" });
  const second = libraryRepository.refreshNow();
  await waitUntil(() => http.watchlistGetCount() >= 2, { message: "second Watchlist GET missing" });

  secondGet.resolve([traktMovieEntry(2, { imdbId: "tt-new", title: "New" })]);
  await second;
  firstGet.resolve([traktMovieEntry(1, { imdbId: "tt-old", title: "Old" })]);
  await first;

  assert.deepEqual(await readCachedWatchlistIds(), ["tt-new"]);
});

test("a successful empty Watchlist is distinct from a failed read", async () => {
  connectTrakt();
  http.watchlistItems = [];
  assert.equal(await libraryRepository.refreshNow(), true);
  const empty = await readCachedRemoteState();
  assert.equal(empty.watchlist.length, 0);
  assert.ok(empty.syncedAt > 0);

  http.watchlistErrorStatus = 401;
  assert.equal(await libraryRepository.refreshNow(), false);
  const afterFailure = await readCachedRemoteState();
  assert.equal(afterFailure.syncedAt, empty.syncedAt);
  assert.equal(afterFailure.watchlist.length, 0);
});

test("Simkl keeps a loaded snapshot after a transient later failure", async () => {
  connectSimkl();
  http.simklEntries.movies = [
    {
      status: "plantowatch",
      movie: { title: "Kept", year: 2020, ids: { imdb: "tt-kept", simkl: 9 } }
    }
  ];
  assert.equal(await SimklSyncService.refresh({ force: true }), true);
  const loaded = await SimklSyncService.getLibraryEntries();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, "tt-kept");

  const envelope = LocalStore.get("simklSyncState", null);
  const profile = envelope?.profiles?.["1"];
  if (profile) {
    profile.lastCheckedAt = 1;
    LocalStore.set("simklSyncState", envelope);
  }
  http.simklErrorStatus = 400;
  const kept = await SimklSyncService.getLibraryEntries();
  assert.equal(kept.length, 1);
  assert.equal(kept[0].id, "tt-kept");
});

test("repeated pagination pages terminate without hanging", async () => {
  connectTrakt();
  http.watchlistItems = movies(100);
  http.repeatSamePage = true;
  http.omitPageCount = true;

  const ok = await libraryRepository.refreshNow();
  assert.equal(ok, false);
  const state = await readCachedRemoteState();
  assert.equal(state.syncedAt, 0);
});

test("season rows keep itemType season under the show identity", async () => {
  connectTrakt();
  http.watchlistItems = [traktSeasonEntry(8, { imdbId: "tt0000008", title: "Seasoned" })];

  assert.equal(await libraryRepository.refreshNow(), true);
  const state = await readCachedRemoteState();
  assert.deepEqual(watchlistItemTypes(state), ["season"]);
  assert.equal(state.watchlist[0].itemId, "tt0000008");
});

test("HTTP 401 does not write a Watchlist snapshot", async () => {
  connectTrakt();
  await seedRemoteWatchlist([{ contentId: "tt-kept", contentType: "movie", title: "Kept" }]);
  http.watchlistErrorStatus = 401;

  assert.equal(await libraryRepository.refreshNow(), false);
  assert.deepEqual(await readCachedWatchlistIds(), ["tt-kept"]);
});

test("a failed Watchlist mutation does not publish", async () => {
  connectTrakt();
  await seedRemoteWatchlist([]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const method = String(options.method || "GET").toUpperCase();
    const path = new URL(String(url), "https://api.trakt.tv").pathname;
    if (method === "POST" && path === "/sync/watchlist") {
      return {
        ok: false,
        status: 500,
        headers: { get: () => null },
        text: async () => JSON.stringify({ error: "server" })
      };
    }
    return originalFetch(url, options);
  };

  await assert.rejects(() =>
    libraryRepository.applyMembershipChanges(
      { itemId: "tt-new", itemType: "movie", title: "New", imdbId: "tt-new" },
      { desiredMembership: { watchlist: true } }
    )
  );
  assert.deepEqual(await readCachedWatchlistIds(), []);
});

test("disconnect clears this profile's Trakt library snapshot", async () => {
  connectTrakt();
  http.watchlistItems = movies(2);
  assert.equal(await libraryRepository.refreshNow(), true);
  const key = await remoteStoreKeyFor("1");
  assert.ok(LocalStore.get(key, null)?.watchlist?.length > 0);

  await TraktAuthService.disconnect();
  if (typeof libraryRepository.clearCurrentProfile === "function") {
    await libraryRepository.clearCurrentProfile();
  }
  assert.equal(LocalStore.get(key, null), null);
});

test("cache hit inside TTL issues no Watchlist GET", async () => {
  connectTrakt();
  http.watchlistItems = movies(3);
  assert.equal(await libraryRepository.refreshNow(), true);
  const getsAfterRefresh = http.watchlistGetCount();

  await libraryRepository.ensureFreshTraktState();
  assert.equal(http.watchlistGetCount(), getsAfterRefresh);
});
