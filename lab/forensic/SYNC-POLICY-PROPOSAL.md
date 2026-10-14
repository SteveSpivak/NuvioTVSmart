# Sync policy proposal (not applied)

These behaviors were reproduced against the current modules and left unchanged.
Do not treat this note as a fix, and do not apply it without a separate product decision.

## Leave as implemented

- Unconstrained push debounce is 1500ms. `debounce-1500` fails if a push arrives at 1499ms.
- `performance-constrained` debounce is 15000ms. `constrained-debounce-15000`.
- Equal `updatedAt` keeps the remote row because merge uses `>`, not `>=`. `conflict-equal-timestamp-remote-wins`. A tie drops the local position.
- Trakt-selected authenticated clients skip the Nuvio cloud pull. `trakt-source-skips-nuvio-cloud`. Switching to Trakt hides a `tt` row whose source is not Trakt. `trakt-filter-drops-local-source-row`.
- An empty remote pull does not replace a nonempty local store. `empty-remote-keeps-local`.
- An empty push does not wipe remote rows. `empty-push-does-not-wipe-cloud`.
- Session teardown inside the debounce cancels the timer. The local row remains and the cloud write is lost. `termination-before-push`.

## Reader rule that was applied

`mapProgressRow` no longer scales a legacy `position` when `duration` is missing, null, blank, or `<= 0`. A positive duration `<= 28800` is still a seconds pair. Explicit `position_ms` is still preferred by the reader, but `sync_push_watch_progress` in `NuvioMedia/self-host` `database/migrations/00000000000000_baseline.sql` stores only `position` and `duration`. The writer must keep sending milliseconds in those columns. A duration-0 historical seconds value cannot be told apart from milliseconds and is not scaled.

## Later, only if product asks

1. Flush the already-queued progress push on teardown, or persist the pending payload, so a kill inside 1500ms does not lose the cloud write. Keep the local save. Do not shorten the debounce.
2. Make the equal-timestamp winner explicit (origin client id, or keep local when the values differ) instead of the current `>` remote default. Do not flip it silently.
3. Do not make Trakt and Nuvio Sync share Continue Watching through Supabase unless that is a product requirement. The skip is intentional.
4. Home can show a stale Continue Watching card after pull and after foreground resume until `writeContinueWatchingDisplaySnapshot` runs. `stale-snapshot-after-pull` and `foreground-resume-leaves-snapshot-until-rewrite`. A later change should refresh that snapshot from the store after a successful pull, without a new cache owner and without a live account in the test.

No live Supabase, Trakt, or private history was used for these conclusions.
