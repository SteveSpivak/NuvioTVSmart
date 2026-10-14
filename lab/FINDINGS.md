# Findings

**Unpromoting Home tracks is rejected as a speed fix.** On the television, warm frame rate fell from 46.5 to 41.8, and paint and compositing roughly doubled. The next idea is row windowing: keep only rows near the focus in the document, so layers and paint leave together.

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

| Rank | Cause                                         | Evidence                                                                                                                                                                                                                       | Label                                                                     | Fix                                                                                                                 |
| ---- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1    | Too many Home rows stay in the page           | Television: 83 rows about 37 to 38 frames per second and 5.9 to 6.7 seconds of stall time; 20 real rows about 49 frames per second and 1.2 seconds. Hiding extra rows with `display: none` barely moved frame rate (about 40). | MEASURED, read from `lab/results/tv` and `lab/README.md` this session     | Row window is implemented behind `labRowWindow`, default off. Emulator frame rate did not rise. Television NOT_RUN. |
| 2    | `translateZ(0)` on every `.home-track`        | Television L4 versus L5: unpromoting cut layer memory 170 to 8 megabytes but frame rate 46.5 to 41.8, compositing 1285 to 2847 milliseconds, paint 323 to 895.                                                                 | MEASURED. REJECTED as a speed fix. Do not try a third layer-only variant. | Keep promotion on mounted rows. Remove off-screen rows instead.                                                     |
| 3    | Full effects do more compositing work per key | Emulator main thread busy 894 milliseconds reduced versus 3650 milliseconds full, same 38 keys. Frame rate 57.9 versus 57.7.                                                                                                   | SYNTHETIC. Television full mode NOT_RUN.                                  | Do not ship a motion change from this alone. Measure full versus reduced on the television.                         |
| 4    | First pass while posters load                 | Laboratory record: worst frame about 1 second, cold Home about 45 seconds. This session did not retime the television. Emulator ready time was 8.0 to 10.6 seconds and is not that number.                                     | MEASURED only as stated in `lab/README.md`. Startup retime NOT_RUN.       | Bound the first catalog batch and image decode. Already partly done for reduced mode.                               |
| 5    | Live page holds far more nodes than Home      | Laboratory record: 135 thousand to 247 thousand nodes, Home about 10 thousand. Guest emulator Home had about 3.4 thousand elements. The extra nodes were not reproduced.                                                       | MEASURED as stated in the laboratory record. Cause UNKNOWN.               | Do not guess a fix.                                                                                                 |

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

### Map before row windowing

VERIFIED by reading the code. Not a trace. Line numbers are the files after the windowing edit.

- **Rows are built from catalog data already in memory.** `renderModernHomeLayout` walks `rows` at `js/ui/screens/home/modernHomeLayout.js:184`. Each catalog with items becomes a `<section class="home-modern-row">` and a `.home-track` of poster cards, joined into `.home-modern-catalogs` at line 290. `this.rows` is not cleared when the DOM changes. Continue Watching is a separate section above that list.
- **Up and Down use a DOM node list, not the catalog array.** `buildNavigationModel` at `js/ui/screens/home/homeScreenMethods-18-focus-node.js:105` keeps a row only if its track has `.home-content-card.focusable` nodes. `handleHomeDpad` at `js/ui/screens/home/homeScreenMethods-19-handle-home-dpad.js:121-123` moves one row, after `ensureLabRowWindowForMove` when the switch is on. `resolvePreferredNodeForRow` (`js/ui/screens/home/homeScreenMethods-05-apply-hero-to-dom.js:259-267`) restores the last column for that row key, or column 0. A placeholder with no card is omitted from `nav.rows`, so Down stops unless the destination row is mounted before that read.
- **Left and Right scroll the current track.** Same d-pad file, lines 92-117. `ensureTrackHorizontalVisibility` writes `scrollLeft` at `js/ui/screens/home/homeScreenMethods-17-end-modern-vertical-fast-scroll.js:221`. The focused row must stay mounted or that track node is gone.
- **Details return is a row key plus item identity, not a live node.** Enter calls `openDetailFromNode` at `js/ui/screens/home/homeScreenMethods-27-enrich-continue-watching.js:236`, which stores `rememberReturnFocusForNode` (`js/ui/screens/home/homeScreenMethods-01-get-route-state-key.js:140-152`): `rowKey`, `itemIndex`, `itemIdentity`, and `trackStates`. Back render reads that state at `js/ui/screens/home/homeScreenMethods-23-render.js:58` and lines 176-193, then `restoreModernFocusState` at `js/ui/screens/home/homeScreenMethods-02-restore-modern-focus-state.js:29-48` looks up cards with `getNavigationRowNodes`. The return row must already be real cards in that render, or restore fails.
- **Hero reads the focused card's dataset, then catalog memory.** `scheduleModernHeroUpdate` (`js/ui/screens/home/homeScreenMethods-10-schedule-modern-hero-update.js:7-11`) calls `getNodeHeroSource` (`js/ui/screens/home/homeScreenMethods-05-apply-hero-to-dom.js:323-340`), which indexes `this.rows[data-row-index].result.data.items[data-item-index]`. `applyHeroToDom` at line 29 writes the hero node. The hero sits outside the catalog list. It does not need every row mounted. It does need the focused card's `data-row-index` and `data-item-index`.
- **Sidebar is a separate focus list.** `buildNavigationModel` collects `.home-sidebar .focusable` at `js/ui/screens/home/homeScreenMethods-18-focus-node.js:80-83`. Left from column 0 focuses that list (`js/ui/screens/home/homeScreenMethods-19-handle-home-dpad.js:100-109`). Television settings have `modernSidebar: false`. Sidebar markup does not come from catalog rows. Windowing must not remove the focused card on Left, or `lastMainFocus` (`js/ui/screens/home/homeScreenMethods-15-schedule-focused-poster-flow.js:213`) points at a detached node.
- **Layer reason, already measured.** `.home-track` sets `transform: translateZ(0)` at `css/components-14.css:70`. That is why each mounted track is its own wide layer. Unpromoting those tracks is rejected (television update above). The window removes card DOM and keeps `translateZ(0)` only on mounted tracks.

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

Hiding rows is not enough either. `T_23rows` used `display: none` and stayed near 40 frames per second. Real 20-row trim (`R2_trimmed`) reached 49. A virtualization fix has to remove off-screen rows from the document, not hide them.

### Experiment: row window, 2026-10-14

**Not a speed fix on this emulator.** The window cut layers and nodes. Paint, compositing, and raster rose. Frame rate did not rise. The switch stays off. Television measurement NOT_RUN.

`perf/row-window` cannot be created in this session. The change is on `arena/0ffafbca-nuvio-perf-lab`.

What it does, VERIFIED in code: `localStorage.getItem("labRowWindow")==="1"` is read once, in `js/ui/screens/home/homeRowWindow.js`, and then cached. Default is off. Radius is 2. Catalog objects stay in `this.rows`. Rows outside the band are same-height placeholders with no `.home-track`, so they do not get `translateZ(0)`. Before Up or Down, `ensureLabRowWindowForMove` rebuilds the destination row. The idea is Stremio's visible-catalog window ([useVisibleCatalogs.ts](https://github.com/Stremio/stremio-web/blob/development/src/common/useVisibleCatalogs.ts)), not their code. That file loads a data range. It does not prove they remove row DOM.

Break checks, switch on, 20 synthetic rows, HeadlessChrome 92, throttle 6.8. None skipped.

| Check                                                                | Result |
| -------------------------------------------------------------------- | ------ |
| Down through rows 0-19 and back to 0, focus stayed on a card         | ✅     |
| Right then Left on row 2: `scrollLeft` 0 to 1012 to 253, same row    | ✅     |
| Enter on Lab Row 15 (`lab14`, card `lab:14:0`), Back, same card      | ✅     |
| Hero title changed from Title 15.1 to Title 16.1 after the next Down | ✅     |

Measures are SYNTHETIC. HeadlessChrome 92.0.4512.0, user agent spoofed to Chrome 94, CPU throttle 6.8, effects Reduced, default 38-key suite, 38 presses, not aborted. Order was A, B, A, B. A is switch off. B is switch on. Each run is a reload, because the switch is read once at page start. These are not warm-within-session pairs. Emulator frame rate is not television speed.

| Run               | Rows | Switch | Frames per second | Frames over 50 ms | CompositeLayers | Paint | Tile worker busy | Layers | Megapixels | Layer memory | End nodes |
| ----------------- | ---- | ------ | ----------------- | ----------------- | --------------- | ----- | ---------------- | ------ | ---------- | ------------ | --------- |
| `rowWindow_20_A1` | 20   | off    | 56.6              | 9                 | 63 ms           | 30 ms | 868 ms           | 49     | 45         | 173 MB       | 23287     |
| `rowWindow_20_B1` | 20   | on     | 55.2              | 10                | 126 ms          | 68 ms | 1482 ms          | 15     | 12         | 46 MB        | 8330      |
| `rowWindow_20_A2` | 20   | off    | 56.5              | 9                 | 68 ms           | 32 ms | 982 ms           | 49     | 45         | 173 MB       | 23205     |
| `rowWindow_20_B2` | 20   | on     | 55.1              | 7                 | 148 ms          | 62 ms | 1415 ms          | 15     | 12         | 46 MB        | 10600     |
| `rowWindow_83_A1` | 83   | off    | 58.4              | 0                 | 72 ms           | 31 ms | 857 ms           | 175    | 150        | 573 MB       | 75398     |
| `rowWindow_83_B1` | 83   | on     | 55.6              | 10                | 123 ms          | 63 ms | 1389 ms          | 15     | 12         | 46 MB        | 21428     |
| `rowWindow_83_A2` | 83   | off    | 57.3              | 0                 | 68 ms           | 33 ms | 945 ms           | 175    | 150        | 573 MB       | 74590     |
| `rowWindow_83_B2` | 83   | on     | 55.9              | 8                 | 133 ms          | 74 ms | 1521 ms          | 15     | 12         | 46 MB        | 21822     |

How to read it:

- Layers and nodes fell together. Paint did not. At 20 rows, `focusNode` in the profile rose from about 105 milliseconds off to about 360-380 milliseconds on. Rebuilding a row on Down is the new cost.
- The 38-key suite only moves eight rows. It still keeps every off-screen row mounted when the switch is off, and only the band when it is on. A longer scroll was NOT_RUN.
- `rowWindow_83_A1` started the node counter at 403314. That start is not a steady Home count. The end counts are the ones in the table.
- This browser has no 250 megabyte graphics cap. The 83-row off case estimated 573 megabytes of layer memory. Whether that cap is why the television is slow at 83 rows is SPECULATIVE. Do not turn the switch on from these numbers.

Experiments B through F (render lifecycle, cold start, images, animations, sources) are NOT_STARTED. Not part of this change.

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
