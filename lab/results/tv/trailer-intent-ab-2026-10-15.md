# trailerIntent A/B on the LG TV (2026-10-15)

Build: `b4fa92a2` on `exp/back-render`, installed bundle md5 `7b6e5cf570c1b973969078b4c2df4074`. LG webOS 8.4, Chromium 94.

## What was compared

- **OPEN**: `nuvioLabOff="trailerIntent"`. The old warm path: the trailer player is warmed as soon as Details enrichment finds a trailer.
- **INTENT**: `nuvioLabOff=""`. The new path: the player is warmed only after focus rests on the Trailer button for 600 ms.

Order ABBA ABBA: OPEN, INTENT, INTENT, OPEN, OPEN, INTENT, INTENT, OPEN. Four cards per arm, two movies and two series each. Every card was opened for the first time in this app session (see `measure-fresh-cards`). Per card: OK on the card, 12 Downs inside Details, Back, then Right and Left on Home. No card was ever focused on the Trailer button, so INTENT never warmed a player.

Raw rows: `trailer-intent-ab-2026-10-15.jsonl` (item ids are hashed). Summary: `node lab/results/tv/abstat.mjs lab/results/tv/trailer-intent-ab-2026-10-15.jsonl`.

## Results (MEASURED, TV, medians of 4 cards per arm)

| Metric | OPEN | INTENT | Change |
|---|---|---|---|
| Details shell ms | 1140 | 1027 | -10% |
| Open long tasks total ms | 2796 | 1366 | -51% |
| Open longest task ms | 574 | 782 | +36% |
| Scroll 12 Downs long tasks total ms | 547 | 156 | -71% |
| Scroll key p95 ms | 154 | 91 | -41% |
| Back long tasks total ms | 1329 | 1175 | -12% |
| Back longest task ms | 1163 | 1077 | -7% |
| Home ready after Back ms | 1190 | 1231 | +3% |
| Home Right/Left long tasks total ms | 365 | 461 | +26% |

Per-card ranges show which differences are separated:

- Open long tasks total: OPEN 2195 to 2951, INTENT 1027 to 2157. No overlap.
- Scroll long tasks total: OPEN 382 to 1336, INTENT 51 to 259. No overlap.
- Back long tasks total: OPEN 1016 to 2494, INTENT 1007 to 1281. Overlaps. Not a measured change.
- Open longest task, Home ready and Home Right/Left: ranges overlap. Not a measured change.

## Reading

- **Cause, measured:** warming the YouTube player on Details open adds main-thread work during the open and during the first scroll in Details. Moving the warm to Trailer-button focus removes about half of the open long-task time and most of the scroll long-task time when the user does not go to the Trailer button.
- **Not fixed by this:** the single ~1 s long task on Back (OPEN median 1163 ms, INTENT 1077 ms). It is the Home re-render after Back, still open.
- **Not measured:** time from Trailer press to playback with INTENT. A user who presses Trailer within 600 ms of focusing it gets no warm player. Needs a separate run.
- n = 4 per arm. The TV's daily setting stayed `trailerWarm` (warm off) before and after the run.
