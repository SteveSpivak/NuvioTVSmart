# Integration record: cloud c620c79 + watched experiment + E0/E1 (2026-10-14)

Candidate branch `integrate/cloud-c620c79-watched` (local only, not merged to `lab` or production).

## Inputs

| Input                                              | SHA                                                                   |
| -------------------------------------------------- | --------------------------------------------------------------------- |
| Cloud tip (`arena/0ffafbca-nuvio-perf-lab`)        | c620c7961c2aea7f1ae181ac2e4c25e0de488fe7                              |
| Six cloud commits                                  | e4cc51b 3e3fee1 0f4de7a 95ed1ee cf0354a c620c79                       |
| Watched experiment (`perf/watched-identity-index`) | 901e1c1c                                                              |
| E0/E1 (`perf/e0-e1-details-waterfall`)             | 230dd7c8                                                              |
| Candidate commits                                  | 59b17a4b (merge watched), 2a997772 (merge E0/E1), 2af31bd5 (Prettier) |

## Overlap

- Production files touched by the cloud: `js/core/profile/watchProgressSyncService.js` (3e3fee1),
  `js/ui/screens/home/homeScreenMethods-12/13*.js` and `css/components-16/17.css` (0f4de7a),
  `docs/youtube-proxy.html` (95ed1ee). None of these are touched by the watched experiment
  (`labSwitch.js`, `watched*.js`, `metaDetailsScreenMethods-05*.js`). No production conflicts.
- Only conflict: `lab/perf/details.mjs`, edited three ways. The candidate keeps the E0/E1 version and its
  22 fixture tests. The watched version is kept as `details_v1.mjs` for `details_ab.mjs` and
  `details_ab_report.py`, which read its result fields. The cloud's E0 version is superseded.
- Needs separate integration (behaviour changes, each its own decision):
  - 3e3fee1: legacy progress rows with missing or non-positive duration are now read as milliseconds.
    Historical second-based rows with duration 0 stay unscaled by design. Affects Continue Watching data.
  - 0f4de7a + 95ed1ee: Home trailer `load` + 7 s timer now marks `is-unconfirmed` instead of
    `is-active`; a missing YouTube id posts `error` before a player is created.

## Results (all MEASURED here unless marked)

| Stage                            | Command                                                                                                                                                            | Result                                                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strict forensic suite, cloud tip | `FORENSIC_MODE=regression FORENSIC_STRICT=1 node lab/forensic/run-all.mjs`                                                                                         | exit 0, 49 PASS / 0 FAIL                                                                                                                                   |
| Build, cloud tip                 | `npm test` (build + forwarding + 2 test files)                                                                                                                     | build and forwarding pass; `tests/test-plugin-system.mjs` missing, also missing at 24ac618 (pre-existing)                                                  |
| Lint, cloud tip                  | `npm run lint`                                                                                                                                                     | exit 0                                                                                                                                                     |
| Format, cloud tip                | `npx prettier --check .`                                                                                                                                           | FAIL, 14 files. Correction: 2af31bd5 (formatting only)                                                                                                     |
| Watched alone (901e1c1c)         | `node --test lab/checks/watched-identity-index.test.mjs`, `watched-remote-memo.test.mjs`                                                                           | pass (9 and 15 assertions)                                                                                                                                 |
| Candidate                        | forensic strict, exit-policy, details fixtures, watched checks, build, forwarding, lint, prettier                                                                  | all exit 0; forensic 49/0, details 22/22                                                                                                                   |
| Lab package                      | `ENV_IPK=… ENV_IPK_SHA256=feb9bf6c… lab/build-lab-ipk.sh`                                                                                                          | `space.nuvio.lab_1.2.5_all.ipk`, sha256 6e37fd3f92d04f2e75d5fdc2be5e3762ff090925706ccba5acb7b3713c75637c; no `space.nuvio.webos` references                |
| Install on TV                    | Homebrew Channel `install` from a temporary Mac server (stopped afterwards)                                                                                        | Lab appinfo replaced; normal Nuvio appinfo mtime unchanged; both IndexedDB directories unchanged; Lab localStorage 44 keys / 453538 bytes before and after |
| YouTube on Lab                   | —                                                                                                                                                                  | NOT_RUN: Lab setting `focusedPosterBackdropTrailerEnabled` is false, so Home never mounts a trailer. Needs authorization to toggle that Lab-only setting   |
| E0/E1 on TV                      | `CDP_URL=http://127.0.0.1:19998 CDP_TARGET='space\.nuvio\.lab' DEVICE=tv DWELL_MS=2000 PROFILE=alt LABEL=2026-10-14_e0e1_tv_dwell2 node lab/perf/details.mjs CDDC` | exit 0, 4/4 trials, redaction check passed. `lab/results/tv/2026-10-14_e0e1_tv_dwell2/details.json`                                                        |
| Normal vs Lab diagnostics        | read-only `Runtime.evaluate`                                                                                                                                       | Lab only so far; normal Nuvio not running (launching it may sync to the cloud)                                                                             |

## E0/E1 TV findings (MEASURED, n=4, 2 profiled)

- Usable Details (title, description, Play): 579–669 ms after OK, except the first open after app launch (2346 ms,
  54 requests, 27 of them `nuvio-catalog /meta/series/{x}` after render).
- Every open fetches `trakt /movies/{x}/comments/likes` twice with the same URL.
- Long tasks after usable: `detailScrollHandler` self time 220–262 ms, called synchronously from
  `_renderDetailSectionsNow → bindDetailChrome`. It reads `content.scrollTop` right after the sections are rebuilt,
  so the time is most likely forced layout of the new Details DOM (INFERRED). It repeats after the later section
  re-render (~4.5–4.9 s).
