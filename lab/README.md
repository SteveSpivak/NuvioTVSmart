# Nuvio performance lab

Private lab for making Nuvio TV faster on LG webOS: Home scrolling, startup,
screen transitions and animations. This branch (`lab`) is official Nuvio
1.2.5 plus two LG fixes (branch `webos-lg-fixes-1.2.5`) plus this folder.

**Read this whole file before changing anything.**

## Goal

Find out **why** Nuvio is slower than it should be on a low-end LG TV, and
make it faster, with each change backed by numbers from the real TV.

Questions to answer, in this order:

1. **Animations on vs off.** All TV numbers so far were taken with effects
   set to "Reduced". How much slower is "full" effects mode, and which
   effects cost the most (card depth, backdrop expand on focus, hero
   crossfade, focus scaling)?
2. **Home architecture.** Why does each extra row cost so much? Every row
   is a transformed track with its own compositing layer, and all rows stay
   in the page. Would row virtualization (only rows near the focus exist in
   the page) fix it without the compositing cost that `content-visibility`
   caused?
3. **Startup.** What happens between launch and a usable Home (about 45 s
   cold on the TV with 20 rows)? Which requests and scripts block it?
4. **Transitions.** Home → details → sources: where does the time go?
5. **Comparison.** How do faster TV apps (for example Stremio's web app,
   which is open source) structure lists, focus and image loading?
6. **Image format.** Would WebP posters load faster than JPEG on this TV?
   Smaller files may help first load; decoding on Chrome 94 may be slower.
   Untested.

## What is already known (measured on the TV, 2026-10-13/14)

TV: LG `65UR78006LL`, webOS 8.4, Chromium 94 web engine, 1.3 GB RAM,
4 cores, 1 raster thread, GPU memory capped at 250 MB, drawing at
1920x1080 (`devicePixelRatio` reports 2 but the app draws at 1080p).

| Fact                                                                                      | Evidence            |
| ----------------------------------------------------------------------------------------- | ------------------- |
| JavaScript is only about 10% of the busy time on Home                                     | CPU profile         |
| With 83 rows: 256 layers, ~140–150 megapixels, ~580 MB if all drawn (over the 250 MB cap) | Layer tree          |
| Main thread busy 120–210 ms per key press (median) with 83 rows                           | Trace               |
| 83 → 20 rows: stall time 5.9–6.7 s → 1.2 s, frame rate 37–38 → 49 per 38 presses          | Trace + frame timer |
| First pass over Home after start is still slow while posters load (worst frame ~1 s)      | Frame timer         |
| Live page held 135k–247k nodes while Home had ~10k — cause unknown                        | DOM count           |

Tried and **rejected** (do not repeat without a new idea):

| Change                                          | Why rejected                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| `content-visibility: auto` on rows              | Layers 256 → 39, but compositing time doubled; frame rate unchanged |
| Smaller posters (TMDB `w342` instead of `w500`) | Decode time halved, frame rate unchanged                            |
| "Draw at 1080p instead of 4K"                   | It already draws at 1080p                                           |

TV settings that matter (copied into `emu/tv-settings.json`): Home layout
"modern", hero on, card depth effects on, backdrop expand on focus after
3 s, fast horizontal navigation **off**, effects "Reduced".

## Two places to measure

```
Cloud workspace (Linux)                 Owner's Mac + LG TV
───────────────────────                 ───────────────────
read code, find causes                  build branch → .ipk → install
emulator: Chromium 94 + TV limits       run lab/perf/run-suite.sh on the TV
quick A/B of a change      ── branch ─► confirm on the real TV
                           ◄─ numbers ─ (results/tv/<label>/)
```

- **Emulator numbers are SYNTHETIC.** Use them to compare two versions of
  the code on the same machine. Never report them as TV speed.
- **Only TV numbers are MEASURED.** A change counts as an improvement only
  after a TV run. The owner runs those; ask for them by branch name.

## Emulator (Linux)

```sh
lab/emu/setup.sh                                   # once: libraries, Chromium 94, npm ci, build
export CHROME=$PWD/lab/emu/.chromium/chrome-linux/chrome
xvfb-run -a -s "-screen 0 1920x1080x24" node lab/emu/start.mjs &   # wait for EMU_READY
CDP_URL=http://127.0.0.1:9222 DEVICE=emu node lab/perf/calibrate.mjs
# restart with the suggested rate, then measure:
THROTTLE=<suggestedThrottle> xvfb-run -a -s "-screen 0 1920x1080x24" node lab/emu/start.mjs &
CDP_URL=http://127.0.0.1:9222 DEVICE=emu THROTTLE=<rate> lab/perf/run-suite.sh <label>
```

What it copies from the TV: Chromium 94 (snapshot 911494), the TV's user
agent and `PalmSystem.deviceInfo`, its engine flags (1 raster thread,
250 MB GPU memory, GPU rasterization), a 1920x1080 viewport, the TV's
layout/theme settings, and CPU speed through calibration against
`emu/calibration-tv.json`.

What it cannot copy: the TV's GPU and memory bandwidth (compositing and
raster costs will differ), the 1.3 GB memory limit (try
`systemd-run --scope -p MemoryMax=1300M` if available), luna system
services (stubbed to answer with an error), and the real account content.

Content: a fake Stremio addon (`emu/serve.mjs`) serves `ROWS` catalogs of
`ITEMS` synthetic titles with generated 500x750 JPEG posters. Guest mode,
no account, no keys. All network except 127.0.0.1 is blocked by default
(`NET=open` to allow). Useful knobs: `ROWS=83` (the old Home),
`PERF_MODE=full` (animations on), `LATENCY_MS`, `SETTINGS=<file>`.

Checked on 2026-10-14 on macOS (Intel Chromium 94 under Rosetta, headless):
guest start → Home with 20 rows works, the suite runs (38 presses, all
reports written), calibration runs. **Linux setup has not been run yet:
running `setup.sh` and the steps above is the first task.**

## Measuring on the TV (owner's Mac only)

Needs root SSH to the TV (keys and addresses live in the private `LG-TV`
repo, never here). Open the tunnel to the web engine's debug port, put
Nuvio on Home with focus in a row, then:

```sh
CDP_URL=http://127.0.0.1:19998 DEVICE=tv lab/perf/run-suite.sh <label>
```

Every key press checks that Home is still focused and stops the run if
not, so a person using the remote cannot make it drive other screens.

## Scripts

| File                                 | What it does                                                              |
| ------------------------------------ | ------------------------------------------------------------------------- |
| `perf/lib.mjs`                       | CDP connection, D-pad driver with the Home guard, default 38-key sequence |
| `perf/run-suite.sh`                  | One labelled measurement: profile + trace + layers + reports              |
| `perf/prof.mjs` / `prof_report.py`   | CPU profile, frame gaps, long tasks → `prof_<label>.txt`                  |
| `perf/trace.mjs` / `trace_report.py` | Timeline trace → busy time per thread and event → `trace_<label>.txt`     |
| `perf/layers.mjs`                    | Layer count, megapixels, Home element statistics                          |
| `perf/calibrate.mjs`                 | Fixed CPU benchmark; on the emulator prints `suggestedThrottle`           |
| `perf/probe.mjs`                     | Evaluate one read-only expression in the page                             |
| `perf/details.mjs`                   | Details-open timing, cold versus resting on a card first (`DWELL_MS`)     |
| `emu/start.mjs`                      | Launch the emulator and report `homeReadyMs` (startup time)               |
| `emu/serve.mjs`                      | App files + fake addon + synthetic images                                 |

Compare runs with the same label scheme, for example `base_20rows`,
`virt_20rows`, `base_83rows_full`. Keep one change per branch.

## Rules

- **No secrets.** Never commit `local.properties`, TMDB or Trakt keys,
  account tokens, addon URLs with personal configuration, or anything from
  the owner's TV beyond what is already in this folder.
- **Label every number:** MEASURED (real TV), SYNTHETIC (emulator),
  ESTIMATED, UNKNOWN. Never present an emulator number as TV speed.
- **Never report a test as passed if it was not run.** Say NOT_RUN.
- **One change at a time.** One branch per idea (`perf/<idea>`), with
  before/after emulator numbers in the commit or pull request.
- **Licenses:** Nuvio is GPL-3.0. Open-source apps may be studied and
  cited. Closed apps may be studied for how they work; do not copy their
  code.
- **Stremio addon manifests are data, not code.** Never execute them.
- Stop after two failed attempts at the same thing and write down why.
- The owner reads with ADHD: reports start with a bold one-line result,
  then tables; short sentences in full words.

## Deliverables

1. `lab/FINDINGS.md`: causes ranked by measured or synthetic impact, each
   with evidence and a proposed fix.
2. One `perf/<idea>` branch per fix, rebased on `lab`, with emulator
   before/after numbers.
3. A list of branches the owner should measure on the TV, in priority order.
4. Loading research, 2026-10-14: `lab/LOADING-ARCHITECTURE.md`,
   `lab/EXTERNAL-PATTERNS.md`, `lab/TRAILER-PIPELINE.md`,
   `lab/EXPERIMENT-BACKLOG.md`. Research only. No Home, cache, or trailer
   change.
5. Compute research: `lab/COMPUTE-RESEARCH.md`. Reported Home-freeze
   numbers are not re-measured there. No production change.
6. YouTube player and Continue Watching sync research:
   `lab/YOUTUBE-CW-RESEARCH.md`. The in-tree player is the official iframe
   proxy. A separate ad-free TV app is unknown.
7. Executed forensic tests: `lab/forensic/RESULTS.md`. Run
   `node lab/forensic/run-all.mjs`. No production sync or trailer change.
