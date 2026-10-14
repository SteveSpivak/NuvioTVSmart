# Forensic test results

Recorded by `node lab/forensic/run-all.mjs` on Node v22.22.3.
Branch `arena/0ffafbca-nuvio-perf-lab`. HEAD at run start `0f4de7a9c14cbab9374c46ba310b3b30384a484c`.
No live Supabase, Trakt, or TV call. Verdicts come from the modules imported in this worktree.

## Commands

- `node lab/forensic/exit-policy.test.mjs` exit 0 in 35ms
- `node lab/forensic/run-sync-forensics.mjs` exit 0 in 8027ms
- `node lab/forensic/run-sync-forensics.mjs` exit 0 in 7869ms
- `node lab/forensic/run-youtube-forensics.mjs` exit 0 in 249ms
- `node lab/forensic/run-youtube-forensics.mjs` exit 0 in 327ms
- Repeated each suite once. Verdict signatures matched: **yes**.
- `tests/` is absent and gitignored. `npm test` was not run. Existing plugin tests: **BLOCKED**.
- Full `npm run build` / webOS package: **NOT_RUN**. The suites imported the current modules, which is the practical parse check for this pass.

## Counts

| Verdict       | Count |
| ------------- | ----- |
| PASS          | 49    |
| FAIL          | 0     |
| EXPECTED_FAIL | 0     |
| BLOCKED       | 0     |
| NOT_RUN       | 1     |

Suite cases: 50. EXPECTED_FAIL is a subset of FAIL, not a pass. Existing plugin tests are not in this count; they are BLOCKED because `tests/` is absent.

Runner mode: `regression`. Exit decision: 0 (regression-ok). Strict regression, treating every FAIL as required, would exit 0. Investigate exit 0 does not pass the expected failures.
Node v22.22.3. FORENSIC_MODE=regression. FORENSIC_STRICT=0.

## Tooling

- `node --check` is not part of this runner. The runner's own exit code is the execution check.
- Repo `npm run lint` was not run: `node_modules` is not installed, and `npx eslint` cannot load `@eslint/js` from the repo config. Status: **BLOCKED**.
- `npm run build` was not run. Status: **NOT_RUN**.

## Reproduced failures

## What the passes established

- Same account and profile round-trips a normal 2 hour movie position through the real push and pull.
- A different account, and the same account on another profile, do not see that row.
- Local save is visible before the 1500ms push. Constrained mode waits 15000ms. Two saves inside the window become one push.
- A failed push is not retried for 120s for the same signature. An empty push does not wipe the cloud.
- Empty remote does not replace a nonempty local store.
- Newer `updatedAt` wins when both sides changed. A re-save during an in-flight delete is pushed again.
- A Trakt-selected authenticated client skips the Nuvio cloud pull. Switching that client to Trakt hides a `tt` row whose source is not Trakt.
- Profile id is captured when the push is queued and when the pull starts. A later switch does not retarget that RPC.
- Stopping startup sync during a late pull suppresses the Home notification. The store write still commits.
- The Home display snapshot survives pull and foreground watch-state refresh until `writeContinueWatchingDisplaySnapshot` runs.
- Proxy `load` / API `ready` / buffering / `currentTime === 0` are not `firstFrame`. `firstFrame` is emitted once after `currentTime > 0`.
- The 4500ms watchdog and `direct=1` insert an embed iframe and do not emit `firstFrame`.
- Foreign `postMessage` sources are ignored. Home and Details cleanup remove listeners and timers.
- Missing trailer metadata does not build an embed URL or mount a Home iframe.

## Corrections and unchanged policy

1. Reader fix: missing, null, blank, or non-positive duration does not scale a legacy position. A positive duration `<= 28800` still scales as a seconds pair. The writer still sends `position` and `duration` in milliseconds. `position_ms` is not added, because the published push RPC drops it.
2. Applied: the 7000ms load timer and the uncontrollable `loading:false` / `currentTime:0` state add `is-unconfirmed` and do not call `onReady`. `is-active` still requires `firstFrame` or `currentTime > 0` while not paused. CSS keeps the unconfirmed surface visible.
3. Applied: `docs/youtube-proxy.html` no longer defaults a missing `v` to `qBg39HCJiTU`. A missing or invalid id posts `error` and does not load `iframe_api`, construct `YT.Player`, or insert a direct embed.
4. Unchanged policy, documented in `lab/forensic/SYNC-POLICY-PROPOSAL.md`: equal-`updatedAt` remote wins, 1500ms and 15000ms debounce, teardown cancels the pending push, Trakt skips Nuvio Sync, empty remote does not replace local.

## Not verifiable here

- The first composited frame on the LG 65UR78006LL. `firstFrame` is a player-API signal.
- Live production data. The published self-host baseline upserts `watch_progress` and drops unknown entry keys. This mock matches that shape. It is not a live account.
- Live account merge, Trakt history, and a second installed package id. This tree has only `space.nuvio.webos`.

## Next task for local Claude

On the TV, log four timestamps for one known trailer id: proxy iframe `load`, `ready`, `firstFrame`, and Home `is-active`. Do not clear storage. Do not treat the 7s reveal as playback. For sync, do not write the live account; the unit bug and the debounce window are already reproduced here.

## Cases

### same-account-profile-roundtrip

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- Same account and profile: A saved locally, push after 1.5s, B pull restored the same position.

```json
{
  "beforePush": 0,
  "pulled": {
    "contentId": "tt1000001",
    "profileId": "",
    "source": "local",
    "positionMs": 120000,
    "durationMs": 7200000,
    "updatedAt": 1700000001000,
    "title": ""
  },
  "rpc": [
    "sync_push_watch_progress",
    "sync_pull_profile_settings_blob",
    "sync_push_profile_settings_blob"
  ]
}
```

### different-account-isolated

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- A different account pulled an empty snapshot and did not see account A's row.

```json
{
  "pulled": {
    "items": [],
    "status": "ok",
    "changedHomeInputs": false,
    "hadUnsynced": false
  }
}
```

### different-profile-isolated

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- Same account, profile 2 did not receive profile 1 progress.

```json
{
  "pulled": {
    "items": [],
    "status": "ok",
    "changedHomeInputs": false,
    "hadUnsynced": false
  },
  "local": []
}
```

### local-save-before-push

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- saveProgress writes localStorage before the debounced cloud push.

```json
{
  "local": [
    {
      "contentId": "tt1000004",
      "profileId": "1",
      "source": "nuvio_sync",
      "positionMs": 170000,
      "durationMs": 7200000,
      "updatedAt": 1700000004000,
      "title": "tt1000004"
    }
  ],
  "cloudRows": 0,
  "rpc": []
}
```

### debounce-1500

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- Unconstrained push fired at 1500ms, not at 1499ms.

```json
{
  "early": 0,
  "late": 1
}
```

### constrained-debounce-15000

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- performance-constrained body class delayed the push to 15s.

```json
{
  "early": 0,
  "late": 1
}
```

### termination-before-push

- Verdict: **PASS**
- Expectation: required
- Classification: documented-policy
- Unchanged policy: teardown inside the 1500ms debounce cancels the cloud push and keeps the local row. A kill in that window loses the cloud write. Not changed in the unit fix.

```json
{
  "expected": "Local row remains and no sync_push_watch_progress is sent after teardown.",
  "actual": {
    "localKept": true,
    "pushes": 0,
    "cloudRows": 0
  },
  "callChain": [
    "player/repository saveProgress",
    "queueWatchProgressCloudSync setTimeout 1500",
    "notifySessionTeardownHandlers",
    "stopWatchProgressCloudSync increments generation and clears the timer"
  ]
}
```

### failed-push-retry-backoff

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- A failed push is not retried until 120s have passed for the same signature. The later retry committed.

```json
{
  "first": {
    "ok": false
  },
  "second": {
    "ok": false
  },
  "duringBackoff": {
    "ok": false
  },
  "afterBackoff": {
    "ok": true
  },
  "pushes": 2
}
```

### independent-changes-both-kept

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- Upserts of different keys from two clients both remain. The mock follows the client contract that a push is not a full replace.

```json
{
  "rows": ["tt1000009", "tt1000010"],
  "divergence": "none after both pushes"
}
```

### conflict-newer-local-wins

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- Both sides changed from the baseline. B's newer updatedAt kept B's position on pull.

```json
{
  "item": {
    "contentId": "tt1000011",
    "profileId": "1",
    "source": "nuvio_sync",
    "positionMs": 300000,
    "durationMs": 7200000,
    "updatedAt": 1700000030000,
    "title": "tt1000011"
  }
}
```

### conflict-equal-timestamp-remote-wins

- Verdict: **PASS**
- Expectation: required
- Classification: documented-policy
- Unchanged policy: equal updatedAt keeps the remote row because merge uses `>`. B's simultaneous 330000ms write is discarded on pull.

```json
{
  "expected": {
    "winner": "remote",
    "positionMs": 220000,
    "discardedLocalPositionMs": 330000
  },
  "actual": {
    "contentId": "tt1000012",
    "profileId": "1",
    "source": "local",
    "positionMs": 220000,
    "durationMs": 7200000,
    "updatedAt": 1700000040000,
    "title": "tt1000012"
  },
  "callChain": [
    "WatchProgressSyncService.pull",
    "mergeProgressItems",
    "localChanged && remoteChanged",
    "winner = local.updatedAt > remote.updatedAt ? local : remote"
  ]
}
```

### pending-delete-then-resave

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- A re-save while delete was in flight was pushed again after the delete. The newer local row is back in the mock cloud.

```json
{
  "rows": [
    {
      "content_id": "tt1000013",
      "content_type": "movie",
      "video_id": "tt1000013",
      "season": null,
      "episode": null,
      "position": 250000,
      "duration": 7200000,
      "last_watched": 1700000050000,
      "progress_key": "tt1000013",
      "origin_client_id": "nuvio-web-client-a"
    }
  ],
  "local": {
    "contentId": "tt1000013",
    "profileId": "1",
    "source": "nuvio_sync",
    "positionMs": 250000,
    "durationMs": 7200000,
    "updatedAt": 1700000050000,
    "title": "tt1000013"
  },
  "rpc": [
    "sync_push_watch_progress",
    "sync_pull_profile_settings_blob",
    "sync_push_profile_settings_blob",
    "sync_delete_watch_progress",
    "sync_push_watch_progress"
  ]
}
```

### empty-remote-keeps-local

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- An empty remote snapshot did not replace the nonempty local store and did not schedule an empty push.

```json
{
  "pulledStatus": "ok",
  "local": {
    "contentId": "tt1000014",
    "profileId": "1",
    "source": "nuvio_sync",
    "positionMs": 155000,
    "durationMs": 7200000,
    "updatedAt": 1700000014000,
    "title": "tt1000014"
  },
  "pushes": 0
}
```

### stale-snapshot-after-pull

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- Pull replaced the progress store but left homeContinueWatchingDisplaySnapshot unchanged. Home can still render the stale card until it rewrites the snapshot.

```json
{
  "scopeKey": "1:nuvio_sync",
  "snapshot": [
    {
      "contentId": "tt-old",
      "title": "Stale card",
      "contentType": "movie"
    }
  ],
  "store": [
    {
      "contentId": "tt1000015",
      "profileId": "1",
      "source": "local",
      "positionMs": 180000,
      "durationMs": 7200000,
      "updatedAt": 1700000015000,
      "title": ""
    }
  ],
  "pullStatus": "ok"
}
```

### home-writer-reconciles-snapshot

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- The real Home snapshot writer replaces the stale card when Home reconcile runs. Pull itself does not.

```json
{
  "fresh": [
    {
      "contentId": "tt1000016",
      "title": "Fresh card",
      "contentType": "movie"
    }
  ]
}
```

### trakt-source-skips-nuvio-cloud

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- A Trakt-selected authenticated install skips Supabase watch-progress pull. It does not show the other install's Nuvio Sync row. Divergence starts at shouldUseSupabaseWatchProgressSync.

```json
{
  "pulled": {
    "items": [],
    "status": "skipped",
    "changedHomeInputs": false,
    "hadUnsynced": false
  },
  "watching": [],
  "firstDivergence": "B.pull status skipped while cloud still holds A's row"
}
```

### trakt-filter-drops-local-source-row

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- Switching the same install to Trakt hides a tt-id row whose source does not start with trakt. Cloud push is a separate skip.

```json
{
  "before": [
    {
      "contentId": "tt1000018",
      "profileId": "1",
      "source": "nuvio_sync",
      "positionMs": 165000,
      "durationMs": 7200000,
      "updatedAt": 1700000018000,
      "title": "tt1000018"
    }
  ],
  "after": []
}
```

### profile-switch-queued-push-keeps-profile

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- The debounced push kept the profile id captured at save time. Switching the active profile did not retarget it.

```json
{
  "profile1": 1,
  "profile2": 0
}
```

### profile-switch-inflight-pull-writes-original

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- pull() resolved the profile id before the RPC. A later profile switch did not write that response into profile 2.

```json
{
  "profile1": {
    "contentId": "tt1000020",
    "profileId": "1",
    "source": "local",
    "positionMs": 190000,
    "durationMs": 7200000,
    "updatedAt": 1700000020000,
    "title": ""
  },
  "profile2": []
}
```

### older-generation-skips-home-notify

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- Stopping StartupSyncService during an in-flight watch-state pull suppresses the Home notification. The progress store is still replaced by the late response.

```json
{
  "completed": false,
  "notes": [],
  "stored": {
    "contentId": "tt1000021",
    "profileId": "1",
    "source": "local",
    "positionMs": 210000,
    "durationMs": 7200000,
    "updatedAt": 1700000021000,
    "title": ""
  }
}
```

### foreground-resume-leaves-snapshot-until-rewrite

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- Foreground watch-state scheduling does not itself rewrite the Home display snapshot. The stale card remains until Home calls writeContinueWatchingDisplaySnapshot.

```json
{
  "scheduled": true,
  "snapshot": [
    {
      "contentId": "tt-stale-resume",
      "title": "Before resume",
      "contentType": "movie"
    }
  ],
  "storeHasFresh": true,
  "notes": 1,
  "rpc": ["sync_pull_watched_items", "sync_pull_library", "sync_pull_watch_progress"]
}
```

### player-flush-saves-before-cloud

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- player flushProgress saved the local row immediately and the cloud row appeared only after the debounce.

```json
{
  "flushed": true,
  "local": {
    "contentId": "tt1000023",
    "profileId": "1",
    "source": "nuvio_sync",
    "positionMs": 125000,
    "durationMs": 7200000,
    "updatedAt": 1700000000000,
    "title": "Player"
  },
  "before": 0,
  "after": [
    {
      "content_id": "tt1000023",
      "content_type": "movie",
      "video_id": "tt1000023",
      "season": null,
      "episode": null,
      "position": 125000,
      "duration": 7200000,
      "last_watched": 1700000000000,
      "progress_key": "tt1000023",
      "origin_client_id": "nuvio-web-client-a"
    }
  ]
}
```

### short-position-duration-zero-roundtrip

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- A 10000ms position with duration 0 was pushed as position/duration and pulled without scaling. position_ms is not in the payload.

```json
{
  "expected": {
    "positionMs": 10000,
    "durationMs": 0,
    "pushedPosition": 10000,
    "pushedDuration": 0
  },
  "actual": {
    "contentId": "short-clip",
    "profileId": "",
    "source": "local",
    "positionMs": 10000,
    "durationMs": 0,
    "updatedAt": 1700000024000,
    "title": ""
  },
  "pushed": {
    "content_id": "short-clip",
    "content_type": "movie",
    "video_id": "short-clip",
    "season": null,
    "episode": null,
    "position": 10000,
    "duration": 0,
    "last_watched": 1700000024000,
    "progress_key": "short-clip",
    "origin_client_id": "nuvio-web-client-a"
  },
  "callChain": [
    "watchProgressRepository.saveProgress",
    "WatchProgressSyncService.push",
    "buildRemoteProgressEntries position/duration without _ms suffix",
    "mapProgressRow normalizeAmbiguousRemoteTime"
  ]
}
```

### legacy-seconds-pair-still-scales

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- A positive duration of 7200, at or under 28800, still scales the legacy seconds pair to milliseconds.

```json
{
  "expected": {
    "positionMs": 125000,
    "durationMs": 7200000
  },
  "actual": {
    "contentId": "legacy-seconds",
    "profileId": "",
    "source": "local",
    "positionMs": 125000,
    "durationMs": 7200000,
    "updatedAt": 1700000030000,
    "title": ""
  }
}
```

### multi-hour-milliseconds-not-scaled

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- A 90 minute position on a 2 hour duration stayed in milliseconds.

```json
{
  "actual": {
    "contentId": "multi-hour",
    "profileId": "",
    "source": "local",
    "positionMs": 5400000,
    "durationMs": 7200000,
    "updatedAt": 1700000031000,
    "title": ""
  }
}
```

### missing-null-zero-duration-not-scaled

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- Missing, null, blank, and zero duration do not scale a legacy position. A duration-0 historical 10 second row stays 10; that loss is accepted because it is indistinguishable from 10ms.

```json
{
  "actual": {
    "missing": {
      "contentId": "dur-missing",
      "profileId": "",
      "source": "local",
      "positionMs": 10000,
      "durationMs": 0,
      "updatedAt": 1700000032000,
      "title": ""
    },
    "nullDuration": {
      "contentId": "dur-null",
      "profileId": "",
      "source": "local",
      "positionMs": 10000,
      "durationMs": 0,
      "updatedAt": 1700000032001,
      "title": ""
    },
    "zero": {
      "contentId": "dur-zero",
      "profileId": "",
      "source": "local",
      "positionMs": 10000,
      "durationMs": 0,
      "updatedAt": 1700000032002,
      "title": ""
    },
    "blank": {
      "contentId": "dur-blank",
      "profileId": "",
      "source": "local",
      "positionMs": 10000,
      "durationMs": 0,
      "updatedAt": 1700000032003,
      "title": ""
    },
    "historicalSeconds": {
      "contentId": "historical-seconds-unscaled",
      "profileId": "",
      "source": "local",
      "positionMs": 10,
      "durationMs": 0,
      "updatedAt": 1700000032004,
      "title": ""
    }
  }
}
```

### seconds-versus-milliseconds-boundary

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- Duration 28800 still scales as seconds. Duration 60000, the smallest syncable value above 28800, stays milliseconds. A 28801ms row is below the 60s sync minimum and is dropped by pull, so it is not the boundary observed here. Explicit position_ms is preferred by the reader, but the published push RPC drops that key, so the writer must not depend on it.

```json
{
  "seconds": {
    "contentId": "boundary-seconds",
    "profileId": "",
    "source": "local",
    "positionMs": 10000,
    "durationMs": 28800000,
    "updatedAt": 1700000033000,
    "title": ""
  },
  "milliseconds": {
    "contentId": "boundary-ms",
    "profileId": "",
    "source": "local",
    "positionMs": 10,
    "durationMs": 60000,
    "updatedAt": 1700000033001,
    "title": ""
  },
  "explicit": {
    "contentId": "explicit-ms",
    "profileId": "",
    "source": "local",
    "positionMs": 10000,
    "durationMs": 7200000,
    "updatedAt": 1700000033002,
    "title": ""
  }
}
```

### duration-zero-isolated-clients-no-watched-mutation

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- The duration-0 row stayed on account A at 10000ms, account B did not see it, and watchedItems was not mutated.

```json
{
  "seeded": [
    {
      "profileId": "1",
      "contentId": "tt-watched-only",
      "contentType": "movie",
      "imdbId": null,
      "tmdbId": null,
      "traktId": null,
      "slug": null,
      "title": "Watched only",
      "season": null,
      "episode": null,
      "watchedAt": 1700000001000
    }
  ],
  "watchedAfter": [
    {
      "profileId": "1",
      "contentId": "tt-watched-only",
      "contentType": "movie",
      "imdbId": null,
      "tmdbId": null,
      "traktId": null,
      "slug": null,
      "title": "Watched only",
      "season": null,
      "episode": null,
      "watchedAt": 1700000001000
    }
  ],
  "otherAccount": [],
  "sameAccount": {
    "contentId": "short-isolated",
    "profileId": "",
    "source": "local",
    "positionMs": 10000,
    "durationMs": 0,
    "updatedAt": 1700000034000,
    "title": "Isolated short"
  }
}
```

### empty-push-does-not-wipe-cloud

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- B had no local rows. push() returned success and did not send an empty payload, so A's cloud row remained.

```json
{
  "pushed": {
    "ok": true
  },
  "rows": 1,
  "rpc": []
}
```

### installation-ids-differ

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- Two installs minted different client ids. The id is sent on push and is not the merge key.

```json
{
  "a": "nuvio-web-client-a",
  "b": "nuvio-web-client-b",
  "origin": "nuvio-web-client-a"
}
```

### double-save-one-push

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- A second save inside the debounce replaced the timer. One push carried the later position.

```json
{
  "early": 0,
  "pushes": [
    {
      "clientName": "A",
      "name": "sync_push_watch_progress",
      "account": "account-a",
      "profile": "1",
      "origin": "nuvio-web-client-a",
      "entries": [
        {
          "key": "tt1000026",
          "position": 180000,
          "duration": 7200000,
          "lastWatched": 1700000027500
        }
      ],
      "keys": []
    }
  ]
}
```

### proxy-document-before-api-ready

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- Running the proxy document injects the official iframe_api script. Before onYouTubeIframeAPIReady, no player exists and no ready or firstFrame message is posted.

```json
{
  "script": "https://www.youtube.com/iframe_api?_cb=1700000000000-9",
  "players": 0,
  "messages": []
}
```

### api-ready-and-playing-at-zero-are-not-first-frame

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- onReady posts ready and calls playVideo. currentTime is still 0, so firstFrame is not posted. API ready is not a decoded frame.

```json
{
  "types": ["ready", "state"],
  "state": 1,
  "currentTime": 0
}
```

### buffering-is-not-first-frame

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- playerState 3 (buffering) does not emit firstFrame.

```json
{
  "types": ["state"]
}
```

### first-frame-once-when-playing-past-zero

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- The state poll emits firstFrame once when playerState is playing and currentTime > 0. A later poll does not emit it again.

```json
{
  "firstFrames": 1,
  "sample": {
    "source": "nuvio-youtube-proxy",
    "type": "firstFrame",
    "videoId": "abcdefghijk",
    "currentTime": 0.4
  }
}
```

### watchdog-4500-direct-embed

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- If onReady has not fired, the 4500ms watchdog destroys the API player and inserts a direct youtube.com/embed iframe. That is a fallback document, not a firstFrame.

```json
{
  "before": false,
  "src": "https://www.youtube.com/embed/abcdefghijk?autoplay=1&mute=0&controls=0&loop=1&playlist=abcdefghijk&playsinline=1&rel=0&modestbranding=1&cc_load_policy=0&iv_load_policy=3&widget_referrer=https%3A%2F%2Fnuvio.local%2Fyoutube-proxy.html%3Fv%3Dabcdefghijk",
  "firstFrame": false
}
```

### direct-param-skips-api

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- direct=1 skips iframe_api and inserts the embed iframe immediately. No YT.Player is constructed.

```json
{
  "src": "https://www.youtube.com/embed/abcdefghijk?autoplay=1&mute=0&controls=0&loop=1&playlist=abcdefghijk&playsinline=1&rel=0&modestbranding=1&cc_load_policy=0&iv_load_policy=3&widget_referrer=https%3A%2F%2Fnuvio.local%2Fyoutube-proxy.html%3Fdirect%3D1%26v%3Dabcdefghijk"
}
```

### stale-command-source-ignored

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- Proxy commands are accepted only from window.parent with source nuvio-detail-trailer. A foreign source or a non-parent window does not pause.

```json
{
  "ignored": true,
  "wrongSource": true,
  "accepted": true
}
```

### missing-video-id-does-not-autoplay

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- A missing, blank, short, or spaced v does not load iframe_api, construct YT.Player, or insert a direct embed. The page posts error. An explicit qBg39HCJiTU still starts, so the old default is not banned.

```json
{
  "expected": "No YT.Player, iframe_api, or direct embed unless v is 11 url-safe characters.",
  "actual": {
    "missing": {
      "players": 0,
      "apiScripts": 0,
      "frames": 0,
      "types": ["error", "error"],
      "messages": [
        {
          "source": "nuvio-youtube-proxy",
          "type": "error",
          "videoId": "",
          "reason": "missing-video-id"
        },
        {
          "source": "nuvio-youtube-proxy",
          "type": "error",
          "videoId": "",
          "reason": "missing-video-id"
        }
      ]
    },
    "blank": {
      "players": 0,
      "apiScripts": 0,
      "frames": 0,
      "types": ["error", "error"],
      "messages": [
        {
          "source": "nuvio-youtube-proxy",
          "type": "error",
          "videoId": "",
          "reason": "missing-video-id"
        },
        {
          "source": "nuvio-youtube-proxy",
          "type": "error",
          "videoId": "",
          "reason": "missing-video-id"
        }
      ]
    },
    "shortId": {
      "players": 0,
      "apiScripts": 0,
      "frames": 0,
      "types": ["error", "error"],
      "messages": [
        {
          "source": "nuvio-youtube-proxy",
          "type": "error",
          "videoId": "abcdefghij",
          "reason": "missing-video-id"
        },
        {
          "source": "nuvio-youtube-proxy",
          "type": "error",
          "videoId": "abcdefghij",
          "reason": "missing-video-id"
        }
      ]
    },
    "spaced": {
      "players": 0,
      "apiScripts": 0,
      "frames": 0,
      "types": ["error", "error"],
      "messages": [
        {
          "source": "nuvio-youtube-proxy",
          "type": "error",
          "videoId": "abc defghij",
          "reason": "missing-video-id"
        },
        {
          "source": "nuvio-youtube-proxy",
          "type": "error",
          "videoId": "abc defghij",
          "reason": "missing-video-id"
        }
      ]
    },
    "directMissing": {
      "players": 0,
      "apiScripts": 0,
      "frames": 0,
      "types": ["error", "error"],
      "messages": [
        {
          "source": "nuvio-youtube-proxy",
          "type": "error",
          "videoId": "",
          "reason": "missing-video-id"
        },
        {
          "source": "nuvio-youtube-proxy",
          "type": "error",
          "videoId": "",
          "reason": "missing-video-id"
        }
      ]
    },
    "explicitVideoId": "qBg39HCJiTU"
  },
  "callChain": [
    "docs/youtube-proxy.html query parse",
    "isPlayableVideoId",
    "postToParent error",
    "return before YT.Player and iframe_api"
  ]
}
```

### home-load-is-not-immediate-ready

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- Home does not mark the trailer active on iframe load, nor at 6999ms. The load event only arms a timer.

```json
{
  "beforeLoad": false,
  "beforeFallback": false,
  "revealed": 0
}
```

### home-7s-load-fallback-is-not-playback

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- 7000ms after iframe load adds is-unconfirmed and does not add is-active or call onReady. The surface is visible without counting as confirmed playback.

```json
{
  "expected": {
    "isActive": false,
    "onReadyCalls": 0,
    "isUnconfirmed": true
  },
  "actual": {
    "afterFallback": false,
    "revealed": 0,
    "unconfirmed": true,
    "currentTime": 0
  },
  "callChain": [
    "homeScreenMethods-13-mount-trailer-layer.js frame load listener",
    "setTimeout(showUnconfirmed, 7000)",
    "container.classList.add(is-unconfirmed)"
  ]
}
```

### home-first-frame-reveals-after-150

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- Home ignores a firstFrame from the wrong window or the wrong source. A matching firstFrame reveals 150ms later, not immediately.

```json
{
  "foreignIgnored": true,
  "wrongSourceIgnored": true,
  "beforeDelay": true,
  "afterDelay": true,
  "revealed": 1
}
```

### home-direct-embed-state-is-not-first-frame

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- A controllable:false, loading:false state at currentTime 0 shows is-unconfirmed after 1200ms and does not call onReady. Direct embed remains visible without a first-frame claim.

```json
{
  "expected": {
    "isActive": false,
    "onReadyCalls": 0,
    "isUnconfirmed": true
  },
  "actual": {
    "before": false,
    "after": false,
    "revealed": 0,
    "unconfirmed": true
  },
  "callChain": [
    "docs/youtube-proxy.html direct embed load posts loading:false currentTime:0",
    "homeScreenMethods-13 controllable === false && loading === false",
    "showUnconfirmed(1200)"
  ]
}
```

### home-unconfirmed-timeout-still-confirms-first-frame

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- API ready, buffering, and playing at currentTime 0 do not confirm. The 7s timeout shows is-unconfirmed, and a later firstFrame still calls onReady and replaces that class with is-active.

```json
{
  "ignoredEarly": true,
  "unconfirmed": true,
  "confirmed": true,
  "revealed": 1
}
```

### home-error-clears-unconfirmed-without-blocking-later-frame

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- An error message removes the unconfirmed surface and does not call onReady. A later playing state with currentTime > 0 can still confirm.

```json
{
  "clearedError": true,
  "laterFrame": true,
  "revealed": 1
}
```

### home-unconfirmed-css-is-visible

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- is-unconfirmed has a hero opacity rule and an expanded poster display rule, so timeout recovery is not left at opacity 0. It does not use trailer-active.

```json
{
  "heroRule": true,
  "posterRule": true
}
```

### home-clear-removes-timer-listener-and-frame

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- clearTrailerLayer removes the message listener, clears the 7s timer, blanks the iframe, and does not reveal after the abandoned timer.

```json
{
  "listenersBefore": 1,
  "listenersAfter": 0,
  "revealed": 0,
  "src": ""
}
```

### rapid-home-details-back-cleans-up

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- Details rejects a foreign window and a stale video id, accepts a matching firstFrame, and the real cleanup removes the listener. Home clear blanks its iframe. No further firstFrame is applied.

```json
{
  "rejectedForeign": true,
  "rejectedStaleId": true,
  "accepted": true,
  "afterBack": true,
  "cleanupThrew": false,
  "listeners": 0
}
```

### missing-metadata-does-not-mount-player

- Verdict: **PASS**
- Expectation: required
- Classification: verified-behavior
- resolveTrailerSource and buildYoutubeEmbedUrl produce no embed when metadata has no video id. Home does not mount an iframe for an empty embedUrl. This is separate from the proxy page's own default id.

```json
{
  "missing": null,
  "blank": null,
  "emptyUrl": "",
  "present": "https://nuvio.local/youtube-proxy.html?v=abcdefghijk&autoplay=1&muted=1&controls=0&loop=1&playlist=abcdefghijk&playsinline=1&rel=0&cc_load_policy=0&_cb=1700000000000-e9inxr"
}
```

### tv-first-rendered-frame

- Verdict: **NOT_RUN**
- Expectation: required
- Classification: not-run
- A virtual document cannot prove the first composited frame on the LG 65UR78006LL. firstFrame remains a player-API signal, not a TV frame.

```json
{
  "device": "65UR78006LL",
  "webos": "8.4",
  "chromium": "94"
}
```
