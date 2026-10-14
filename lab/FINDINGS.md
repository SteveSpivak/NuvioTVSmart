# Findings

**Every Home row is forced onto its own wide compositing layer, and that switch is off for the television's Chromium 94.** A one-line cutoff change turns the existing unpromote path on. Emulator layer memory fell from about 173 megabytes to 8. Frame rate did not change here, so this is not a television speed claim until the owner measures it.

This session could not create `perf/<idea>` branches. The cutoff change is on `arena/0ffafbca-nuvio-perf-lab`. Agent skills were NOT_AVAILABLE.

## Update 2026-10-14: television result for the unpromote idea

**Rejected as a speed fix. On the television, unpromoting the Home tracks lowered warm frame rate (46.5 to 41.8) and roughly doubled compositing and paint time. It did cut layer memory from about 170 megabytes to 8.** MEASURED. Do not merge the `<= 94` cutoff from `arena/0ffafbca-nuvio-perf-lab`.

Method: Nuvio 1.2.5-lg1 on the LG 65UR78006LL, 20 rows, effects Reduced, default 38-key suite. No install. The class `webos-unpromoted-home-tracks` was added to `<html>` and `<body>` on the live page through the debug port, then removed. That is what the cutoff change does at startup. Runs alternated with and without the class after the app was restarted.

| Run (`lab/results/tv/`)    | Tracks promoted | Frames per second | Frames over 50 ms | Worst frame | Long tasks total | CompositeLayers | Paint      | Tile worker busy | Layers | Layer memory |
| -------------------------- | --------------- | ----------------- | ----------------- | ----------- | ---------------- | --------------- | ---------- | ---------------- | ------ | ------------ |
| `2026-10-14_L2_promoted`   | yes             | 32.0              | 66                | 600 ms      | 5464 ms          | 1400 ms         | 346 ms     | 3351 ms          | 67     | 168 MB       |
| `2026-10-14_L3_unpromoted` | no              | 40.7              | 49                | 217 ms      | 2479 ms          | 2112 ms         | 925 ms     | 4510 ms          | 8      | 8 MB         |
| `2026-10-14_L4_promoted`   | yes             | **46.5**          | **29**            | 283 ms      | **1911 ms**      | **1285 ms**     | **323 ms** | **2842 ms**      | 67     | 170 MB       |
| `2026-10-14_L5_unpromoted` | no              | 41.8              | 45                | **200 ms**  | 2774 ms          | 2847 ms         | 895 ms     | 6114 ms          | 8      | **8 MB**     |

How to read it:

- Frame rate rose with every run as the app warmed up after a restart (32, 41, 46.5). Compare the two warm runs, L4 and L5.
- Unpromoted wins only on worst frame and layer memory. It loses on frame rate, slow frames, compositing, paint and raster.
- Same shape as the rejected `content-visibility` test: fewer layers, more paint. The emulator flagged this too (raster time rose, frame rate flat).
- `2026-10-14_L1_promoted` (24.3 frames per second) ran right after a television restart and is not comparable.
- Open: memory may still matter at 83 rows, where promoted layers exceeded the 250 megabyte cap. Not tested.

Next idea: row windowing. Keep only rows near the focus in the document, as Stremio's visible-catalog window does. That removes layers and paint together, instead of trading one for the other.

## Update 2026-10-14: details-open time on the television

**Background loading already works: after resting 5 seconds on a card, details settle in about 2.0 seconds instead of about 5.9. A 2 second rest gives about half that gain (3.9 seconds). About 1.3 seconds of main-thread work happens on every open and is the floor that prefetching cannot remove.** MEASURED, 10 trials.

Method: `lab/perf/details.mjs` on Nuvio 1.2.5-lg1, title rows only (never Continue Watching, so OK cannot start playback). Each trial focuses a new card, waits, presses OK, records for 12 seconds, presses Back once. Order cold/dwell/dwell/cold. "Settled" is the last change in text length or element count of `#detail`.

| Rest on card before OK | Trials | Screen visible | Text shown (median) | Settled (median) | Main-thread long tasks |
| ---------------------- | ------ | -------------- | ------------------- | ---------------- | ---------------------- |
| 0.4 s (cold)           | 5      | 0.4–0.9 s      | 1.8 s               | 5.9 s            | 1.2–1.8 s              |
| 2 s                    | 2      | 0.7–0.8 s      | 1.5 s               | 3.9 s            | 1.2–1.3 s              |
| 5 s                    | 3      | 0.7–1.1 s      | 2.0 s               | 2.0 s            | 1.1–1.5 s              |

Results: `lab/results/tv/2026-10-14_details_open/` (5 s rest, no request data: the page's resource-timing buffer was full, fixed in the script afterwards) and `lab/results/tv/2026-10-14_details_open_dwell2s/` (2 s rest, with request data).

What the code shows (VERIFIED):

- The Home hero calls `metaRepository.getMetaFromAllAddons` when focus settles (`homeScreenMethods-11-enrich-current-hero-async.js:160`). The details screen calls the same function (`metaDetailsScreenMethods-03-load-detail.js:62`), and `metaRepository` caches it. That is the existing prefetch.
- Not prefetched: the source-addon `getMeta` (waits up to 1.8 s), `enrichMeta` with TMDB (up to 4 s) and the TMDB cast fallback (up to 3.2 s).
- `metaCache` has no size limit. On a 1.3 GB television this may matter over a long session (INFERRED).

What the measurements show:

- Settled time ends within about 0.1 s of the last network request (4 trials with request data). The late part is network: Trakt 3–5 requests, TMDB 1–2, Cinemeta 1 per open.
- 1.1–1.8 s of long tasks (worst single task 0.6–0.96 s) appear in every trial, with or without prefetch. Cause UNKNOWN.

Next ideas, one branch each:

1. `perf/details-prefetch`: when the hero commits, also prefetch the source-addon meta and the TMDB enrichment. One request in flight, cancel when focus moves, cap the cache. Target: settled time after a 2 s rest close to the 5 s result.
2. `perf/details-trakt`: check whether the 3–5 Trakt requests per open repeat or could be cached or deferred.
3. `perf/details-render`: profile the ~1.3 s of main-thread work on open (CPU profile around OK). This is the only way below about 2 seconds.

## Setup

| Step                                                                | Result                                                                 |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `lab/emu/setup.sh`                                                  | ❌ Failed at package install. Debian mirrors unreachable. Exit 100.    |
| Second attempt: other Debian mirrors and the Chromium snapshot host | ❌ Failed. Stopped, as required after two attempts.                    |
| `xvfb-run` and Chromium 94 snapshot 911494                          | ❌ Missing. Not installed.                                             |
| `npm ci` and `npm run build`                                        | ✅ Succeeded. Used `local.example.properties`. No keys added.          |
| Emulator                                                            | ⚠️ Ran, then stopped. Not the specified browser. See the caveat below. |
| Calibration                                                         | ✅ Ran. Suggested throttle 6.8.                                        |
| `base_20rows` suite                                                 | ✅ 38 presses, not aborted.                                            |

**Browser caveat, read this before any emulator number.** The process was HeadlessChrome 92.0.4512.0 from the npm package `@sparticuz/chromium@92.0.0`, plus NSPR 4.20 built from the public `mozilla/nspr` tag `NSPR_4_20_RTM`. The user agent was spoofed to the television's Chrome 94 string, so the application version check sees 94. It is not snapshot 911494. There was no X virtual framebuffer. Numbers below are SYNTHETIC. They are not television speed.

Calibration, unthrottled emulator versus the television file `lab/emu/calibration-tv.json`:

| Part       | Television median, MEASURED in that file | Emulator median, SYNTHETIC | Ratio |
| ---------- | ---------------------------------------- | -------------------------- | ----- |
| JavaScript | 595 milliseconds                         | 92 milliseconds            | 6.5   |
| JSON       | 252 milliseconds                         | 37 milliseconds            | 6.8   |
| DOM        | 2749 milliseconds                        | 311 milliseconds           | 8.8   |
| Style      | 5009 milliseconds                        | 778 milliseconds           | 6.4   |

Suggested throttle is the middle ratio, 6.8. Later runs used that throttle.

## Causes, ranked

| Rank | Cause                                                                                  | Evidence                                                                                                                                                                                                                       | Label                                                                          | Fix                                                                                             |
| ---- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| 1    | Too many Home rows stay in the page                                                    | Television: 83 rows about 37 to 38 frames per second and 5.9 to 6.7 seconds of stall time; 20 real rows about 49 frames per second and 1.2 seconds. Hiding extra rows with `display: none` barely moved frame rate (about 40). | MEASURED, read from `lab/results/tv` and `lab/README.md` this session          | Remove off-screen rows from the document. Not implemented. `content-visibility` stays rejected. |
| 2    | `translateZ(0)` on every `.home-track`, and the unpromote class stopped at Chromium 87 | Television record: 256 layers and about 140 to 150 megapixels at 83 rows. Emulator: 49 layers and 45 megapixels at 20 rows; removing the promotion dropped that to 8 layers and 2 megapixels.                                  | MEASURED for the television record. SYNTHETIC and VERIFIED for the layer drop. | Implemented: unpromote through Chromium 94. Television frame rate NOT_RUN.                      |
| 3    | Full effects do more compositing work per key                                          | Emulator main thread busy 894 milliseconds reduced versus 3650 milliseconds full, same 38 keys. Frame rate 57.9 versus 57.7.                                                                                                   | SYNTHETIC. Television full mode NOT_RUN.                                       | Do not ship a motion change from this alone. Measure full versus reduced on the television.     |
| 4    | First pass while posters load                                                          | Laboratory record: worst frame about 1 second, cold Home about 45 seconds. This session did not retime the television. Emulator ready time was 8.0 to 10.6 seconds and is not that number.                                     | MEASURED only as stated in `lab/README.md`. Startup retime NOT_RUN.            | Bound the first catalog batch and image decode. Already partly done for reduced mode.           |
| 5    | Live page holds far more nodes than Home                                               | Laboratory record: 135 thousand to 247 thousand nodes, Home about 10 thousand. Guest emulator Home had about 3.4 thousand elements. The extra nodes were not reproduced.                                                       | MEASURED as stated in the laboratory record. Cause UNKNOWN.                    | Do not guess a fix.                                                                             |

Rejected earlier, still rejected: `content-visibility: auto` on rows, smaller `w342` posters, and drawing at 1080p (it already does).

## Question 1. Animations on versus off

**Full effects did not lower emulator frame rate. They did multiply compositing work.** That comparison is confounded, and the standard key sequence never waits long enough for backdrop expansion.

Same throttle 6.8, 20 rows, same 38-key sequence. SYNTHETIC.

|                             | Reduced `base_20rows`       | Full `full_20rows`           |
| --------------------------- | --------------------------- | ---------------------------- |
| Effects class               | constrained, stored reduced | not constrained, stored full |
| Frame rate                  | 57.9                        | 57.7                         |
| Worst frame                 | 83 milliseconds             | 67 milliseconds              |
| Frames over 50 milliseconds | 1                           | 4                            |
| Main thread busy            | 894 milliseconds            | 3650 milliseconds            |
| Task duration               | 2134 milliseconds           | 3290 milliseconds            |
| Layer updates               | 4013                        | 31316                        |
| Layers                      | 49                          | 49                           |
| Ready time                  | 8096 milliseconds           | 10551 milliseconds           |
| Cards                       | 290                         | 300                          |

Confounders, VERIFIED in code this session:

- Reduced mode is not only a CSS animation switch. It also changes catalog batch size, items per row (10 versus 15 in code), scroll duration, and hero transition mode.
- In this guest addon the card count only moved from 290 to 300, so the item-limit confounder was small here. It will not be small on a real account.
- Focus expansion animates width and flex basis, which are layout properties, not compositor-only properties. Reduced mode sets those transitions to none.
- Backdrop expansion waits 3 seconds (`focusedPosterBackdropExpandDelaySeconds`). The 38-key sequence pauses at most 600 milliseconds, so it does not expand. A separate 4 second dwell on the full-effects page grew the focused card from 229 pixels to 610 pixels and added the class `is-expanded`. VERIFIED.

Short isolation on the already-open full page, 10 keys, SYNTHETIC. Frame rate stayed about 58.

| Change                                   | Style recalc    | Task duration    | Worst frame     |
| ---------------------------------------- | --------------- | ---------------- | --------------- |
| Full, no injection                       | 52 milliseconds | 798 milliseconds | 50 milliseconds |
| Width and opacity transitions forced off | 16 milliseconds | 782 milliseconds | 33 milliseconds |
| That, plus card depth class removed      | 18 milliseconds | 683 milliseconds | 33 milliseconds |

Card depth is a static edge and sheen, not the scrolling cost. One backdrop expansion added raster work (277 versus 155 milliseconds on a 6 second dwell) but not a multi-second stall on this emulator. The large full-versus-reduced gap in the 38-key run is the combination of animated scroll, hero crossfade, and focus width changes. Which one dominates on the television is UNKNOWN until a television run.

## Question 2. Home architecture

**The row cost is a compositing layer per track, not JavaScript.** `.home-track` sets `transform: translateZ(0)` in `css/components-14.css`. Scrolling uses `scrollLeft`, not a script transform. The class `webos-unpromoted-home-tracks` already sets `transform: none` for modern tracks, but `js/app.js` only added that class for Chromium 87 and older. The television is Chromium 94, so every track stayed promoted.

Live toggle on the reduced 20-row page, same session, SYNTHETIC and causal:

|                        | Promoted          | Unpromoted        |
| ---------------------- | ----------------- | ----------------- |
| Layers                 | 49                | 8                 |
| Megapixels             | 45                | 2                 |
| Estimated layer memory | 173 megabytes     | 8 megabytes       |
| Biggest track layer    | about 5300 by 347 | none of that size |

Restoring the class brought the 49 layers back. The built cutoff change (`<= 94`) applied the class by itself under the spoofed Chrome 94 user agent. Suite `unpromote94_20rows`: 38 presses, not aborted, 8 layers, 2 megapixels, frame rate 56.0. Fresh promoted baseline frame rate was 57.9. Raster-worker busy time rose (about 908 milliseconds promoted fresh versus 2050 milliseconds unpromoted). Same shape as the rejected `content-visibility` result: fewer layers, another cost up, frame rate flat. This emulator does not copy the television graphics processor or the 250 megabyte graphics cap, so a flat frame rate here does not mean the television will be flat.

`content-visibility` stays rejected. Television trace `B_cvOn` versus `A_cvOff`: compositing on the main thread about 3909 versus 1902 milliseconds, frame rate 36.4 versus 37.6. MEASURED, read this session.

Hiding rows is not enough either. `T_23rows` used `display: none` and stayed near 40 frames per second. Real 20-row trim (`R2_trimmed`) reached 49. A virtualization fix has to remove off-screen rows from the document, not hide them. Not implemented. Implementing it without a television run would be a large navigation risk.

## Question 3. Startup

Emulator ready time is SYNTHETIC and much shorter than the laboratory's stated 45 second cold start. NOT a television measurement.

Reduced, throttle 6.8, from the emulator log: blank at 1.4 seconds, profile picker at 1.9 seconds, Home with zero rows at 4.3 seconds, 5 rows with images pending at 5.0 seconds, 20 rows and visible posters loaded at 8.0 seconds. Full effects reached ready at 10.6 seconds.

Code, VERIFIED: reduced mode loads 5 catalogs first, then batches of 4, and does not prefetch the next batch. Full mode can prefetch. The emulator also presses Enter on the profile picker. The fake addon adds 150 milliseconds of latency. Real account addons, images, and the television network are not in this run. What blocks the 45 second television start remains UNKNOWN beyond "catalog batches plus poster decode." Retime NOT_RUN.

## Question 4. Transitions

Home to details to sources was NOT_RUN. No timing claim.

## Question 5. Other applications

See `lab/RESEARCH.md`. The useful pattern is Stremio loading only the visible catalog window, and Enact using a virtual list instead of one promoted layer per row. Lightning avoids the document compositor entirely by drawing with WebGL. That is a rewrite, not a patch.

## Question 6. Image format

WebP versus JPEG is NOT_RUN. The earlier `w342` versus `w500` test already halved decode time and left frame rate unchanged. A smaller file is not a reason to expect a scrolling win. Do not repeat that test unless the measurement is first-load time, not frame rate.

## What the owner should measure

Build this branch. Effects stay Reduced unless the label says full. Same 38-key suite unless noted. Emulator numbers are not a pass.

| Priority | Label                | What changed                                         | Watch for                                                                      |
| -------- | -------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1        | `unpromote94_20rows` | This branch, Chromium 94 unpromote, 20 rows, Reduced | Layers and frame rate versus `R2_trimmed`. Reject if frame rate does not rise. |
| 2        | `unpromote94_83rows` | Same build, 83 rows if the account still has them    | Layers versus the 256-layer record. Memory versus the 250 megabyte cap.        |
| 3        | `full_20rows`        | Effects Full, 20 rows, current release behavior      | Main-thread busy time and frame rate versus a paired Reduced run.              |
| 4        | `expand_dwell`       | Full, one key, then wait 4 seconds                   | Backdrop expansion only. The normal suite does not see it.                     |

Command shape, on the television tunnel:

```sh
CDP_URL=http://127.0.0.1:19998 DEVICE=tv lab/perf/run-suite.sh unpromote94_20rows
```

## Next decision

Measure `unpromote94_20rows` on the television before any more code. If frame rate does not improve, revert the cutoff. Row removal is the next idea only after that result.

## 2026-10-14 update: Trakt watched-list reuse (`watchedMemo`), TV A/B

Branch `perf/watched-remote-memo`, installed side by side as "Nuvio Lab" (`space.nuvio.lab`) and switched with
localStorage `nuvioLabOff`. Runner `lab/perf/details_ab.mjs`, blocks A/B/B/A, opens cold/dwell/dwell/cold,
CPU profile per open. Data: `lab/results/tv/2026-10-14r3_ab_watchedMemo_*`, summary in
`2026-10-14r3_ab_watchedMemo.summary.txt`. All numbers MEASURED, medians, n = 4 per cell.

| Cold opens                             | Fix on | Fix off |
| -------------------------------------- | ------ | ------- |
| Text content shown (ms)                | 3302   | 4740    |
| Settled (ms)                           | 5524   | 5529    |
| Worst long task (ms)                   | 386    | 1127    |
| CPU in watched-identity functions (ms) | 472    | 868     |

Dwell opens showed no difference. One open with the fix on froze for 13 s (block 4A, trial 2).

Decision: **UNKNOWN**. The direction favours the fix on cold opens, but n is small and settle time did not move.
Do not merge on this evidence.

Findings from the profiles (MEASURED, cause VERIFIED in the profile call trees):

1. The 13 s freeze was on Home, not in details: `getTitleWatchedItems` spent 6.0 s in
   `watchedItemsShareIdentity` (5.1 s) after the reload refreshed the rows. It compares every row item with every
   watched item and rebuilds identity strings and RegExps each time. The memo does not touch this path. The
   blocked thread made the app read OK as a long press and open the card menu; `details.mjs` now closes it with Back.
2. A cold open with the fix off spent 2.2 s in `getInstalledAddons`, mostly `readProfileScopedValue` and
   `canonicalizeUrl`: addon settings are parsed from localStorage and normalized again on every metadata lookup.

Next decision: an identity-key index for `getTitleWatchedItems` and `buildEpisodeState` (one Set lookup per item),
which addresses finding 1 and the details cost together. Then a cache for the parsed addon state (finding 2).

## 2026-10-14 update: watched identity index (`identityIndex`), TV A/B

Branch `perf/watched-identity-index`, fix commit `7d58ca7` (built on the unmerged `watchedMemo` commit `8b7c46a`).
Switch: localStorage `nuvioLabOff=identityIndex` turns the fix off. The index is built per call and never stored,
so it needs no invalidation and holds no memory after the call.

Correctness (SYNTHETIC, `lab/checks/watched-identity-index.test.mjs`): 4 of 4 pass. 20,000 seeded random cases give
the same answer as pairwise matching; Home projection and details episode state are identical with the fix on and
off. Home projection of 300 shows: 35.4 ms off, 3.9 ms on.

Details opens, A/B/B/A x C/D/D/C (MEASURED, n = 8 per side, `2026-10-14_ab_identityIndex.summary.txt`):

| Median                                 | Fix on | Fix off |
| -------------------------------------- | ------ | ------- |
| Watched-matching CPU, all opens        | 256 ms | 380 ms  |
| Watched-matching CPU, after Home dwell | 370 ms | 2408 ms |
| Worst long task                        | 483 ms | 677 ms  |
| Freezes that opened the card menu      | 0      | 2       |

Home reload, A/B/B/A/A/B/B/A, 30 s each, no keys (MEASURED, n = 4 per side,
`2026-10-14_home_identityIndex.summary.txt`):

| Median                               | Fix on   | Fix off  |
| ------------------------------------ | -------- | -------- |
| `getTitleWatchedItems` inclusive CPU | 506 ms   | 446 ms   |
| Long tasks total                     | 12996 ms | 13246 ms |
| Worst long task                      | 1148 ms  | 1144 ms  |

Cards loaded in 30 s varied from 186 to 323 between blocks, so the totals are only roughly comparable.

Reading:

1. On a fresh Home load the matching costs about 0.5 s either way. The fix does not help there. (MEASURED)
2. The 6 s Home cost and the card-menu freezes appear only after Home has been open and refreshed several times.
   There the fix cuts watched-matching CPU about 6x. (MEASURED in details dwell opens; Home dwell NOT_RUN)
3. Likely cause of that growth: `refreshWatchedTitleState` may append fully-watched markers to `this.watchedItems` on
   every refresh, so the list grows. (INFERRED, not tested; separate hypothesis)

Not run: profile switching, mark watched/unwatched on TV, D-pad latency, frame stalls, peak memory.

Decision: **UNKNOWN**. Equivalent results and a clear win in the long-dwell state, but no win on a cold Home load
and the root cause of the growth is untested. Do not merge. Next: test the marker-growth hypothesis on its own
branch, then re-measure Home after dwell with this fix on and off.
