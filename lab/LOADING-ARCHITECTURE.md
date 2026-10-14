# Loading architecture

**Home already prefetches all-addon metadata, and a 5 second rest cuts Details settle time from about 5.9 seconds to about 2.1 seconds. On 4 trials that recorded resources, settle ends about 0.1 seconds after the last request. Long tasks of 1.1–1.8 seconds were also recorded. That sum is not a proven latency floor. Row-window v1 stays off: on the emulator it cut layers and did not raise frame rate.**

Status: research handoff. No production Home, cache, metadata fetch, or trailer change.
Evidence labels: PROVEN (code read this session), OBSERVED (seen in a trace or DOM check), MEASURED (real TV), SYNTHETIC (emulator), INFERRED, PROPOSED, UNKNOWN, NOT_RUN.
Emulator numbers are never television speed.

## Provenance

| Commit    | What it contributes                                                                                                                                                     | Label                        |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `9019da8` | Television Details timing, `lab/perf/details.mjs`, `lab/results/tv/2026-10-14_details_open/details.json`, `lab/results/tv/2026-10-14_details_open_dwell2s/details.json` | MEASURED                     |
| `deaf7e0` | `lab/NETWORK-RESEARCH.md`. Hypotheses and measurement gates. No speedup claimed.                                                                                        | PROPOSED                     |
| `aa86246` | Row-window v1 behind `labRowWindow`, default off. Synthetic A/B in `lab/FINDINGS.md`.                                                                                   | SYNTHETIC. TV switch NOT_RUN |
| `532d893` | Merge of `origin/lab` (`deaf7e0`) into `arena/0ffafbca-nuvio-perf-lab`. Keeps `NETWORK-RESEARCH.md`.                                                                    | provenance                   |

Canonical notes: `lab/FINDINGS.md`, `lab/results/tv/INDEX.md`, `lab/NETWORK-RESEARCH.md`.

## Five milestones, not one number

`settledMs` is the last change in `#detail` text length or element count during a 12 second capture (`lab/perf/details.mjs`). It is not usable Details, not full enrichment, not trailer readiness, and not a selectable source.

| Milestone               | Meaning                                                                                                       | What exists now                                                                                                        | Label                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| First visible Details   | `#detail` is shown (`offsetWidth > 0`, not `display: none`).                                                  | `visibleMs` 439–1058 ms across 10 trials.                                                                              | MEASURED                                    |
| Usable Details          | Title, description, and a working Play or Sources action are on screen. Owner must accept the marker.         | No marker. `contentMs` is 90% of the maximum text length in the 12 s window. That is a text proxy, not this milestone. | NOT_RUN                                     |
| Full enrichment         | Cast, comments, related titles, collection, watched badge, and TMDB art have finished.                        | `settledMs` is a DOM-stability proxy only. It does not prove which enrichment finished, or that enrichment finished.   | Proxy MEASURED. Semantic enrichment NOT_RUN |
| Trailer readiness       | First visible trailer frame, or an explicit no-trailer result. An embed URL is not this.                      | Details script does not record it. See `lab/TRAILER-PIPELINE.md`.                                                      | NOT_RUN                                     |
| First selectable source | Sources shows a row the user can focus that came from a returned stream. Not playback. The URL is not logged. | `displayChunkGroups` can paint a chunk (`streamScreenMethods-04-load-streams.js:158`). Time NOT_RUN.                   | NOT_RUN                                     |

Do not add these times together. They overlap, and four of them have no television number.

## What is already settled

| Claim                                                                                                                                                                                           | Label             | Evidence                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------- |
| After 0.4 s on a new card, Details settles in a median of 5853 ms (n=5). Range 5194–6056 ms.                                                                                                    | MEASURED          | `lab/results/tv/2026-10-14_details_open/details.json` plus `..._dwell2s/details.json` |
| After 5 s, settle median is 2078 ms (n=3). `lab/FINDINGS.md` rounds this to about 2.0 s.                                                                                                        | MEASURED          | same, dwell trials in the first file                                                  |
| After 2 s, settle median is 3936 ms (n=2).                                                                                                                                                      | MEASURED          | dwell trials in the second file                                                       |
| Screen visible is 439–1058 ms. That is not usable Details and not a playable source.                                                                                                            | MEASURED          | `visibleMs` in both files                                                             |
| Text at 90% of the 12 s window median is 1811 ms cold, 2078 ms after 5 s, about 1.5 s after 2 s.                                                                                                | MEASURED          | `contentMs`. This is a text-length proxy, not a product marker.                       |
| On the 4 trials that recorded resources, settle ends 83–115 ms after the last XHR/fetch.                                                                                                        | MEASURED          | `settledMs` versus `lastRequestEndMs` in the 2 s file                                 |
| Those 4 trials made 6–8 XHR/fetch calls: Cinemeta 1, TMDB 1–2, Trakt 3–5. One trial also hit `catalog.nuvio.tv` once.                                                                           | MEASURED          | host counts only. Paths are UNKNOWN.                                                  |
| The 5 s file recorded 0 resources because the resource-timing buffer was already full. That is missing data, not proof of zero requests.                                                        | MEASURED          | script comment in `lab/perf/details.mjs`; empty `requestHosts`                        |
| Every trial recorded 1122–1832 ms of long-task duration, summed. Worst single entry 603–957 ms.                                                                                                 | MEASURED sum only | `longTaskMs`, `worstLongTaskMs`. Saved JSON has totals, not start times.              |
| 83 real rows scroll slower than 20 real rows on the TV. Hiding rows with `display: none` did not fix it.                                                                                        | MEASURED          | `lab/FINDINGS.md`, `lab/README.md`                                                    |
| Unpromoting every track cut layer memory and made warm scrolling worse (L4 46.5 fps versus L5 41.8 fps).                                                                                        | MEASURED          | `lab/results/tv`. Do not repeat.                                                      |
| Row-window v1, switch on, did not raise emulator fps. 20-row fps 56.6/56.5 off versus 55.2/55.1 on. 83-row 58.4/57.3 off versus 55.6/55.9 on.                                                   | SYNTHETIC         | `lab/FINDINGS.md` row-window table. Chromium 92, throttle 6.8, Reduced.               |
| Television measurement of `labRowWindow` is NOT_RUN. The switch stays off. `isLabRowWindowEnabled` is true only when `localStorage.labRowWindow === "1"`, read once (`homeRowWindow.js:16-24`). | NOT_RUN           | Do not enable from the layer-memory drop alone.                                       |

## Request map

Times below are code budgets, not measured durations, unless the table says MEASURED.

| Step                      | Owner                                                       | What it does                                                                                                                                                                                                                                  | Blocks first paint?                                                                                                              | Label                                                           |
| ------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Home catalogs             | `homeScreenMethods-21-load-data.js`, `catalogRepository.js` | Reduced: 5 catalogs, then batches of 4, no prefetch of the next batch. Full webOS: first 6, then batches of 8, and may overlap 8 more. `getInitialCatalogLoadCount` / `getDeferredCatalogBatchSize`.                                          | First rows paint as each catalog returns. A background refresh does not paint partial rows over a full Home.                     | PROVEN                                                          |
| Catalog cache             | `catalogRepository.getCatalog`                              | Key is addon, type, catalog, skip, extra args. Completed rows are cached. There is no in-flight map, so a second call while the first is pending duplicates the request. The loader comment says this on purpose and keeps the first promise. | No                                                                                                                               | PROVEN                                                          |
| Hero metadata             | `homeScreenMethods-11-enrich-current-hero-async.js:160`     | `metaRepository.getMetaFromAllAddons` when focus settles. Races a 4 s timeout. The repository call is not cancelled; a late success can still commit.                                                                                         | No. Hero can fall back and update later.                                                                                         | PROVEN                                                          |
| Hero TMDB                 | `fetchModernHeroTmdbEnrichment`                             | `ensureTmdbId` budget 1.8 s, then `fetchEnrichment` budget 2.2 s.                                                                                                                                                                             | No                                                                                                                               | PROVEN                                                          |
| Details all-addon meta    | `metaDetailsScreenMethods-03-load-detail.js:62`             | Same `getMetaFromAllAddons`. Cache key `all:{type}:{id}`.                                                                                                                                                                                     | The screen renders the merged meta it already has, then keeps enriching. Exact "first usable" marker NOT_RUN.                    | PROVEN + NOT_RUN                                                |
| Details source-addon meta | same file, line 64                                          | Separate `getMeta` on the catalog addon, budget 1.8 s. Not started by the hero.                                                                                                                                                               | Can delay richer meta. The one Cinemeta call after a 2 s rest is consistent with this, but the path was not logged.              | PROVEN path, INFERRED match to the host count                   |
| Details TMDB              | `enrichMeta`, budget 4 s, then cast fallback budget 3.2 s   | `fetchEnrichment` has no shared cache with the hero call.                                                                                                                                                                                     | After first `render(meta)`.                                                                                                      | PROVEN. Duplicate-versus-hero is INFERRED.                      |
| More like this            | `fetchMoreLikeThis`, budget 5 s                             | Independent of enrichment. May call Trakt related.                                                                                                                                                                                            | No                                                                                                                               | PROVEN                                                          |
| Trakt comments            | `loadTraktComments`                                         | Only if comments are enabled, the user is signed in, and the title type is supported. Called twice in one open: once after first render, again after enrichment. The second call aborts the first.                                            | No                                                                                                                               | PROVEN. Whether the measured 3–5 calls include this is UNKNOWN. |
| Watched enrichment        | `detailWatchedEnrichmentService.js`                         | Series: one `/shows/{id}/progress/watched`. Movie: paged `/sync/watched/movies`. Local cache TTL 30 min, keyed by profile, content id, Trakt id.                                                                                              | No                                                                                                                               | PROVEN candidate, not tied to a measured URL                    |
| Sources                   | `streamRepository.getStreamsFromAllAddons`                  | All eligible addons start together (`installedAddons.map`). 60 s timeout each. Shared session cache, 15 min TTL, max 12 entries, key includes profile, type, id, season, episode, addon configuration.                                        | First non-empty chunk can render before the slowest addon. `displayChunkGroups` in `streamScreenMethods-04-load-streams.js:158`. | PROVEN. First-source time NOT_RUN.                              |
| Source list DOM           | `streamVirtualizer.js`                                      | Above 100 items, only a window is mounted. Threshold 100, minimum window 20, overscan 720 px.                                                                                                                                                 | No                                                                                                                               | PROVEN. Do not rebuild this.                                    |

Addon manifests are data. This review did not execute any manifest.

## Cache identity

| Store                                 | Key                                                           | In-flight share                           | TTL / cap                        | Gap                                                           |
| ------------------------------------- | ------------------------------------------------------------- | ----------------------------------------- | -------------------------------- | ------------------------------------------------------------- |
| `metaRepository.metaCache`            | `{addon}:{type}:{id}` and `all:{type}:{id}`                   | Yes, `inFlightMeta` and `inFlightMetaAll` | None. Map grows for the session. | PROVEN. Memory risk on a 1.3 GB TV is INFERRED, not measured. |
| `catalogRepository.catalogCache`      | addon + type + catalog + skip + extras                        | No                                        | Cleared by generation bump       | Duplicate in-flight is PROVEN.                                |
| `TmdbMetadataService.fetchEnrichment` | none in the method                                            | No                                        | none                             | PROVEN. A shared key would be PROPOSED, not built here.       |
| `detailWatchedEnrichmentService`      | profile + content id + Trakt id                               | not read as a single-flight map           | 30 min                           | PROVEN TTL.                                                   |
| `streamSearchSessionCache`            | profile, type, video id, season, episode, addon configuration | Yes, `observe`                            | 15 min, 12 entries               | PROVEN. This is the pattern to copy, not a new cache.         |

Do not add TanStack Query, a second cache, or a proxy. If a later experiment shares requests, it belongs in these owners.

JSON parse is on the main thread: TMDB uses `response.json()` in `tmdbMetadataServiceMethods-01-fetch-enrichment.js`. Catalog and meta bodies are parsed in the API clients before the repositories map them. No parse worker exists. A worker is PROPOSED only after a television stack shows parse time inside the 1.1–1.8 s long tasks. Workers cannot update the DOM, so they cannot remove render work.

## Dependency graph

```
Home focus settles
  ├─ getMetaFromAllAddons(type, id)          cached, shared in flight
  └─ fetchEnrichment(tmdbId)                 not shared with Details
OK
  Details
    ├─ render(current meta)                  visibleMs
    ├─ getMetaFromAllAddons                  usually cache hit after a rest
    ├─ getMeta(source addon)                 not prefetched, 1.8 s budget
    ├─ enrichMeta → fetchEnrichment          4 s budget, no hero cache
    ├─ cast fallback                         3.2 s budget, only if cast empty
    ├─ more like this / Trakt related        independent
    ├─ Trakt comments                        aborted and restarted
    └─ watched enrichment                    may page all watched movies
Sources (separate screen, NOT_RUN)
  └─ all eligible addons in parallel, first chunk paints, virtualize above 100
```

Parallel arrows must not be added together. The 4 s TMDB budget and the 1.8 s source-meta budget overlap. MEASURED settle time is one end-to-end proxy. It is not usable Details, trailer readiness, or first selectable source.

## Long tasks are not a proven floor

MEASURED: each of the 10 trials recorded a sum of long-task durations between 1122 ms and 1832 ms (`lab/results/tv/2026-10-14_details_open/details.json`, `lab/results/tv/2026-10-14_details_open_dwell2s/details.json`). The worst single entry was 603–957 ms.

NOT proven, and must not be written as a floor:

- The sum is not serial time. Overlapping or nested entries would be counted more than once. The committed JSON does not keep start times, so overlap is UNKNOWN.
- No CPU stack names the functions. `lab/perf/prof.mjs` can start `Profiler.enable`, but it drives the Home D-pad suite. A Details profile is NOT_RUN.
- Nothing shows these tasks sit on the critical path, block first visible Details, or cannot overlap the network wait.
- Prefetch already changed settle time (about 5.9 s cold versus about 2.1 s after 5 s) while long-task sums stayed in the same band. That does not prove the band is a floor. It only shows the recorded sum did not fall with that prefetch.

E1 in `lab/EXPERIMENT-BACKLOG.md` is the profile. It is not part of this handoff.

## Why row-window v1 is slower on the emulator

PROVEN mechanism: `homeRowWindow.js` keeps catalog objects and replaces the row element. `template.innerHTML` then `section.replaceWith` runs when focus moves outside the mounted band (`LAB_ROW_WINDOW_RADIUS` is 2). Placeholders have the same outer height and no posters.

SYNTHETIC, 20 rows, A/B/A/B, switch off then on:

|                       | Off             | On                |
| --------------------- | --------------- | ----------------- |
| Layers / layer memory | 49 / 173 MB     | 15 / 46 MB        |
| Frame rate            | 56.6 then 56.5  | 55.2 then 55.1    |
| Frames over 50 ms     | 9 then 9        | 10 then 7         |
| CompositeLayers       | 63 then 68 ms   | 126 then 148 ms   |
| Paint                 | 30 then 32 ms   | 68 then 62 ms     |
| Tile worker           | 868 then 982 ms | 1482 then 1415 ms |
| `focusNode`           | 105 then 109 ms | 380 then 357 ms   |

83-row switch-on runs stayed at 15 layers and 46 MB, with fps still slightly down and 8–10 frames over 50 ms. The suite only moves 8 rows, so it does not measure a deep walk. SYNTHETIC.

INFERRED cause, not a television verdict: the emulator has no 250 MB GPU cap, so keeping every promoted row was cheap for frame rate. The window pays parse, node create, style, paint, and image raster on the key that enters a new row. That matches `focusNode` roughly tripling and tile-worker time rising. It is the same class of miss as unpromote: fewer layers moved cost into work the key has to wait for.

Null result already recorded: "fewer layers" did not raise fps here. Do not enable the switch. Do not try a third layers-only variant.

## v2 hypothesis

**Hypothesis.** The emulator loss is reconstruction on the key path, not the layer count. If the next row is already a real mounted row before Down, `focusNode` and frames over 50 ms move back toward the all-mounted run, while layer count stays near the windowed run.

**Null.** Pre-mounting that row does not cut `focusNode` or slow frames. The cost is then the placeholder layout, the nav rebuild, or something the trace has not named. Stop. Do not add another radius.

**Why this shape.** Enact scrolls a virtual list with `scrollMode: 'translate'` and keeps a mounted window. That file is not in this repo: https://github.com/enactjs/enact/blob/master/packages/ui/VirtualList/VirtualList.js. A Russian virtual-list note says to keep a fixed node pool, rewrite content, then focus the node that now represents the index (https://purpleschool.ru/knowledge-base/vue/performance/virtual_scrolling). A Chinese note says the same: if the first index did not change, do not rebuild the DOM (https://juejin.cn/post/7090119175133200398). v1 does the opposite on the boundary: it parses a new section string.

**Smallest change.** One experiment branch. In `homeRowWindow.js` only: keep one extra real row ahead of the move, and update an existing row node instead of `replaceWith` when the band slides. Do not change radius, poster size, or promotion. Switch stays default off.

**Expected direction.** No percentage. SYNTHETIC `focusNode` should fall toward the off-switch ~105 ms, and frames over 50 ms toward the off-switch count. Layer count should stay far below 175. Television direction is UNKNOWN until a warm A/B/B/A. If television fps does not rise, REJECT even if the emulator `focusNode` falls.

**Risk.** A pool can restore the wrong card, lose `scrollLeft`, or break Back. The existing break check (`lab/perf/row-window-check.mjs`) must pass before any television run. Session branch cannot be renamed to `perf/row-window`.

## What not to do

- Do not turn `labRowWindow` on.
- Do not unpromote tracks again.
- Do not shrink posters to chase frame rate. `w342` versus `w500` already halved decode and left fps flat. MEASURED, prior lab.
- Do not replace JPEG globally, and do not clear image `src` to save memory, without a television first-load or return-scroll measurement.
- Do not sum the 1.8 s, 4 s, and 3.2 s budgets.
- Do not treat the 1.1–1.8 s long-task sum as an unavoidable floor.
- Do not treat settle time as usable Details, full enrichment, trailer readiness, or first selectable source.
- Do not log addon URLs, tokens, or titles while closing the path gap.
