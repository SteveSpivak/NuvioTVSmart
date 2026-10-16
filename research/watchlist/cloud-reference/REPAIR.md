# Watchlist repair

Local evidence package: NOT_RECEIVED. The reported local patch and failed generation-counter experiment were not in this checkout. They were not copied.

Base SHA before this repair: `7d53c58cceec378821da266df9238843bcd724dd`.

Reproduced on that SHA, mocked HTTP, no live Trakt or Simkl call:

```text
node --import ./lab/research/watchlist/preload.mjs --test --test-concurrency=1 --test-timeout=20000 lab/research/watchlist/watchlist-invariants.test.mjs
```

9 fail, 0 pass. The assertions in that file were not weakened.

## Why a generation counter alone failed

The cloud stale-refresh test holds the Watchlist GET until after `applyMembershipChanges` returns. The mutation must not wait for that in-flight refresh. `ensureFreshTraktState` still returns immediately inside the 60s TTL, so it does not join `traktRefreshPromise`. Joining it deadlocks this test.

The linearization point is the synchronous cache publish, not the start of `refreshNow`:

1. The refresh claims a publication id and captures the profile, owner, access token, and `authRevision` before the read is issued.
2. A successful POST claims a newer id and publishes in the same turn, with no `await` between the claim and `LocalStore.set`.
3. The refresh publishes only if its id is still current, the captured token revision is unchanged, and only to the captured `libraryTraktState:{owner}:{profile}` key.

A counter sampled after the fetch, or a mutation that waits for the refresh, does not satisfy that order.

## After

Same command, plus `watchlist-current.test.mjs`: 20 pass, 0 fail. Scrobble suite `lab/research/trakt-sync/tests`: 39 pass, 0 fail. D1–D4 scrobble files were not edited. No live provider call. No TV run. No merge to `main`.

## Changed files

- `js/data/repository/traktAuthService.js` — header page rule. A missing page count does not end a full page. A short page ends only against `X-Pagination-Limit`. The safety cap throws.
- `js/data/repository/traktAuthServiceMethods-01-get-current-auth-state.js` — `fetchWatchlist` throws on failure and reads every page. The old `limit: 200` cap is not a completeness stop.
- `js/data/repository/libraryRepositoryHelpers-03-authorized-trakt-request.js` — personal lists use the same page rule and a captured token.
- `js/data/repository/libraryRepositoryHelpers-04-library-repository.js` — publication id, captured store key, failed read does not write.
- `js/data/repository/libraryRepositoryHelpers-01-library-source-mode.js` — `authRevision` on the snapshot and `clearRemoteState`.
- `js/data/local/traktAuthStore.js` — `saveToken` increments `authRevision`. The token itself is not stored in the library cache.
- `js/data/repository/simklSyncService.js` — a failed first read throws from `getLibraryEntries`. A loaded snapshot is kept.
- `js/ui/screens/library/libraryController.js` — a thrown library load clears `isLoading` and sets `errorMessage`.
- `js/ui/screens/trakt/traktScreen.js` — disconnect clears that profile's Trakt library snapshot, same hook Simkl already uses.
- `lab/research/watchlist/watchlist-current.test.mjs` — the old 200-cap characterization now expects a complete header walk.

## Local integration

Keep the cloud invariant file unchanged and run it against this patch. Do not reintroduce a refresh wait inside `applyMembershipChanges`. Do not page Simkl. Do not add a queue. A same-user token refresh now invalidates the 60s library snapshot once; that is the account-switch signal, not a second sync engine.

Still NOT_RUN: live accounts, a Watchlist over 200 on the real API, TV Library rendering, and whether a season row should fold into its show. Season rows are still stored as `itemType: "season"`. That was not one of the nine failing assertions.
