# Computational efficiency research

**The nested watched-title filter can do repeated identity scans, and a blocked main thread can turn a short OK into a long press. Neither the 13 second freeze nor the 6 second and 2.2 second profile slices were re-measured here. Do not merge the unseen Trakt experiment.**

Status: research only. No production code, no television install, no merge of another agent's patch.
Tree read: `arena/0ffafbca-nuvio-perf-lab` at `24ac618` (parents `532d893`, `aa86246`, lab `deaf7e0`).
Labels: PROVEN (code read this session), MEASURED (real TV, seen here), REPORTED (local agent, profile not in this repo), INFERRED, PROPOSED, UNKNOWN, NOT_RUN.
This note does not repeat `lab/EXPERIMENT-BACKLOG.md` E0–E8 or T1–T2. Those stay the loading and trailer queue.

## Phase 0. What is and is not verified

| Claim                                                           | This session | Why                                                                                                                                    |
| --------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| 13 second Home freeze                                           | REPORTED     | Not in `lab/results`. No trace attached.                                                                                               |
| About 6 seconds in repeated watched matching                    | REPORTED     | Attributed by the local agent to its CPU profile. Profile file not in this checkout.                                                   |
| About 2.2 seconds in repeated addon settings processing         | REPORTED     | Same. No function name in a file here.                                                                                                 |
| Trakt fix effectiveness                                         | UNKNOWN      | Commit `8b7c46a` is not on `lab`, `main`, `webos-lg-fixes-1.2.5`, or this branch. `git ls-remote` returned no object. Do not merge it. |
| Row-window v1 speed improvement                                 | NOT_PROVEN   | SYNTHETIC frame rate did not rise. Television switch NOT_RUN. Flag stays off. See `lab/FINDINGS.md`.                                   |
| Production behavior outside the trials already in `lab/results` | UNKNOWN      | Do not promote an agent summary into a measured fact.                                                                                  |

`8b7c46a`: NOT_ACCESSIBLE. Searched local objects, `origin/lab`, `origin/arena/0ffafbca-nuvio-perf-lab`, and the four GitHub branch tips. Not found.

## 1. Hotspot inventory

Durations below are not assigned to these functions. The code shows the shape. The reported seconds stay REPORTED until the profile is attached and the stack names the function.

| Site                                 | Call chain                                                                                                                                                                                                                                                                  | Complexity                                                                                                                                                                         | How often                                                                                                                                                                                                                                                                       | Evidence                                                                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Partial-root filter                  | `refreshWatchedTitleState` (`homeScreenMethods-20-mount.js:264`) → `getTitleWatchedItems` (`watchedTitleStateRepository.js:158`) → `base.filter` + `partialItems.some` + `watchedItemsShareIdentity` (`watchedTitleStateRepository.js:243-250`, `watchedIdentity.js:41-44`) | Each compare rebuilds two identity sets. One call is O(B × P × I). B = watched rows passed in, P = series marked partial, I = identities per item (a handful).                     | Home load (`homeScreenMethods-21-load-data.js:60`), every deferred catalog row (`:331`), and again when that batch finishes (`:349`). Also Continue Watching load and poster watched toggle. A stale call still runs; only the result is dropped (`requestId` at mount `:266`). | PROVEN shape. Seconds NOT_RUN here.                                                                                                   |
| Series meta inside the same function | `loadSeriesMeta` (`watchedTitleStateRepository.js:105`) via `mapWithConcurrency` of 2 (`:192`)                                                                                                                                                                              | Up to one addon meta per type/id candidate, 2.5 s timeout each, concurrency 2. Not a CPU nested loop.                                                                              | Once per catalog series that matched a remote show, per projection. Repeats when the projection is called again.                                                                                                                                                                | PROVEN. Wall time UNKNOWN. Do not add it to the filter time.                                                                          |
| Watched list build                   | `getAll` (`watchedItemsRepository.js:508`) flattens every played episode (`toTraktWatchedShowEpisodeItems`, `:278`) then `limitWatchedItems` (`:341`)                                                                                                                       | O(episodes) to flatten, then O(episodes) to keep one furthest row per title before the cap.                                                                                        | Every Home load that does not already pass `baseWatchedItems`. Projection passes the array it already has, so it does not call `getAll` again.                                                                                                                                  | PROVEN. A code comment cites a 1284-entry Simkl account and about 9000 episodes. That comment is not a measurement from this session. |
| Remote show join                     | `buildRemoteShowIndex` (`watchedTitleStateRepository.js:39`) then `matchingRemoteShows` (`:62`)                                                                                                                                                                             | Hash map probe. IMDB-only collisions are refused when several shows share a weak id (`:69`).                                                                                       | Once per projection, after `getRemoteTraktWatchedShows`.                                                                                                                                                                                                                        | PROVEN. This part is already an index. The later partial-root filter is not.                                                          |
| Badge set                            | `buildWatchedTitleIdSet` (`watchedTitleBadge.js:17-25`)                                                                                                                                                                                                                     | O(title rows × identities). Episode rows are skipped.                                                                                                                              | After each projection and after `getAll`.                                                                                                                                                                                                                                       | PROVEN. Lookup after that is a `Set.has`.                                                                                             |
| Continue Watching watched check      | `isContinueWatchingItemWatched` (`homeScreenMethods-06-get-hero-source-from-focus-state.js:66`)                                                                                                                                                                             | O(watched rows) per item, new identity sets each compare.                                                                                                                          | When that menu helper runs. Frequency UNKNOWN.                                                                                                                                                                                                                                  | PROVEN shape. Not the reported 6 second stack unless a profile says so.                                                               |
| Addon install list                   | `getInstalledAddons` (`addonRepository.js:645`)                                                                                                                                                                                                                             | Cache hit returns a copy. Miss fetches manifests. Cache key is `JSON.stringify` of urls, names, and enabled flags (`:650`). `cloneValue` is `JSON.parse(JSON.stringify)` (`:252`). | Every catalog and stream load that asks for addons.                                                                                                                                                                                                                             | PROVEN. The reported 2.2 second slice is not pinned to this function. UNKNOWN which settings function the profile named.              |
| Stream session key                   | `buildStreamSourceConfiguration` (`streamRepository.js:47-64`)                                                                                                                                                                                                              | `JSON.stringify` of addon id, url, types, and resources, plus plugin state.                                                                                                        | Once per source search, as part of the session key.                                                                                                                                                                                                                             | PROVEN. Not a Home-scroll hot path unless Sources is open.                                                                            |
| Hero / Details meta                  | `getMetaFromAllAddons`                                                                                                                                                                                                                                                      | See `lab/LOADING-ARCHITECTURE.md`. In-flight share exists. No size cap.                                                                                                            | Focus settle and Details open.                                                                                                                                                                                                                                                  | PROVEN there. Not re-measured here.                                                                                                   |

Do not replace the nested filter because the Big-O is worse. A Home refresh calls it on a growing catalog. The total cost is the sum of those calls, not one O(B × P) pass. If B is 2000 and P is 20, one pass can be cheap. If it runs once per arriving row and P grows with the catalog, the sum can dominate. Both sizes are UNKNOWN for the reported freeze. The next proof is a fixture with the real counts, not a rewrite.

## 2. Data lifecycle

Authoritative stores stay the owners. A derived index is not a second library.

| Data                     | Owner                                                                | Derived                                                   | Invalidation that exists                                                                               | Gap                                                                                                                                                                  |
| ------------------------ | -------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local watched rows       | `WatchedItemsStore` via `watchedItemsRepository`                     | Episode flatten, 2000 cap, title id set                   | Writes call `invalidateTraktWatchedCaches` (`watchedItemsRepository.js:187-190`)                       | Title id set is rebuilt, not incrementally maintained. PROVEN.                                                                                                       |
| Trakt movies and shows   | `getTraktWatchedMovies` / `getTraktWatchedShows` (`:235`)            | Remote show index inside one projection                   | 30 s TTL (`:173`), in-flight share, profile id check (`:201`, `:244`)                                  | TTL is not a generation counter. A profile switch is safe only because the key includes `profileId`. PROVEN.                                                         |
| Title watched projection | `watchedTitleStateRepository` result copied onto `this.watchedItems` | Partial-root removal plus synthetic fully-watched markers | `watchedTitleProjectionRequestId` drops a stale write. It does not cancel the CPU or the meta fetches. | No snapshot generation on the catalog. Each new row starts a full projection. PROVEN.                                                                                |
| Addon manifests          | `addonRepository.manifestCache`                                      | Installed-addon array cache                               | Key change or `invalidateInstalledAddonsCache`                                                         | `cloneValue` deep-copies on profile-scoped reads. Whether that is the 2.2 s slice is UNKNOWN.                                                                        |
| Catalog rows             | `catalogRepository.catalogCache`                                     | Home `this.rows`                                          | Generation bump on `clearCache`                                                                        | No in-flight map. See loading note.                                                                                                                                  |
| Title meta               | `metaRepository.metaCache`                                           | Hero and Details patches                                  | None. No profile id in the key.                                                                        | Same addon URL across profiles shares meta. Watched state must not be stored there. PROVEN key shape. Cross-profile leak of watched state was not found in this map. |
| TMDB enrichment          | `fetchEnrichment`                                                    | Hero and Details fields                                   | None                                                                                                   | See loading note. Do not add a second TMDB client.                                                                                                                   |
| Source sessions          | `streamSearchSessionCache`                                           | Chunked UI list                                           | 15 min, 12 entries, key includes profile and addon configuration                                       | Bounded. Do not replace it.                                                                                                                                          |
| In-flight meta           | `inFlightMeta`, `inFlightMetaAll`                                    | Shared promise                                            | Deleted in `finally`                                                                                   | Good pattern to copy for a watched index build.                                                                                                                      |
| Artwork                  | DOM `img`, lazy hydration                                            | Decoded tiles in Chromium                                 | Row-window placeholders drop nodes when the flag is on                                                 | Do not clear `src` to save memory. Prior lab result.                                                                                                                 |
| Row window               | `homeRowWindow.js`, default off                                      | Placeholder DOM                                           | Switch read once                                                                                       | Not a compute fix. Leave it off.                                                                                                                                     |

Proposed lifecycle, not built: one watched generation counter. Bump it when the watched array, profile, or Trakt show cache identity changes. Build the identity map once per generation. Projections reuse it. Drop it on profile change. Catalog growth does not rebuild it unless the watched generation changed. That is incremental view maintenance in miniature: the view is "which catalog series are partial roots," the input delta is a new catalog row, and the watched side is unchanged. Differential dataflow is the same idea at a scale this app does not need (https://github.com/TimelyDataflow/differential-dataflow). Do not import it.

## 3. Scheduling and input safety

Chromium 94, webOS 8.4. `scheduler.yield` is not available. Chrome documents it as a flag from 115 and as a stable API in 129 (https://developer.chrome.com/blog/introducing-scheduler-yield-origin-trial, https://developer.chrome.com/blog/use-scheduler-yield). A Japanese note agrees: flag at 115, unflagged in 129 (https://bcrikko.github.io/til/posts/2024-08-27/scheduler-yield/). Unity's job-system pages exist in Chinese and Japanese as translations of the same manual (https://docs.unity3d.com/Manual/JobSystem.html). They add no webOS API. Compatible yield is `requestAnimationFrame` plus `setTimeout(0)`, and only after a stack shows a hotspot. See `lab/EXTERNAL-PATTERNS.md`.

A worker is not justified yet. The identity filter is small data. The cost of copying the watched library into a worker can exceed the join. Unity's job system and Unreal's task graph both refuse work that is smaller than the scheduling overhead. Same rule here. PROPOSED threshold: move work off the main thread only if a television profile shows more than a few milliseconds of self time and the payload is already a compact typed array. NOT_RUN.

### Input state machine

PROVEN from `focusEngine.js` and `homeScreenMethods-28-on-key-down.js`. Not a captured event log.

```
keydown Enter (not repeat, hold target)
  focusEngine records activeKeyDownStartedAt = Date.now()
  Home starts a 650 ms timer (CW_HOLD_DELAY_MS, homeConstants.js:19)
  Home does not open Details on keydown

keyup Enter
  keyDownDurationMs = Date.now() - startedAt     // wall clock, not key-repeat count
  if timer already set holdTriggered, or duration >= 650 ms:
    open hold menu, swallow the short press
  else:
    open Details or Continue Watching
```

The click handler (`homeScreenMethods-19-handle-home-dpad.js:171-185`) opens Details immediately and does not consult the hold timer. A remote OK is a key, not that click path.

INFERRED, sequence NOT_RUN: if the main thread is busy from keydown handling until keyup handling, `keyDownDurationMs` includes the freeze. A 650 ms threshold then classifies a short physical press as a hold. The 650 ms timer also cannot fire during a synchronous block; it runs when the block ends, which can be before the keyup listener, setting `holdTriggered`. Either path opens the hold menu and returns true from `completePendingContinueWatchingHold` (`homeScreenMethods-08-open-hold-menu-for-node.js:104-116`), so the short-press action does not run.

Watched-state actions sit on that hold menu (`togglePosterWatched`, `homeScreenMethods-09-toggle-continue-watching-watched.js:154`). A freeze that is classified as a hold can mark or unmark a title. That is a correctness risk, not a measured incident. Do not suppress keyup, and do not ignore `keyDownDurationMs`, until a log shows this order. A wrong guard would swallow real holds and real OK presses.

Back already has a key-cycle latch (`focusEngine.js` treats one keydown/keyup as one Back). Enter does not. Do not copy the Back latch onto Enter without the timestamp test. A latch would also change repeat behavior.

### Input-delay experiment

NOT_RUN. Do not run it on the television in this handoff.

Record, for one OK on a title card, without starting playback: keydown time, keyup time, `keyDownDurationMs`, whether the 650 ms timer fired, whether the hold menu opened, and the long-task intervals overlapping that gap. Then repeat while a Home refresh is in flight. The null is: duration stays near the physical hold, and the hold menu does not open for a tap. If that null holds, the freeze did not become a long press through this path, and the cause is elsewhere.

## 4. Follow-ups that are not already in the loading backlog

Smallest first. Each is NOT_RUN. No percentage.

### C0. Attach the reported profile

- **Hypothesis.** The 6 second and 2.2 second slices name functions already in the inventory, or they name something this note missed.
- **Null.** The stacks are in renderer, GC, or a function with no Hotspot row. Then do not patch the filter.
- **Change.** None. The local agent keeps `8b7c46a` unmerged and points at the `.cpuprofile` or a redacted stack list.
- **KEEP** only as evidence. **REJECT** any summary that still lacks a function name.

### C1. Fixture: nested filter versus one identity map

- **Hypothesis.** For the account sizes in the reported freeze, the partial-root filter is a large part of one projection, and a map built once per watched generation returns the same partial set faster.
- **Null.** At those sizes the filter is under a few milliseconds, or the map disagrees with today's partial set. Stop.
- **Change.** A test only, against `watchedItemsShareIdentity` and the filter predicate. No Home edit. Counts must come from a redacted fixture (row counts, not titles).
- **Index cost.** One pass over B items. Memory is one string map. Drop it when the watched generation changes.
- **Invalidation.** New `watchedItems` array, profile id, or Trakt show-cache identity. Catalog-only growth must not rebuild it.
- **Risk.** The weak-IMDB rule in `matchingRemoteShows` (`watchedTitleStateRepository.js:69`) must stay. A hash join that merges anthology shows is a wrong badge.
- **KEEP** only if the fixture matches today's output and the timed gap is large enough to matter next to network. **REJECT** a production edit from Big-O alone.

SQLite builds a transient index when a nested loop would otherwise scan the inner side repeatedly, and describes that as the same idea as a hash join (https://www.sqlite.org/optoverview.html#hash_joins). Copy that decision rule: build the index when the inner side is scanned more than once per refresh. Do not add SQLite.

### C2. Stop projecting on every arriving row

- **Hypothesis.** Calling `refreshWatchedTitleState` from each deferred row (`load-data.js:331`) repeats the join and the meta fan-out. One projection after the batch, plus the generation from C1, does the same badge update.
- **Null.** Badges must update per row or the user sees a wrong watched state for the rest of the load. Then keep the per-row call.
- **Change.** Later, one call-site edit. Not in this commit. Do not batch it with row-window or with E2/E3.
- **Risk.** A badge that appears late. Acceptable if the first paint already used `buildWatchedTitleIdSet` from `getAll`.
- **KEEP** if a trace shows fewer projections and the same final badge set. **REJECT** if a title flips watched state.

### C3. Input timestamp test

- **Hypothesis.** A main-thread stall between keydown and keyup makes `keyDownDurationMs` exceed 650 ms and opens the hold menu for a tap.
- **Null.** A tap during a stall still takes the short-press path.
- **Change.** A lab recorder only. No event suppression. Never OK on Continue Watching (that can play). Title-row card only.
- **KEEP** the log. **REJECT** a suppression patch until the log shows the bad order. Watched toggle must not be the thing under test until the order is proven.

### C4. Name the addon-settings slice before caching it

- **Hypothesis.** The reported 2.2 seconds is repeated `JSON.stringify` / `cloneValue` of addon manifests or plugin settings.
- **Null.** It is network, or a different function. Then do not memoize settings.
- **Change.** None until C0. Existing caches: installed-addon promise, manifest cache, stream session key. A second settings cache is a second source of truth.
- **KEEP** a memo only if the profile names a pure function and a fixture shows repeated equal inputs. **REJECT** a global settings store.

## 5. Handoff to the local agent

After the watched-matching and addon-settings work, in this order:

1. Put the CPU profile, or a redacted self-time table, where this branch can see it. Until then the 6 second and 2.2 second numbers stay REPORTED.
2. Do not merge `8b7c46a` or any Trakt behavior change on the strength of those numbers. Effectiveness is UNKNOWN.
3. Run C1 on a redacted fixture before editing `getTitleWatchedItems`. The equivalence check is the partial-root set, including the weak-IMDB refusal.
4. If C1 wins, C2 is the call-site cut. Leave `labRowWindow` off. Do not combine with unpromote.
5. Run C3 before any keyup guard. Watched mark/unmark must not be reachable from a tap that was only slow.
6. Loading experiments E0 and E1 in `lab/EXPERIMENT-BACKLOG.md` are still the next television measurements for Details. They are a different commit.

## External notes that changed a decision

| Source                                                                                                      | Use                                                                                                             | Do not                                                                                                       |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| SQLite automatic index / hash join, https://www.sqlite.org/optoverview.html#hash_joins                      | Build a transient identity map when the inner watched list is scanned once per catalog row.                     | Do not embed SQLite.                                                                                         |
| Differential dataflow, https://github.com/TimelyDataflow/differential-dataflow                              | A view can update from a delta. Here the delta is "one new catalog row" against a stable watched generation.    | Do not add the crate.                                                                                        |
| Stremio watched bitfield, https://github.com/Stremio/stremio-core/tree/development/stremio-watched-bitfield | Compact per-video watched flags exist in another GPL-compatible engine. README only. Algorithm body not copied. | Do not replace Nuvio's identity rules with a bitfield until the fixture says the representation is the cost. |
| TanStack query keys                                                                                         | Already in `lab/EXTERNAL-PATTERNS.md`. A watched generation is a key.                                           | Do not add the library.                                                                                      |
| Chrome `scheduler.yield`                                                                                    | Not on Chromium 94.                                                                                             | No yield API that 94 lacks.                                                                                  |
| Unity job system, https://docs.unity3d.com/Manual/JobSystem.html                                            | Schedule only work that is worth the handoff. Chinese and Japanese pages are the same manual.                   | Do not add a job system.                                                                                     |

Russian-language search this session did not add a join or input algorithm beyond the SQLite and Chrome pages. NOT_FOUND as extra technique, not "no such writing."
