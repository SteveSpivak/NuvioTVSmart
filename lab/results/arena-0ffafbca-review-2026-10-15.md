# Review of `arena/0ffafbca-nuvio-perf-lab` for the Back/Details lag work (2026-10-15)

Reviewed from `exp/back-render` at `b4fa92a2`. The arena branch audited `c620c796`, an ancestor of this branch (21 commits behind). It changes only `lab/` files.

The requested package `lab/research/tv-ux/` and `verify/run-verify.mjs` are not on this branch or on any fetched remote branch. This review covers `lab/ARCHITECTURE-AUDIT.md`, `lab/resource/*` and `lab/forensic/RESULTS.md` instead.

## Drift since the audit base

The 21 newer commits change watched identity, watch-progress sync and Continue Watching loading. Audit items 1 and 5 describe the older code. The Home D-pad fallback (`homeScreenMethods-19-handle-home-dpad.js:29`) is unchanged.

## Classification

| Finding | Decision | Reason |
|---|---|---|
| CPU profile self time from `timeDeltas` is not DevTools self time; a long-task sum is not a floor | USE NOW, as a reporting rule | Harness only. No app change. |
| D-pad falls back to the first `.focusable` when the focused node is gone (audit 2) | VERIFY | Can matter after Back re-renders Home. Needs a TV key recording. |
| Reject player pre-init during navigation (resource option E) | VERIFY, measured | `trailer-intent-ab-2026-10-15.md`: warming on Details open costs open and scroll long tasks on the TV. |
| Home to Details meta request is joined, not duplicated (cache-clear note) | VERIFY | Code reading, not a TV network capture. |
| Continue Watching snapshot after pull (audit 1) | DEFER | Correctness, not lag. Code changed since the audit. |
| Bound stream addon fan-out (audit 4) | DEFER | Stream screen, not Home or Details lag. |
| Watched identity index (audit 5) | DEFER | Only if a TV profile names the linear scan. Code changed since. |
| Row window (audit 6) | IGNORE | Already rejected. |
| Sync debounce flush (audit 7) | IGNORE | Not performance. |
| `metaRepository.clearCache` write-back bug | IGNORE for lag | Real but latent; no production caller. Unrelated defect. |
