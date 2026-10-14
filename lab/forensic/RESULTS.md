# Forensic test results

Recorded by `node lab/forensic/run-all.mjs` on Node v22.22.3.
Branch `arena/0ffafbca-nuvio-perf-lab`. HEAD at run start `82789f7106cf23392e33f01b53b3e5907f90a5c4`.
No live Supabase, Trakt, or TV call. Production sync and trailer code were not modified.

## Commands

- `node lab/forensic/exit-policy.test.mjs` exit 0 in 46ms
- `node lab/forensic/run-sync-forensics.mjs` exit 0 in 5882ms
- `node lab/forensic/run-sync-forensics.mjs` exit 0 in 6370ms
- `node lab/forensic/run-youtube-forensics.mjs` exit 0 in 271ms
- `node lab/forensic/run-youtube-forensics.mjs` exit 0 in 368ms
- Repeated each suite once. Verdict signatures matched: **yes**.
- `tests/` is absent and gitignored. `npm test` was not run. Existing plugin tests: **BLOCKED**.
- Full `npm run build` / webOS package: **NOT_RUN**. The suites imported the current modules, which is the practical parse check for this pass.

## Counts

| Verdict | Count |
| --- | --- |
| PASS | 35 |
| FAIL | 6 |
| EXPECTED_FAIL | 6 |
| BLOCKED | 0 |
| NOT_RUN | 1 |

Suite cases: 42. EXPECTED_FAIL is a subset of FAIL, not a pass. Existing plugin tests are not in this count; they are BLOCKED because `tests/` is absent.

Runner mode: `investigate`. Exit decision: 0 (investigate). Strict regression, treating every FAIL as required, would exit 1. Investigate exit 0 does not pass the expected failures.
Node v22.22.3. FORENSIC_MODE=investigate. FORENSIC_STRICT=0.

## Tooling

- `node --check` is not part of this runner. The runner's own exit code is the execution check.
- Repo `npm run lint` was not run: `node_modules` is not installed, and `npx eslint` cannot load `@eslint/js` from the repo config. Status: **BLOCKED**.
- `npm run build` was not run. Status: **NOT_RUN**.

## Reproduced failures

- **termination-before-push** (sync): Session teardown before the debounce cancels the cloud push. The local row remains. A kill inside the debounce window loses the cloud write.

- **conflict-equal-timestamp-remote-wins** (sync): Equal updatedAt values take the remote row because the comparison is `>`, not `>=`. B's simultaneous local position is discarded on pull.

- **short-position-duration-zero-roundtrip** (sync): Pull inflated a 10s position because the legacy position/duration fields have no unit and duration 0 does not force millisecond mode.

- **missing-video-id-does-not-autoplay** (youtube): youtube-proxy.html defaults a missing v parameter to qBg39HCJiTU and autoplays it. A metadata miss still starts a player.

- **home-7s-load-fallback-is-not-playback** (youtube): 7000ms after iframe load, Home adds is-active and calls onReady with no firstFrame and no currentTime. Iframe load plus a timer is treated as trailer readiness.

- **home-direct-embed-state-is-not-first-frame** (youtube): Home reveals 1200ms after a controllable:false, loading:false state with currentTime 0. That is the direct-embed load signal, not a frame.

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

## Ranked corrections (not applied)

1. Do not add `position_ms` to the push. The published self-host `sync_push_watch_progress` stores only `position` and `duration`, and the pull returns those columns. Fix the reader: missing, null, or non-positive duration must not scale a legacy position. Keep the seconds-pair scale only when a positive duration is `<= 28800`.
2. Do not reveal the Home trailer on the 7000ms iframe-load timer or the 1200ms uncontrollable `loading:false` state unless `firstFrame` or `currentTime > 0` has arrived. Keep those timers as a loading affordance, not `is-active`.
3. Remove the hardcoded default video id in `docs/youtube-proxy.html`. If `v` is missing, post an error and do not construct `YT.Player`.
4. Do not change the equal-`updatedAt` tie or the 1.5s / 15s debounce without a product decision. Both are implemented as written. The tie drops the local write. A kill inside the debounce keeps the local row and loses the cloud write.
5. Do not expect a Trakt-selected install and a Nuvio Sync install to share Continue Watching through Supabase. That skip is explicit. Parity would be a product change, not a one-line fix.

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

- Verdict: **FAIL**
- Expectation: expected
- Classification: reproduced-defect
- Session teardown before the debounce cancels the cloud push. The local row remains. A kill inside the debounce window loses the cloud write.

```json
{
  "expected": "Local save is durable to the mock cloud even if teardown happens 500ms later.",
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
  "rows": [
    "tt1000009",
    "tt1000010"
  ],
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

- Verdict: **FAIL**
- Expectation: expected
- Classification: reproduced-defect
- Equal updatedAt values take the remote row because the comparison is `>`, not `>=`. B's simultaneous local position is discarded on pull.

```json
{
  "expected": "A tie should not silently drop the local write, or the winner should be explicit and stable across clients.",
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
  "rpc": [
    "sync_pull_watched_items",
    "sync_pull_library",
    "sync_pull_watch_progress"
  ]
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

- Verdict: **FAIL**
- Expectation: expected
- Classification: reproduced-defect
- Pull inflated a 10s position because the legacy position/duration fields have no unit and duration 0 does not force millisecond mode.

```json
{
  "expected": {
    "positionMs": 10000,
    "durationMs": 0
  },
  "actual": {
    "contentId": "short-clip",
    "profileId": "",
    "source": "local",
    "positionMs": 10000000,
    "durationMs": 0,
    "updatedAt": 1700000024000,
    "title": ""
  },
  "callChain": [
    "watchProgressRepository.saveProgress",
    "WatchProgressSyncService.push",
    "buildRemoteProgressEntries position/duration without _ms suffix",
    "mapProgressRow normalizeAmbiguousRemoteTime"
  ]
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
  "types": [
    "ready",
    "state"
  ],
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
  "types": [
    "state"
  ]
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

- Verdict: **FAIL**
- Expectation: expected
- Classification: reproduced-defect
- youtube-proxy.html defaults a missing v parameter to qBg39HCJiTU and autoplays it. A metadata miss still starts a player.

```json
{
  "expected": "No YT.Player and no playVideo when v is absent.",
  "actual": {
    "videoId": "qBg39HCJiTU",
    "state": 1
  },
  "callChain": [
    "docs/youtube-proxy.html query parse",
    "videoId = params.v || default",
    "onReady playVideo"
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
  "revealed": 1
}
```

### home-7s-load-fallback-is-not-playback

- Verdict: **FAIL**
- Expectation: expected
- Classification: reproduced-defect
- 7000ms after iframe load, Home adds is-active and calls onReady with no firstFrame and no currentTime. Iframe load plus a timer is treated as trailer readiness.

```json
{
  "expected": "is-active only after a first-frame signal.",
  "actual": {
    "afterFallback": true,
    "revealed": 1,
    "currentTime": 0
  },
  "callChain": [
    "homeScreenMethods-13-mount-trailer-layer.js frame load listener",
    "setTimeout(reveal, 7000)",
    "container.classList.add(is-active)"
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

- Verdict: **FAIL**
- Expectation: expected
- Classification: reproduced-defect
- Home reveals 1200ms after a controllable:false, loading:false state with currentTime 0. That is the direct-embed load signal, not a frame.

```json
{
  "expected": "No is-active without currentTime > 0 or firstFrame.",
  "actual": {
    "before": false,
    "after": true
  },
  "callChain": [
    "docs/youtube-proxy.html direct embed load posts loading:false currentTime:0",
    "homeScreenMethods-13 controllable === false && loading === false",
    "reveal(1200)"
  ]
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
  "present": "https://nuvio.local/youtube-proxy.html?v=abcdefghijk&autoplay=1&muted=1&controls=0&loop=1&playlist=abcdefghijk&playsinline=1&rel=0&cc_load_policy=0&_cb=1700000000000-b3zyoq"
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
