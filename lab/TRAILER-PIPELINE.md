# Trailer pipeline

**A trailer id in metadata is not a playable video. Nuvio builds a YouTube embed URL, mounts one iframe, and reveals it only after a proxy message or a long fallback. Trailer readiness was not measured. It is not Details visible time, not settle time, and not first selectable source.**

Provenance: embed code read on `arena/0ffafbca-nuvio-perf-lab` after merge `532d893` (lab `deaf7e0`). Television Details numbers are from `9019da8`. Those JSON files do not record a trailer event. Row-window switch from `aa86246` is unrelated and stays off.

No trailer code was changed. Do not bypass the YouTube player, the embed origin check, or the webOS one-media rule.

## Path

| Stage               | Owner                                                                                  | Behavior                                                                                                                                                                                                             | Label                                                                       |
| ------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Id from meta        | `resolveTrailerSource` in `metaDetailsScreenHelpers-06-build-youtube-embed-url.js:196` | Walks `trailers`, then `videos`, then `trailerYtIds`. Accepts an 11-character id, `v=`, `youtu.be/`, or `embed/`.                                                                                                    | PROVEN                                                                      |
| Id from TMDB        | `resolveTmdbTrailerSource`                                                             | If settings allow trailers, `ensureTmdbId` (1.8 s) then `fetchTrailerCandidates`. Falls back to the meta id. Enrichment already asks TMDB for `videos` via `append_to_response`.                                     | PROVEN. Whether Details calls both is UNKNOWN until a waterfall logs paths. |
| URL                 | `buildYoutubeEmbedUrl` / `buildInlineYoutubePlayerUrl`                                 | webOS/Tizen with no https proxy: direct embed, because a `file://` proxy gets YouTube error 153. Otherwise the configured proxy, else `youtube-nocookie.com/embed/{id}`.                                             | PROVEN. `shouldUseDirectYoutubeEmbedOnTv`                                   |
| Proxy page          | `YOUTUBE_PROXY_URL`, local file `youtube-proxy.html`                                   | webOS prefers an https proxy when configured. The iframe listens for `source === "nuvio-youtube-proxy"`.                                                                                                             | PROVEN. Proxy contents were not executed here.                              |
| Home mount          | `homeScreenMethods-13-mount-trailer-layer.js`                                          | One iframe, `allow="autoplay; encrypted-media; picture-in-picture"`, referrer `strict-origin-when-cross-origin`. Reveal on `firstFrame` (150 ms delay), or on playing state, or 7 s after `load` if nothing arrived. | PROVEN. Reveal is not proof the file is the expected video.                 |
| Details mount       | `metaDetailsScreenMethods-19-toggle-active-trailer-playback.js`                        | Separate iframe in `.detail-trailer-youtube`. User action, not the Home hero timer.                                                                                                                                  | PROVEN file exists. Timing NOT_RUN.                                         |
| Direct file trailer | same Home mount, `source.kind === "video"`                                             | A `<video>` with `preload=auto`, loop, muted by default.                                                                                                                                                             | PROVEN. A URL string is still not a verified playable file.                 |

YouTube's own parameter page (https://developers.google.com/youtube/player_parameters) says autoplay starts playback without a user gesture, and `enablejsapi=1` should include `origin`. Nuvio sets `enablejsapi` on the nocookie fallback and sets `origin` when the page origin is http(s). A `file://` webOS app has no such origin. That is a known constraint, not a license to fetch the media file another way.

## What is not proven

- NOT_RUN: time from hero rest to first visible trailer frame on the TV.
- NOT_RUN: whether the iframe is a second compositor layer large enough to miss the 250 MB cap.
- NOT_RUN: whether a Home trailer is still alive when Details opens, which would violate the one-media guidance if both decode at once.
- UNKNOWN: which titles in the measured Details runs had a trailer. The Details script does not record it.
- A 200 response from an embed URL is not a playable stream. This lab must not request or log media URLs.

## webOS constraint

LG's FAQ says only one media content, audio or video, is officially supported at a time, and `transform` / full transparency on the video area can start the screensaver. https://webostv.developer.lge.com/faq

INFERRED risk: an inline Home trailer plus a later `<video>` for playback is the failure mode that page describes. The safe experiment is to destroy the trailer iframe before the player mounts, then measure start time. Do not keep a hidden second player warm.

## Experiments that stay inside the player rules

See `lab/EXPERIMENT-BACKLOG.md` items T1 and T2. Both are measurement first. Neither changes the embed URL shape until a television trace shows the proxy or the iframe is the stall.
