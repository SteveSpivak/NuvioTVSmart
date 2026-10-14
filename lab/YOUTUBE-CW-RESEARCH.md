# YouTube player and Continue Watching sync — research only

Date: 2026-10-14. Target: LG `65UR78006LL`, webOS 8.4, Chromium 94.
Branch: `arena/0ffafbca-nuvio-perf-lab`. No production change, no TV test,
no account change, no storage clear.

This note reconstructs what the source actually does. It does not execute
the tests it designs. An iframe `load` is not playback. Nothing here
recommends bypassing YouTube's player, ads, authentication, or access
controls, or copying an Android media engine into webOS JavaScript.

## Phase 0 — which player

| Candidate                                 | Status              | Why                                                                                                                                                                                                                              |
| ----------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Separate TV-installed ad-free YouTube app | **UNKNOWN**         | No name, package id, or binary in this tree. Do not invent one.                                                                                                                                                                  |
| SmartTube / NewPipe / Invidious / Piped   | **NOT THIS APP**    | Repo search of `lab/`, `docs/`, and README finds no such client. Public SmartTube docs describe an Android TV / Fire OS player and say it does not run on LG webOS. Not a webOS JavaScript port.                                 |
| YouTube Premium                           | **NOT EVIDENCED**   | No Premium flag, entitlement, or account type in the trailer path.                                                                                                                                                               |
| Nuvio iframe proxy                        | **PROVEN, in-tree** | `docs/youtube-proxy.html` plus `YOUTUBE_PROXY_URL` default `youtube-proxy.html` (`js/config.js`, `js/runtime/env.js`). Parent messages use `source: "nuvio-youtube-proxy"`. Home, Details, and post-play listen for that source. |

The only player this repository can reverse-engineer is the official
YouTube IFrame API, loaded by Nuvio's local proxy page. A faster
ad-free TV app, if one is installed beside Nuvio, is a different process.
Its startup cannot be reconstructed from this checkout.

## Track A — proxy startup, from source

`docs/youtube-proxy.html` is a same-origin page Nuvio loads in an iframe.
It is not a media engine.

1. Query parse: `v` (default `qBg39HCJiTU` if missing), `muted`,
   `autoplay` (default on), `loop` (default on), `cc_load_policy`,
   `direct=1`, `state_poll_ms` (default 250), `_cb`.
2. Unless `direct=1`, it injects
   `https://www.youtube.com/iframe_api` with a cache-buster query.
3. `onYouTubeIframeAPIReady` constructs `YT.Player` on `#yt` with
   `host: "https://www.youtube.com"`, `controls: 0`, `enablejsapi: 1`,
   `origin` only when the page origin is `http(s)`.
4. `onReady` sets `ready`, mutes or unmutes, calls `playVideo()` if
   autoplay, posts `type: "ready"`, starts the state timer.
5. First frame is a **separate** message: `type: "firstFrame"` only when
   `playerState === 1` and `currentTime > 0`. Polling also posts `state`.
6. Commands arrive only from `window.parent` with
   `source: "nuvio-detail-trailer"` and `type: "command"`
   (`play`, `pause`, `seekTo`, `seekBy`, `setMuted`, captions, `getState`).
7. `onError`, or a 4500 ms watchdog if `onReady` never fires, destroys the
   API player and inserts a direct `youtube.com/embed` iframe
   (`controls=0`, `rel=0`). That path sets `controllable: false`. Its
   iframe `load` posts `loading: false` with `currentTime: 0`. That is
   document load, not a decoded frame.
8. `beforeunload` clears the state timer. No webOS Luna media API, no
   MSE, no decoder pre-init.

### What each signal means

| Signal                                      | Means                                                                                   | Does not mean                                                                                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Proxy iframe `load`                         | The proxy document parsed.                                                              | Video id resolved, player ready, or a frame decoded. Home starts a 7000 ms reveal timer on this event (`homeScreenMethods-13-mount-trailer-layer.js`). |
| `type: "ready"`                             | IFrame API `onReady`.                                                                   | First painted frame. Playback may still be buffering (`playerState` 3) or unstarted (-1).                                                              |
| `type: "firstFrame"`                        | API reports playing and `currentTime > 0`.                                              | A compositor frame on the TV. It is the closest in-tree proxy for perceived playback.                                                                  |
| `state.currentTime > 0 && paused === false` | Same practical bar, via the 250 ms poll.                                                | Layout or DNS cost.                                                                                                                                    |
| Direct-embed `loading: false`               | Fallback iframe fired `load`. Home reveals after 1200 ms when `controllable === false`. | Playback.                                                                                                                                              |
| 7000 ms fallback reveal                     | Home gave up waiting.                                                                   | Success.                                                                                                                                               |

Costs that must stay separate in any later measurement: proxy document
fetch (usually same-origin, cheap), `iframe_api` script + DNS/TLS to
`youtube.com`, player config, layout of the hidden iframe, decoder/first
frame, and the 150 ms reveal delay after `firstFrame`. Warm vs cold is
YouTube and Chromium cache state, not a Nuvio flag. Metadata prefetch
(TMDB video id) does not initialize the decoder.

Do not treat Android SmartTube's ExoPlayer / extractor path as portable.
webOS 8.4's media stack is the Chromium media pipeline plus webOS media
services. An APK decoder, codec selector, or stream extractor does not
run inside this JavaScript app, and copying one would be the bypass this
note refuses.

## Track B — trailer tests to design, not run

Smallest read-only probes, in order. Do not clear site data. Do not play
a title the account should not play. Use a known public trailer id already
in the proxy default or a TMDB trailer the app already resolved.

| Id  | Probe                                                                                          | Pass condition                                                            | Isolates                                                      |
| --- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| T1  | Record timestamps already logged or visible: proxy `load`, `ready`, `firstFrame`, Home reveal. | Four numbers, not one.                                                    | Startup vs first frame.                                       |
| T2  | Repeat the same id without navigation.                                                         | Second `iframe_api` / TLS delta vs first.                                 | Warm cache vs cold.                                           |
| T3  | Home focus, then Details for the same title, then Back.                                        | One live iframe after teardown; no second decoder left attached.          | webOS one-media rule. Count nodes; do not infer from silence. |
| T4  | D-pad during the 150 ms reveal and during the 7000 ms fallback.                                | Focus target is the page, not the iframe (`disablekb: 1` is player-only). | Remote focus.                                                 |
| T5  | `direct=1` vs API path, same id.                                                               | Compare `firstFrame` absence on the direct path.                          | False-ready from iframe `load`.                               |

Do not prefetch by constructing a hidden `YT.Player` on Home. That is
decoder pre-init, not metadata prefetch, and it fights the single media
pipeline.

### Feasibility, ranked for this TV

| Rank | Pattern                                                                                                           | Fit                                                            | Blocker                                                                                                       |
| ---- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1    | Keep the official iframe; measure `firstFrame` separately from `load` and from the 7000 ms reveal.                | Already shipped. No new player.                                | Does not remove YouTube's own startup.                                                                        |
| 2    | Existing proxy only: drop the default video id when `v` is missing; do not start a player until a real id exists. | Small, source-local, still official.                           | Not a latency win by itself. Avoids a wasted player.                                                          |
| 3    | External app handoff (user-installed YouTube or an unknown ad-free app).                                          | Possible only as `application.launcher` to a **known** app id. | Installed alternative is UNKNOWN. No id to launch. Handoff leaves Nuvio and does not sync trailer state back. |
| 4    | Android ad-free client patterns (native decoder, no iframe).                                                      | Not applicable.                                                | No webOS runtime. Would bypass the player. Do not port.                                                       |

## Track C — Continue Watching path

Package id in this tree is `space.nuvio.webos` (`appinfo.json`). The lab
emulator uses the same id. There is no second package id. Two installs
with that id cannot sit side by side on webOS; installing one replaces
the other and keeps that app's `localStorage`. A differently packaged
"Nuvio Lab" is not in this checkout. If one exists on the TV, its id is
**UNKNOWN**.

Cloud progress is account + profile, not package. `WatchProgressSyncService`
calls Supabase RPCs `sync_pull_watch_progress`, `sync_push_watch_progress`,
and `sync_delete_watch_progress` with `p_profile_id` and
`p_origin_client_id`. The client id is `nuvio_web_installation_id` in
`localStorage` (`js/core/sync/syncClientIdentity.js`), prefixed
`nuvio-web-`. Same app id keeps the same installation id across a lab
overlay. A second package would mint a new id and still merge in the cloud
if it signs into the same account and profile.

### Write path

1. Player flush (`playerControllerMethods-20-flush-progress.js`) calls
   `watchProgressRepository.saveProgress` with position, duration, ids.
2. `saveProgress` upserts `WatchProgressStore` (`localStorage` key
   `watchProgressItems`), stamps `updatedAt` if missing, and queues a cloud
   push. Debounce is 1500 ms, or 15000 ms when `performance-constrained`
   is on the body.
3. Push (`pushOnce`) refuses an empty payload so a transient empty local
   list cannot wipe remote. It skips a push whose signature matches the
   last success. Deletes are an explicit RPC plus pending-delete keys.
4. Pull (`StartupSyncService` watch-state sync, and periodic pull) loads
   remote rows, merges, then `replaceAll`s the local store. An empty remote
   list does **not** replace a non-empty local list.
5. Merge (`mergeProgressItems`): pending deletes win (row dropped). If only
   one side changed versus the baseline snapshot, that side wins. If both
   changed, the newer `updatedAt` wins. A remote row with no local row is
   rehydrated. A local row missing remotely is kept only if it never had a
   baseline or it changed since the baseline.
6. Home reads `getAllForContinueWatching` / recent progress, not the cloud
   RPC directly. Display snapshot key
   `homeContinueWatchingDisplaySnapshot` is local, keyed by
   `profileId:source`. Pull does not delete it. Home is supposed to
   reconcile it. Nuvio Sync source reports `loaded: true` immediately
   (`getContinueWatchingRemoteProgressState`); Trakt/Simkl wait on their
   own remote flags. An empty local Continue Watching row waits for the
   startup pull; a non-empty local row is published first.

Selected source: Trakt if requested and authenticated, else Simkl if
requested and authenticated, else `nuvio_sync`
(`selectedContinueWatchingSource`). Playback still writes a local row
(`trakt_local` / `simkl_local` / `nuvio_sync`). Trakt scrobble
(`traktScrobbleService.js`) is a separate HTTP surface from the Supabase
progress RPCs.

## Track D — hypotheses

Evidence below is source structure, not a TV run. Status is NOT_RUN unless
noted as code-proven.

| Id  | Hypothesis                                                                            | Smallest read-only check                                                    | Code lean                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | Lab and production do not share `localStorage` because they are different apps.       | Read `appinfo.json` id on both installs. This tree has one id.              | If both are `space.nuvio.webos`, they share storage only as replacements, not side by side.                                                                                                                           |
| H2  | Cloud merge fails because client ids differ.                                          | Compare `nuvio_web_installation_id` only. Do not reset it.                  | Client id is an RPC argument, not the merge key. Merge is per progress key + `updatedAt`.                                                                                                                             |
| H3  | A lab push with an older `updatedAt` loses to production.                             | Synthetic two-row fixture, same progress key, different `updatedAt`. No TV. | Code-proven: both-changed uses numeric `updatedAt`. Clock skew can drop the later viewing.                                                                                                                            |
| H4  | Empty pull wipes the other install.                                                   | Inspect pull empty-remote branch.                                           | Code-proven guard: empty remote + non-empty local returns local and does not advance baseline.                                                                                                                        |
| H5  | Home shows a stale row after a successful pull.                                       | Compare snapshot key vs `watchProgressItems` after pull, in a fixture.      | Snapshot is not cleared in `replaceAll`. Home must reconcile. NOT_RUN on device.                                                                                                                                      |
| H6  | Nuvio Sync Home waits forever for remote `loaded`.                                    | Read `getContinueWatchingRemoteProgressState` for `NUVIO_SYNC`.             | Code-proven: `loaded: true` always. The wait is `StartupSyncService.isCurrentProfilePullPending`, and only when the local row is empty.                                                                               |
| H7  | Debounce drops the last seconds if the app is killed inside 1500 ms.                  | Not executable here.                                                        | Code-proven window: push is timer-based. Kill before the timer loses the cloud write; local upsert already happened.                                                                                                  |
| H8  | `performance-constrained` stretches that window to 15 s.                              | Check body class on the TV log only. Do not toggle it for this note.        | Code-proven delay selection.                                                                                                                                                                                          |
| H9  | Trakt-selected Continue Watching hides a Nuvio Sync row written by the other install. | Fixture: source `nuvio_sync` while settings select Trakt.                   | `filterForSelectedContinueWatchingSource` can drop it from the row even if the cloud row exists. NOT_RUN.                                                                                                             |
| H10 | Pending delete on one install removes a row the other install just re-saved.          | Fixture only.                                                               | Pending delete skips the key in merge until the delete RPC succeeds. A later local upsert cancels that key if it is in the local set at push time. Race is real if the two writes interleave around the RPC. NOT_RUN. |

## Track E — deterministic fixtures (do not apply to the TV)

Build two in-memory profiles, not two app installs. Feed
`mergeProgressItems` and the Home signature helpers with plain objects.

1. Same key, local newer, remote unchanged vs baseline → local kept.
2. Same key, remote newer, local unchanged → remote kept, local poster
   fields preserved (`preserveLocalProgressMetadata`).
3. Both newer, local `updatedAt` greater → local wins. Swap timestamps →
   remote wins. Equal timestamps → remote wins (`>` not `>=`).
4. Remote empty, local non-empty → pull function returns local (do not
   call the network).
5. Pending delete key present → key absent from merge even if remote still
   has it.
6. Display snapshot present, store replaced → snapshot key still set until
   a Home reconcile function deletes it.

No `localStorage.clear`, no Trakt reconnect, no "mark watched", no push to
the live Supabase project.

## What this note does not claim

- That an ad-free player is installed on the TV.
- That any trailer timing above was measured on the 65UR78006LL.
- That sync hypotheses H5, H7, H9, H10 have been observed.
- That changing the proxy, the debounce, or the merge is justified. Those
  are unmeasured.
