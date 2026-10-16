import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { SimklSyncService } from "../../../js/data/repository/simklSyncService.js";
import {
  connectSimkl,
  connectTrakt,
  libraryRepository,
  LocalStore,
  ProfileManager,
  readCachedRemoteState,
  readCachedWatchlistIds,
  remoteStoreKeyFor,
  resetWatchlistHarness,
  seedRemoteWatchlist,
  traktMovieEntry,
  TraktAuthStore,
  waitUntil,
  watchlistIds,
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

test("invariant 1: a 250-item Watchlist is not truncated at the 200 call-site cap", async () => {
  connectTrakt();
  http.watchlistItems = movies(250);

  const ok = await libraryRepository.refreshNow();
  const ids = await readCachedWatchlistIds();

  assert.equal(ok, true);
  assert.equal(ids.length, 250, "failed read or silent truncation stored fewer than 250 items");
  assert.equal(ids[0], "tt0000001");
  assert.equal(ids[249], "tt0000250");
});

test("invariant 2: a provider-clamped page is not treated as the final page", async () => {
  connectTrakt();
  http.watchlistItems = movies(200);
  http.appliedLimit = 50;

  const ok = await libraryRepository.refreshNow();
  const ids = await readCachedWatchlistIds();

  assert.equal(ok, true);
  assert.equal(ids.length, 200);
  assert.equal(http.watchlistGetCount(), 4);
});

test("invariant 3: HTTP 500 does not replace a loaded Watchlist with an empty success", async () => {
  connectTrakt();
  await seedRemoteWatchlist([{ contentId: "tt-kept", contentType: "movie", title: "Kept" }]);
  http.watchlistErrorStatus = 500;

  const ok = await libraryRepository.refreshNow();
  const ids = await readCachedWatchlistIds();

  assert.equal(ok, false);
  assert.deepEqual(ids, ["tt-kept"]);
});

test("invariant 4: HTTP 429 does not replace a loaded Watchlist with an empty success", async () => {
  connectTrakt();
  await seedRemoteWatchlist([{ contentId: "tt-kept", contentType: "movie", title: "Kept" }]);
  http.watchlistErrorStatus = 429;

  const ok = await libraryRepository.refreshNow();
  const ids = await readCachedWatchlistIds();

  assert.equal(ok, false);
  assert.deepEqual(ids, ["tt-kept"]);
});

test("invariant 5: missing X-Pagination-Page-Count does not end a full personal-list page", async () => {
  connectTrakt();
  http.personalLists = [
    {
      name: "Favorites",
      type: "personal",
      privacy: "private",
      ids: { trakt: 42, slug: "favorites" }
    }
  ];
  http.personalItems = movies(105);
  http.personalOmitPageCount = true;

  const ok = await libraryRepository.refreshNow();
  const state = await readCachedRemoteState();
  const items = state.listItems?.["personal:42"] || [];

  assert.equal(ok, true);
  assert.equal(items.length, 105);
});

test("invariant 6: a stale in-flight refresh does not overwrite a newer successful add", async () => {
  connectTrakt();
  await seedRemoteWatchlist([{ contentId: "tt-old", contentType: "movie", title: "Old" }]);
  const [heldGet] = http.holdWatchlistGets(1);

  const refresh = libraryRepository.refreshNow();
  await waitUntil(() => http.watchlistHolds.length === 0, {
    message: "Watchlist GET was never issued"
  });

  await libraryRepository.applyMembershipChanges(
    { itemId: "tt-new", itemType: "movie", title: "New", imdbId: "tt-new" },
    { desiredMembership: { watchlist: true } }
  );

  const afterMutation = await readCachedWatchlistIds();
  assert.ok(afterMutation.includes("tt-new"), "mutation must publish before the held GET resumes");

  heldGet.resolve([traktMovieEntry(1, { imdbId: "tt-old", title: "Old" })]);
  await refresh;

  const ids = await readCachedWatchlistIds();
  assert.ok(ids.includes("tt-new"), "older GET must not clobber a newer successful mutation");
  assert.equal(ids.includes("tt-old") && !ids.includes("tt-new"), false);
});

test("invariant 7: a profile-1 refresh cannot publish into profile 2", async () => {
  connectTrakt({ accessToken: "profile-1-token", profileId: "1" });
  connectTrakt({ accessToken: "profile-2-token", profileId: "2" });
  await ProfileManager.setActiveProfile("1");
  const [heldGet] = http.holdWatchlistGets(1);

  const refresh = libraryRepository.refreshNow();
  await waitUntil(() => http.watchlistHolds.length === 0, {
    message: "Watchlist GET was never issued"
  });

  await ProfileManager.setActiveProfile("2");
  heldGet.resolve(movies(3));
  await refresh;

  const profile1 = LocalStore.get(await remoteStoreKeyFor("1"), null);
  const profile2 = LocalStore.get(await remoteStoreKeyFor("2"), null);
  const profile1Ids = watchlistIds(profile1);
  const profile2Ids = watchlistIds(profile2);

  assert.equal(profile2Ids.length, 0, "profile 2 must not receive profile 1 rows");
  assert.deepEqual(profile1Ids, ["tt0000001", "tt0000002", "tt0000003"]);
});

test("invariant 8: a Trakt token revision invalidates the 60s Watchlist TTL", async () => {
  connectTrakt({ username: "alice", userSlug: "alice", accessToken: "token-a" });
  http.watchlistItems = [traktMovieEntry(1, { imdbId: "tt-alice", title: "Alice" })];
  assert.equal(await libraryRepository.refreshNow(), true);
  assert.deepEqual(await readCachedWatchlistIds(), ["tt-alice"]);

  connectTrakt({ username: "bob", userSlug: "bob", accessToken: "token-b" });
  http.watchlistItems = [traktMovieEntry(2, { imdbId: "tt-bob", title: "Bob" })];

  await libraryRepository.ensureFreshTraktState();
  const ids = await readCachedWatchlistIds();
  assert.deepEqual(ids, ["tt-bob"]);
  assert.ok(Number(TraktAuthStore.get().authRevision || 0) >= 2);
});

test("invariant 9: a failed Simkl first read is not an empty library", async () => {
  connectSimkl();
  http.simklErrorStatus = 400;

  await assert.rejects(
    () => SimklSyncService.getLibraryEntries(),
    (error) => {
      assert.ok(error);
      assert.notEqual(error.status, 200);
      return true;
    }
  );
});
