# Watchlist sync handoff

The repair of the failures below is in `lab/research/watchlist/REPAIR.md`. This document is the pre-repair record.

Read-only investigation. No application code was changed. No merge, deploy, credential change, or live Watchlist mutation. D1–D4 scrobble files were not touched.

Source tip: `a439b76b1c2f568e6b76eae36880bff81213e6d2` on `arena/0ffafbca-nuvio-perf-lab`. The Watchlist blobs below match `SteveSpivak/NuvioTVSmart` `main` (contents API, 2026-10-16). This is not an arena-only divergence.

Node evidence is not TV evidence. No Trakt or Simkl account was called.

## Baseline

| Claim | Result | Evidence |
| --- | --- | --- |
| `fetchWatchlist()` reads `/sync/watchlist` | PROVEN | `js/data/repository/traktAuthServiceMethods-01-get-current-auth-state.js` `fetchWatchlist`, blob `a571733e9d46d351d5326686956d8cec5af684dd` |
| Pagination stops at 200 | PROVEN as a call-site cap, not a live account measurement | `LibraryRepository.refreshNow` passes `limit: 200`. The method pages at `min(limit, 100)` and `slice`s to `limit`. Headers are ignored. Test stored 200 of 250. |
| Personal lists use another model | PROVEN | `fetchTraktPersonalState` / `fetchAllTraktPages` use `X-Pagination-Page-Count`. Watchlist does not. |
| Simkl Watchlist is `plantowatch` | PROVEN | `simkl:status:plantowatch`, blob `095c7833bfbd2db5c5e6a87e670362d8deccf62e` |
| Add/remove is absent | FALSIFIED | Trakt posts `/sync/watchlist` and `/sync/watchlist/remove`. Simkl posts `/sync/add-to-list`, and `/sync/history/remove` only for a confirmed destructive removal. |
| Refresh on startup and Library navigation | PARTIAL | Startup calls `SimklSyncService.refresh()` only (`startupSyncServiceMethods-02-request-sync-now.js` blob `4b4826bee8356a63ae90262694dd1b9ff330710a`). Trakt library refresh is Library open (`ensureFreshTraktState`, 60s TTL) plus manual `refreshNow`. |

## Architecture

Nuvio does not own the Watchlist. It caches a provider snapshot and writes membership back to that provider.

Trakt path: `GET /sync/watchlist` → `normalizeWatchlistItem` → `toSavedItemFromTraktWatchlist` → `libraryTraktState:{nuvioOwnerId}:{profileId}` → Library tabs/items. Personal lists are a second snapshot in the same object. Local saved-library and Nuvio account sync are a third source, selected by `librarySourceMode`.

Simkl path: `GET /sync/activities`, then `/sync/all-items/{shows,movies,anime}` or a `date_from` delta, stored in `simklSyncState.profiles[profileId]`. Library tabs are the five Simkl statuses. Plan to Watch is the Watchlist tab. This is not a Trakt list.

There is no Watchlist queue. Do not add one. Trakt already has `traktRefreshPromise`. Simkl already has `refreshInFlight` and binds `profileId` before save.

## Contracts

Fetched 2026-10-16. Not executed against either API.

Trakt, [pagination](https://developer.trakt.tv/docs/pagination) and [rate limits](https://developer.trakt.tv/docs/rate-limiting): send `page` and `limit`; do not assume the requested limit was applied; stop from `X-Pagination-*`. Authenticated GET is 500 / 5 minutes. POST/PUT/DELETE is 1 / second. `429` carries `Retry-After` when the limiter emits it. `420` is account limit, not rate limit ([status codes](https://developer.trakt.tv/docs/status-codes), [account limits](https://developer.trakt.tv/docs/user-account-limits)). Watchlist item cap comes from `GET /users/settings` `limits.watchlist.item_count`. Do not hardcode it.

Trakt Watchlist, documented on the current developer glossary and the Apiary reference TOC: movies, shows, seasons, and episodes. Get is OAuth required and pagination-optional. Add accepts movies, shows, seasons, and episodes. A watchlist over the account cap returns `420`. Device auth in Nuvio sends only `client_id`; the granted permissions are the registered app's website prompt. The granted scope set is UNKNOWN.

Simkl, [sync guide](https://api.simkl.org/guides/sync), [list statuses](https://api.simkl.org/conventions/list-statuses), [pagination](https://api.simkl.org/conventions/pagination), [rate limits](https://api.simkl.org/resources/rate-limits): `/sync/all-items` is not page-numbered. Phase 1 is one full pull per type. Phase 2 checks `/sync/activities`, then `date_from`, and uses `extended=simkl_ids_only` only when `removed_from_list` moves. Movies have `plantowatch`, `completed`, `dropped`. TV and anime also have `watching` and `hold`. `POST /sync/add-to-list` moves status. `to: "watching"` on a movie is silently stored as `completed`. `POST /sync/history/remove` clears the library entry and its rating. Reads are 10 GET/sec; writes are 1 POST/sec, plus a per-user 20-second write lock that returns `400 rate_limit`. Do not page Simkl like Trakt.

## Defects, not missing features

Add/remove already exists. The repair is the read/cache boundary.

1. Silent truncation. `refreshNow` asks for 200. A 250-item fixture stored 200. A page of 50 with `X-Pagination-Limit: 50` and 4 pages stored 50. PROVEN, mocked HTTP.
2. A failed read becomes an empty Watchlist. `fetchWatchlist` returns `[]` on a missing token, non-OK response, or non-array body. `refreshNow` then `writeRemoteState`s and returns `true` when personal lists succeed. A 500 and a 429 both replaced `tt-kept` with `[]`. PROVEN.
3. Personal lists have the sibling hole. `fetchAllTraktPages` treats a missing `X-Pagination-Page-Count` as one page. A 105-item list stored 100. PROVEN.
4. A stale in-flight refresh overwrites a newer add. Add landed `tt-new`; the older GET then replaced the cache with `tt-old`. PROVEN. `refreshNow` does not capture a generation or the profile id.
5. Profile contamination. A refresh started on profile 1 wrote profile 1's rows into profile 2 after the active profile changed. PROVEN. Simkl already refuses that save. Trakt library refresh does not.
6. Account swap inside the 60s TTL keeps the previous Watchlist. The cache key is Nuvio owner plus profile, not the Trakt user. Disconnect switches Library to local and does not clear `libraryTraktState`. Simkl disconnect calls `clearCurrentProfile()`. PROVEN for the TTL skip; disconnect clearing is source-read.
7. Season and episode rows are not a clean movie/show identity. A season row that includes `show` is kept as `itemType: "season"` with the show's imdb id. A row with neither `movie` nor `show` is dropped. PROVEN. Whether Library should fold those rows into the series is a product choice; today they are a second, mistyped identity.
8. `SimklSyncService.getLibraryEntries` swallows a failed first read and returns `[]`. An already loaded snapshot is kept on HTTP 400. PROVEN. The empty-library presentation is the defect; the snapshot retention is the pattern to keep.

Not defects: same content id collapses in `mergeItemIntoMap` on read. A failed Trakt POST throws before `writeRemoteState`. A successful POST writes only after HTTP success. Library open inside 60s does not refetch; manual `refreshNow` does. Those three passed.

## Invariants

- No silent truncation. Page until `X-Pagination-Page-Count`, using `X-Pagination-Limit`, not the requested limit. If the safety cap is hit, fail the read.
- A failed read is not an empty Watchlist. `500`, `429`, `401`, and a missing token must not `writeRemoteState`.
- Profile A never updates profile B. Capture `profileId` before the request. Discard the write if it changed. Simkl already does this.
- A stale response does not overwrite newer state. A mutation or newer refresh that finished later wins.
- A failed write is not synchronized. Keep the current throw-before-write order. The open list picker still shows the unsaved choice until dismiss; the hero flag and the cache do not update. That picker display was not given a new optimistic-rollback in this pass.
- Do not force Trakt paging, the 200 cap, or the 60s TTL onto Simkl.

## Tests

```text
node --import ./lab/research/watchlist/preload.mjs --test --test-concurrency=1 --test-timeout=20000 \
  lab/research/watchlist/watchlist-current.test.mjs \
  lab/research/watchlist/watchlist-invariants.test.mjs
```

Run on 2026-10-16 in this workspace. Current behavior: 11 pass. Required invariants: 9 fail, 0 cancelled. Exit 1. Fetch was mocked. The preload sets fixture client ids only so Simkl's module guard can reach the mock. No provider request was made.

The red file is the repair bar. Do not weaken it to match the current defects.

TV playback, CDP, live pagination, and a real account over 200 items: NOT_RUN. There is no device hook for this pass, and none was invented.

## Smallest patch

Do not add a repository, queue, or coordinator.

1. Route Trakt Watchlist and personal-list reads through the existing header walk already used by `fetchWatchedPages`: throw on non-OK or non-array, stop on page count or an empty page, and treat a short page as final only when it is shorter than `X-Pagination-Limit`. Cap the walk with the existing `WATCHED_MAX_PAGES`. On cap or any page failure, throw and do not write. Remove the `limit: 200` completeness cap.
2. In `refreshNow`, capture profile id and a generation before the two reads. Write only if both succeed, the profile is unchanged, and no newer mutation or refresh finished. On failure return `false` and leave the previous snapshot.
3. Include the Trakt user id already available from `/users/settings` in the freshness check. Clear `libraryTraktState` for that profile on disconnect, the same way Simkl calls `clearCurrentProfile()`.
4. Deduplicate page rows by imdb, then `tmdb:`, then `trakt:`, while merging. Decide explicitly whether a season or episode row folds into its show or is excluded. Do not store `itemType: "season"` under the show id by accident.
5. For `429`, do not write. One wait on `Retry-After` can live in the existing Trakt request helper. Do not retry `420`. Surface the account limit from the thrown status. Simkl already retries transient reads and the write lock; leave that path alone.
6. Simkl: keep activities plus `all-items`. Do not add Trakt pagination. If `getLibraryEntries` has no loaded snapshot and refresh fails, surface the error instead of `[]`. Do not change `history/remove` or the destructive-removal guard.

Requesting `limit=1000` is the wrong pattern. The closed PlexTraktSync PR 2469 did that and was rejected. Official guidance is to read the applied limit. A 250-item page size is a common Trakt maximum, not a proven Watchlist maximum. Use the headers.

## Risks and rollback

The patch is not applied, so there is nothing to roll back. When it is applied, revert only the Watchlist read/write functions above. Do not revert scrobble, pending-operation, or player files with it.

Risk: a correct full read uses more GETs. A few hundred Watchlist pages stay inside 500 / 5 minutes. If the safety cap throws, the old snapshot remains, which is the intended failure. Risk: folding season rows into shows changes Library membership for accounts that watchlisted a season rather than a show. Make that choice explicit in the patch. Risk: clearing the Trakt cache on disconnect drops the local snapshot until the next successful read. That matches Simkl and is safer than showing another account.

## UNKNOWN / NOT_RUN

- Live Trakt or Simkl response for any account, including a Watchlist over 200 and a Simkl library large enough to stress one `all-items` body.
- Whether the registered Trakt app's device grant includes Watchlist write. Source calls the endpoints; the dashboard grant was not opened.
- Whether Trakt removes a Watchlist row when a scrobble crosses 80%. Do not infer it from the scrobble contract.
- Whether Simkl accepts an anime title posted in `shows` rather than `anime`. Nuvio's membership write uses `movies` or `shows`.
- TV rendering of an empty-versus-failed Library. Node only.
- `5972f145` and `exp/trakt-sync` remain absent. This pass does not reopen D4.
