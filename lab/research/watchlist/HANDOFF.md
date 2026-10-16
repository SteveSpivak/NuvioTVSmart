# Watchlist integrity repair — NuvioTVSmart

Stop at a tested repair commit. No merge to `main`, no deploy, no LG TV change.

## Source of truth

| Item                                | Value                                                                                    | Status  |
| ----------------------------------- | ---------------------------------------------------------------------------------------- | ------- |
| Application HEAD evaluated          | `cee232e571fa01a3175b2798e5c7bc513f476f65` (`main` 1.2.5)                                | PROVEN  |
| Research docs                       | `research/watchlist-cloud-handoff-20261016` @ `4709b2642bb970b3d1b129550713428be4fe56e4` | PROVEN  |
| Repair implementation in those docs | Not present in this checkout                                                             | PROVEN  |
| LG Lab revision `95ae957e`          | Not a git object here                                                                    | UNKNOWN |
| Live Trakt / Simkl / TV             | Not called                                                                               | NOT_RUN |

The nine invariant assertions were reconstructed from the research defects and were not weakened.

## Formal model

A refresh is `R = (provider, account, profile, authRevision, publicationVersion, requestId)`.

It may publish only when every required read succeeded, the captured store key is used, `authRevision` is unchanged, and `publicationVersion` is still current.

Linearization is the synchronous `LocalStore.set`, not the start of `refreshNow`. Mutations claim a newer publication id and write in the same turn with no `await` between claim and cache write. They do not join `traktRefreshPromise`.

Counterexample that a post-fetch generation counter misses: hold the Watchlist GET, complete `applyMembershipChanges`, then resume the GET. Sampling after the fetch lets the stale snapshot win. Claiming before the read and publishing only if that id is still current rejects it.

## What changed

- Trakt Watchlist and personal lists walk `X-Pagination-Page-Count` / `X-Pagination-Limit`. A missing page count does not end a full page. A short page ends only against the applied limit. The `WATCHED_MAX_PAGES` cap throws. The `limit: 200` completeness stop is gone.
- Failed reads throw and do not `writeRemoteState`. `500` / `429` / `401` keep the previous snapshot.
- Refresh captures profile, store key, token, and `authRevision` before the two reads and writes only to that key.
- `saveToken` increments `authRevision`. Same-user token refresh invalidates the 60s TTL once.
- Disconnect clears `libraryTraktState` for the active profile (Trakt screen, same hook Simkl already uses).
- Simkl keeps activities + `all-items`. A failed first read throws from `getLibraryEntries`. A loaded snapshot is kept. `history/remove` is unchanged.
- Season rows stay `itemType: "season"`. Folding them into the show is still a product choice.

## Tests

```text
node --import ./lab/research/watchlist/preload.mjs --test --test-concurrency=1 --test-timeout=20000 \
  lab/research/watchlist/watchlist-invariants.test.mjs \
  lab/research/watchlist/watchlist-current.test.mjs
```

| Stage                                          | Result                             |
| ---------------------------------------------- | ---------------------------------- |
| RED, invariants only, pre-repair               | 9 fail, 0 pass, exit 1             |
| GREEN, both files, this repair                 | 28 pass, 0 fail, exit 0            |
| Existing Node unit tests                       | 13 pass, 0 fail                    |
| Scrobble suite `lab/research/trakt-sync/tests` | Absent in this repository, NOT_RUN |
| D1–D4 scrobble files                           | Not edited                         |

Fetch is mocked. The preload sets fixture client ids only. No provider request is made.

## Performance (mocked / calculated)

Page fetches stay sequential. Do not parallelize from page 1: the applied limit is not known until headers return.

`T_refresh ≈ Σ(page latency) + 1×GET /users/me/lists + normalization + publication`

| Case                                     | Watchlist GETs  | Notes                                     |
| ---------------------------------------- | --------------- | ----------------------------------------- |
| Valid 60s cache hit, same `authRevision` | 0               | `ensureFreshTraktState` returns           |
| Empty or 1–100 items                     | 1               | plus lists GET                            |
| 250 items, applied limit 100             | 3               | was silently 2 pages then sliced to 200   |
| 1001 items, applied limit 100            | 11              | plus lists GET                            |
| Provider clamp 50, 200 items             | 4               | was 1 page of 50                          |
| Safety cap                               | 1000 then throw | previous snapshot kept                    |
| GET 429 with `Retry-After` 1–10s         | one retry       | POST is not retried; `420` is not retried |

Memory is O(N) for the normalized snapshot. Publication is one `LocalStore.set`. UI time to first useful content is the cache read on a hit, otherwise the sequential page sum.

Authenticated GET budget is 500 / 5 minutes. A few hundred Watchlist pages stay inside that. Worst-case cap throw is the intended failure.

## Local integration

1. Stay on this branch. Do not merge to `main`.
2. Run the command above. Keep `watchlist-invariants.test.mjs` unchanged.
3. Do not reintroduce a refresh wait inside `applyMembershipChanges`.
4. Do not page Simkl. Do not add a queue or second sync engine.
5. D1–D4 scrobble files must stay untouched.

## Risks / unresolved

- Live Watchlist over 200 items: NOT_RUN.
- Whether a season row should fold into its show: NOT_RUN; still stored as season.
- Settings-screen Trakt disconnect does not call `clearCurrentProfile()`; only the Trakt screen hook does, matching Simkl’s UI pattern.
- Device-grant Watchlist write scope: UNKNOWN.
- `5972f145` / `exp/trakt-sync` remain absent. This pass does not reopen D4.
