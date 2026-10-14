# Experiment backlog

**Do not enable row-window v1. E0 and E1 are the next experiments. This handoff does not implement them.**

No new script was added. `lab/perf/details.mjs` already records visible time, a text-length proxy, settle time, host counts, and long-task totals. The path-level gap needs a redacted waterfall on the television. Extend `details.mjs` in a later session rather than adding a second harness. A new file that logs raw URLs would risk tokens. NOT_IMPLEMENTED, on purpose.

Keep the five milestones separate. First visible Details is `visibleMs` (MEASURED). Usable Details, full enrichment, trailer readiness, and first selectable source are NOT_RUN. `settledMs` is last DOM text or element-count change, not any of those four. The 1122–1832 ms long-task sum is not a proven floor.

Provenance: measurement inputs are `9019da8` (television Details JSON) and `aa86246` (row-window v1, switch default off, synthetic only). Protocol notes from `deaf7e0` (`lab/NETWORK-RESEARCH.md`) stay. This file does not turn `labRowWindow` on.

Labels: MEASURED, SYNTHETIC, INFERRED, PROPOSED, UNKNOWN, NOT_RUN.
Every code experiment below is NOT_RUN. Expected direction is a sign, never a made-up percentage.

Owners for the whole list: `lab/perf/details.mjs`, `lab/perf/lib.mjs`, `js/data/repository/metaRepository.js`, `js/core/tmdb/tmdbMetadataServiceMethods-01-fetch-enrichment.js`, `js/ui/screens/detail/metaDetailsScreenMethods-03-load-detail.js`, `js/ui/screens/home/homeRowWindow.js`. Do not edit them until the named experiment starts.

## How to run a television trial

Same account, same effects, same title rows. Never Continue Watching (OK must not start playback). Warm runs only, alternating A/B/B/A or A/B/A/B. Cold starts are a separate table. Abort if Home does not return after one Back, or if the focused card is not `openDetail`.

Command shape, on the television tunnel, after the build is installed by the owner:

```sh
CDP_URL=http://127.0.0.1:19998 DEVICE=tv node lab/perf/details.mjs CDDC
```

`DWELL_MS` selects the rest. Do not install from this session.

## E0. Name the requests

- **Hypothesis.** The late Details wait is a small set of repeated calls, not "the network" in general. After a 2 s rest the television still made 6–8 calls (Cinemeta 1, TMDB 1–2, Trakt 3–5).
- **Null.** Path logs show those calls are all required for the first usable screen and are not repeated within one open. Then stop chasing de-dupe.
- **Instrumentation.** Extend `details.mjs` only. Record provider, endpoint category, start, end, cache hit if the app exposes one, and a boolean for visible / text-present / source-ready. Redact query strings. No titles, no tokens, no bodies.
- **Minimal change.** Measurement only.
- **Expected direction.** UNKNOWN until run. The useful output is a table of categories, not a faster app.
- **Risk.** `clearResourceTimings` already runs inside the Details recorder. Do not call it around unrelated measurements.
- **TV procedure.** 4 warm trials, order C/D/D/C, `DWELL_MS=2000`, then 4 at 5000. Save under `lab/results/tv/`.
- **KEEP** if every call has a category and a required/optional flag. **REJECT** the log if any token or title appears. Delete that file.

## E1. Name the long tasks

- **Hypothesis.** The recorded 1122–1832 ms long-task sum contains one or two functions that a later patch could move off the OK path. This is a hypothesis. The sum is not already a proven floor.
- **Null.** Samples spread across many short tasks, overlap the network wait, or have no hotspot over about 200 ms of self time. Then do not yield the render path, and do not call the sum unavoidable.
- **Instrumentation.** Reuse `Profiler.enable` from `lab/perf/prof.mjs` and `Tracing.start` from `lab/perf/trace.mjs`. Both scripts today drive the Home D-pad suite, not Details. A Details profile does not exist yet. Capability-detect the profiler methods. Chromium 94 has long tasks; `scheduler.yield` must not be required. Save start time and duration, not only the sum.
- **Minimal change.** None in the app for the first profile. Do not add it in the research handoff.
- **Expected direction.** A named function, or a clear "no hotspot" result. No speed claim.
- **Risk.** A profile changes timing. Compare profiled and unprofiled visible and settle medians before trusting the stack.
- **TV procedure.** 3 warm cold-opens and 3 dwell-opens, same title class as E0. Not the scrolling suite. Separate commit from this handoff.
- **KEEP** a yield or split only if one function dominates and a follow-up trial cuts that function without raising settle time. **REJECT** a yield-everywhere patch. **REJECT** any write-up that calls the current sum a floor.

## E2. Share hero TMDB with Details

- **Hypothesis.** Hero and Details both call `fetchEnrichment` with no shared cache, so the 1–2 TMDB calls after a rest include a repeat.
- **Null.** E0 shows a single TMDB details call per title, already in flight or cached. Do not add a cache.
- **Owner.** `tmdbMetadataServiceMethods-01-fetch-enrichment.js`. Key: tmdb id, type, language, image-language filter. In-flight map, same shape as `metaRepository.inFlightMeta`. Cap the map.
- **Minimal change.** One cache in that service. No new module.
- **Expected direction.** Fewer TMDB calls on the second open of the same title. Settle time falls only if E0 showed TMDB on the critical path. No percentage.
- **Risk.** Stale language or a cached null after a failure. Do not cache failures. Honor 429.
- **TV procedure.** E0 waterfall, then this branch, same order. Warm A/B/B/A.
- **KEEP** if call count drops and settle median does not rise, and Back still returns to the same card. **REJECT** if settle rises or the wrong language appears.

## E3. Prefetch source-addon meta on a stable hero

- **Hypothesis.** The Cinemeta call that remains after a rest is `getMeta(sourceAddon)`, which the hero does not start. Starting it when the hero commits, and cancelling when focus moves, removes that call from the OK path.
- **Null.** E0 shows that call is already shared, or it is not on the settle path.
- **Owner.** `homeScreenMethods-11-enrich-current-hero-async.js` and `metaRepository.js`. One in-flight entry. Abort or ignore on focus change. Cap `metaCache`.
- **Minimal change.** Call the existing `getMeta`. Do not prefetch every addon.
- **Expected direction.** After a 2 s rest, settle moves toward the 5 s result (median 2078 ms). Do not treat 1.1 s of long tasks as a floor it cannot pass. Usable Details is a separate marker and is NOT_RUN.
- **Risk.** Extra calls while the user is scrolling. Gate on the same focus-settle delay the hero already uses. Trakt must not be added here (rate limit).
- **TV procedure.** Dwell 2 s, n at least 4 per side, alternating. Watch request count, not only settle time.
- **KEEP** if 2 s settle falls and requests per minute do not spike. **REJECT** if scrolling fps falls or 429s appear.

## E4. Stop paging the whole watched-movie list on every movie Details

- **Hypothesis.** A movie open can call paged `/sync/watched/movies` (`traktAuthServiceMethods-01-get-current-auth-state.js`). That can explain several of the 3–5 Trakt calls. A fresh per-title progress call, or the existing 30 min enrichment cache, is enough for the badge.
- **Null.** E0 shows the extra Trakt calls are comments or related titles, and watched-movies is already cached.
- **Owner.** `detailWatchedEnrichmentService.js`. Do not invent a new sync client.
- **Minimal change.** Use the cached watched set when the TTL is valid; do not refetch all pages for one badge.
- **Expected direction.** Fewer Trakt calls per repeat open. Settle time falls only if those calls were last.
- **Risk.** A stale watched badge for up to 30 min. That is the TTL already in the file.
- **TV procedure.** Same title twice, with and without the change. Confirm the badge still matches a known watched movie.
- **KEEP** if the badge is correct and Trakt count drops. **REJECT** if the badge flips wrong.

## E5. First usable Details versus last DOM change

- **Hypothesis.** `settledMs` waits for comments, cast, or related art that the user does not need before reading the title and pressing Play.
- **Null.** The last mutation is the title, description, or play target. Splitting the render would not move a real marker.
- **Instrumentation.** Add one attribute, for example `data-detail-ready="meta"`, when title, description, and the play action are in the DOM. Record it from `details.mjs`. Do not treat it as pass/fail until the owner agrees the marker is the product definition.
- **Minimal change.** One attribute. No visual change.
- **Expected direction.** The new marker is earlier than `settledMs` on cold opens. UNKNOWN by how much.
- **Risk.** A marker that fires before the play target exists. The break check is: OK on Play still opens Sources.
- **TV procedure.** Same 12 s capture. Report both numbers. Do not delete `settledMs`.
- **KEEP** the marker if it is stable across 4 trials. **REJECT** any change that hides enrichment by skipping it entirely before E1 names the long tasks.

## E6. First source chunk

- **Hypothesis.** Sources already render the first addon chunk and virtualize above 100 rows. The unknown is how long the first playable row takes, not whether a new virtualizer is needed.
- **Null.** First chunk is fast and the stall is later enrichment or the player. Then do not touch `streamVirtualizer.js`.
- **Instrumentation.** Extend the Details/Sources recorder: time from Sources visible to first row with a stream url present in the DOM. Do not log the url.
- **Minimal change.** Measurement only. Addon fan-out is already unbounded (`installedAddons.map`). Do not add a second parallel client. A concurrency cap is a later experiment, only if E6 shows the fan-out delaying the first chunk or tripping 429.
- **Expected direction.** A number where none exists. NOT_RUN today.
- **Risk.** OK on the wrong card starts playback. Keep the `openDetail` guard. Do not press Play in this experiment.
- **TV procedure.** Open Sources, wait, Back once. n=4 warm. Abort if playback starts.
- **KEEP** the measurement even if it is slow. **REJECT** a new stream UI.

## E7. Row-window v2, pre-mounted pool

- **Hypothesis.** v1 is slower on the emulator because `replaceWith` parses the entering row on the key path. A row that is already mounted before Down brings `focusNode` back toward the all-mounted run without restoring 175 layers.
- **Null.** Pre-mounting does not cut `focusNode` or frames over 50 ms. Stop. Do not change radius, posters, or promotion.
- **Owner.** `homeRowWindow.js` only. Switch `localStorage.labRowWindow === "1"`, read once, default off.
- **Minimal change.** One extra real row ahead of the move; update an existing node instead of parsing a new section when the band slides. Same placeholder height contract.
- **Expected direction.** SYNTHETIC `focusNode` down toward ~105 ms (20-row off). Frames over 50 ms down toward the off-switch count. Layers stay near 15, not 49 or 175. Television fps UNKNOWN. No percentage.
- **Risk.** Wrong card, lost horizontal scroll, broken Back. Run `lab/perf/row-window-check.mjs` before any suite.
- **Emulator procedure.** 20 rows first, A/B/A/B, throttle 6.8, Reduced, 38 keys. Then 83 rows. Do not compare a cold first run with a warm later run.
- **TV procedure.** Only if the emulator `focusNode` fell and the break check passed. 20 real rows, warm A/B/B/A. Reject if fps does not rise. The 250 MB cap is the reason the TV can still differ from the emulator.
- **KEEP** only with a television fps rise and no navigation miss. **REJECT** v1 as a default. **REJECT** another layers-only patch if v2 also only cuts layers.

## E8. Artwork, first load only

- **Hypothesis.** WebP or AVIF might shorten first poster arrival. It will not raise scroll fps. Chromium 94 can decode both; the Mali-G31 cost is UNKNOWN.
- **Null.** Decode or fetch time does not fall on the television, or fps falls. Stop.
- **Owner.** Image URL helper, behind a lab flag, one row of posters, not the whole app.
- **Minimal change.** Do not clear `src`. Do not change `w500` again for scrolling.
- **Expected direction.** First-image time down, or no change. Scroll fps unchanged.
- **Risk.** A format the television paints slowly, or a CDN URL that 404s. Keep JPEG as the fallback in the same element.
- **TV procedure.** Cold Home, same row, JPEG versus one new format, alternating. Metric is image complete time, not the 38-key fps suite.
- **KEEP** only for startup if the image metric falls and scroll fps does not. **REJECT** as a scrolling project.

## T1. Trailer time-to-first-frame

- **Hypothesis.** The 7 s fallback in `mountTrailerLayer` hides a slow or silent embed. A television trace will show whether first frame is proxy-bound, iframe-bound, or missing.
- **Null.** First frame is consistently fast and the fallback never wins. Do not touch the URL builder.
- **Instrumentation.** Record the proxy `firstFrame` message time and the fallback time. No video URL, no title.
- **Minimal change.** A timestamp in the existing message handler, lab flag only.
- **Expected direction.** UNKNOWN. A URL is not a playable file; this experiment does not try to prove the media by fetching it.
- **Risk.** Logging the iframe `src` can leak the video id. Log an enum: `proxy`, `direct`, `video`, `none`.
- **TV procedure.** Rest on 4 titles that show a trailer in the hero. Do not start playback.
- **KEEP** the numbers. **REJECT** any change that replaces the embed with a direct media URL.

## T2. One media element

- **Hypothesis.** Leaving the Home iframe mounted when the player starts costs the next start, or hits the one-media limit.
- **Null.** The iframe is already destroyed before play, and start time does not change when that destroy is moved earlier.
- **Owner.** Existing trailer cleanup. No second player.
- **Minimal change.** Confirm destroy-before-play, then measure player start. If destroy is already there, this experiment is measurement only.
- **Expected direction.** No overlap of two media elements. Start time UNKNOWN.
- **Risk.** A destroyed trailer that the user still sees on Back. Restore must be the existing mount path, not a warm hidden player.
- **TV procedure.** Owner-run only. This session must not install or start playback.
- **KEEP** if a trace shows two media elements and removing the overlap does not slow Back. **REJECT** a preloaded second `<video>`.

## Already decided

| Item                                         | Verdict                                                           |
| -------------------------------------------- | ----------------------------------------------------------------- |
| Row-window v1 as a default                   | REJECT. SYNTHETIC fps did not rise. TV NOT_RUN. Switch stays off. |
| Unpromote / remove `translateZ(0)` globally  | REJECT. MEASURED L5 slower than L4.                               |
| `content-visibility: auto`                   | REJECT. MEASURED.                                                 |
| Smaller posters as a scroll fix              | REJECT. MEASURED.                                                 |
| New cache framework, new scanner, WebGL port | REJECT.                                                           |
| Details prefetch of source meta and TMDB     | PROPOSED as E2 and E3. Not started.                               |
