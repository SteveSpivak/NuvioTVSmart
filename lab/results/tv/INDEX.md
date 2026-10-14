# TV runs (MEASURED, LG 65UR78006LL, Nuvio 1.2.4 patched, effects "Reduced")

Same 38-key sequence for every run except `home1`/`baseA` (early sequences).

| Run        | Home rows                            | Change                             | Notes                                    |
| ---------- | ------------------------------------ | ---------------------------------- | ---------------------------------------- |
| home1      | 83                                   | none                               | first profile, different key sequence    |
| baseA      | 83                                   | none                               | baseline for the content-visibility test |
| B_cvOn     | 83                                   | `content-visibility: auto` on rows | rejected                                 |
| A_cvOff    | 83                                   | none                               | paired with B_cvOn                       |
| A1_w500    | 83                                   | none (w500 posters)                | baseline for poster size                 |
| B_w342     | 83                                   | posters w342                       | rejected                                 |
| A2_w500    | 83                                   | none (w500 posters)                | second baseline                          |
| T_23rows   | 23 (others hidden with display:none) | simulated trim                     |                                          |
| R_trimmed  | 20 (real trim)                       | first pass after app restart       | posters loading                          |
| R2_trimmed | 20 (real trim)                       | warmed up                          | best result                              |

Caveat: 83-row runs started near row 15, 20-row runs at the top.
