# Nuvio LG webOS: Data-loading research and test protocol

Status: RESEARCH/PROPOSAL. No speedups are proven by this document. Keep measured and synthetic evidence separate.
Target: LG 65UR78006LL, webOS 8.4, Chromium 94. Canonical lab instructions: `lab/README.md` and `lab/FINDINGS.md`.

## Existing evidence (2026-10-14)

- Real TV Details settle medians: ~5.9 s after 0.4 s focus (n=5); ~3.9 s after 2 s (n=2); ~2.0 s after 5 s (n=3). Source: commit 9019da8, `lab/perf/details.mjs`. 'Settled' = last text-length or DOM element-count change; NOT identical to first usable Details or first playable source.
- Details also shows ~1.1–1.8 s total long tasks per trial; specific stacks/cause UNKNOWN.
- Existing Home hero prefetches all-addon metadata; metadata repository caches results. Source-addon metadata, TMDB enrichment, cast fallback and multiple Trakt requests are candidates for measurement, not proven redundant.
- Home 83→20 rows improved measured scrolling. Globally unpromoting tracks reduced layer memory but worsened warm scrolling (L4 46.5 FPS versus L5 41.8 FPS), so do not merge the unpromotion change as a speed fix.
- Emulator Chromium 92 spoofed as TV Chrome 94 is SYNTHETIC, not interchangeable with real TV.

## Prior art (patterns, not dependency-install instructions)

- TanStack Query query keys: identity includes all request-dependent variables: https://tanstack.com/query/latest/docs/framework/react/guides/query-keys . Reuse Nuvio's repositories; do not add React/Query.
- web.dev on long tasks: https://web.dev/articles/optimize-long-tasks/ . Split noncritical synchronous work only after CPU stacks identify it. Chromium 94 needs compatible yield fallback.
- Stremio Web visible-catalog pattern: https://github.com/Stremio/stremio-web . Keep viewport-oriented fetch and mount separate.
- Unity/Unreal asset loading: transfer critical-path, priority, incremental integration ideas, not engine libraries.
- Provider documentation (TMDB, Trakt): verify actual endpoint schema, pagination, rate limits, response fields and permitted caching against current official docs before changing requests.

## Exact test work, in order

G0. Preserve baseline SHA, real TV build, settings, identity-safe content fixtures and existing `lab/perf` runs. Fix CDP command timeout, disconnect and trace-completion handling separately if they impair evidence.
G1. Add a compact request waterfall to existing `lab/perf/details.mjs` or a small companion. Record anonymized provider, endpoint category, request ID, start/end/TTFB where available, bytes if exposed, cache disposition, parsing duration, screen-visible, screen-usable, first-artwork, settled and first-source ready. Do not log URL query tokens, title names, user identities or response bodies.
G2. Construct the actual Home-focus → hero prefetch → Details → Sources dependency graph. For every request log whether required-for-usable, optional enrichment, cache hit/miss, shared in-flight or redundant. Never infer duplicate calls from hostname counts alone.
G3. Unit-test same-key coalescing, distinct account/language/params keys, TTL expiration, stale-completion handling, retry-after/429, request errors, rapid focus change, and memory-cap policy. Use existing repositories/cache owners first.
G4. Profile the measured 1.1–1.8 s Details long tasks to exact stacks. Do not assume metadata/network calls cause all delay.
G5. Run separate candidates: (A) split usable Details from enrichment, (B) request sharing, (C) stable-focus bounded prefetch, (D) Trakt request audit, (E) lightweight source-first readiness, (F) bounded UI updates. No batching changes with virtualization.
G6. Synthetic emulator comparison then real-TV A/B/B/A matched content and warm state; cold trials separate. Record medians, p95 only with sufficient n, slow frames, FPS, memory, request rate, first usable Details, first source. Abort if navigation state, watch state or results regress.

## Proposed tiny additions, only where missing

- `lab/perf/request-waterfall.mjs`: CDP Network events, redacted timings; capability-detect methods; fail closed on disconnect.
- `lab/perf/request-report.py`: pure offline aggregation of sanitized NDJSON; no third-party dependencies.
- `tests/test-request-identity.mjs`: deterministic fixture-based invariants against existing repository request identity/cache functions.
- `lab/results/`: sanitized receipts; raw traces remain local, hashed, excluded from git.

## Avoid

- A new global cache, proxy, queue, database, WebGL renderer or framework without proof existing owners are inadequate.
- Logging credentials, signed URLs, Trakt tokens or identifiable user metadata.
- Blind parallelization, unbounded prefetch, swallowing 429 or treating canceled requests as free.
- Using `performance.clearResourceTimings()` to wipe unrelated app measurements without explicitly scoping the test.
- Treating last DOM mutation as UX readiness; explicit UI markers are required.
- Claiming tests passed without execution; `NOT_RUN` is the default.
