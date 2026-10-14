// YouTube readiness tests. The proxy script and Home/Details handlers are the
// real source. YT.Player is a fake callback surface. A composited TV frame is
// not claimed.

import vm from "node:vm";
import { readFileSync, writeFileSync } from "node:fs";
import { createClock } from "./fake-clock.mjs";
import { createDocument, createWindow } from "./dom-shim.mjs";
import { installMemoryStorage } from "./memory-storage.mjs";

const PROXY_PATH = new URL("../../docs/youtube-proxy.html", import.meta.url);
const PROXY_SOURCE = readFileSync(PROXY_PATH, "utf8");
const PROXY_SCRIPT = PROXY_SOURCE.match(/<script>([\s\S]*?)<\/script>/)[1];

function caseResult(id, verdict, classification, summary, evidence = {}) {
  return { id, track: "youtube", verdict, classification, summary, evidence };
}

function installPageGlobals() {
  const clock = createClock(1_700_000_000_000);
  globalThis.setTimeout = clock.setTimeout;
  globalThis.clearTimeout = clock.clearTimeout;
  globalThis.setInterval = clock.setInterval;
  globalThis.clearInterval = clock.clearInterval;
  globalThis.Date = clock.Date;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.requestAnimationFrame = (fn) => clock.setTimeout(fn, 16);
  const document = createDocument();
  const window = createWindow(document);
  globalThis.document = document;
  globalThis.window = window;
  globalThis.location = {
    href: "https://nuvio.local/index.html",
    origin: "https://nuvio.local",
    search: ""
  };
  return { clock, document, window };
}

function bootProxy(search) {
  const clock = createClock(1_700_000_000_000);
  const document = createDocument();
  const messages = [];
  const players = [];
  const context = vm.createContext({
    console,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    Date: clock.Date,
    JSON,
    Object,
    Math: Object.assign(Object.create(Math), { random: () => 0.25 }),
    Number,
    String,
    Boolean,
    encodeURIComponent,
    decodeURIComponent,
    document,
    location: {
      search,
      origin: "https://nuvio.local",
      href: `https://nuvio.local/youtube-proxy.html${search}`
    }
  });
  context.window = context;
  context.parent = {
    postMessage(payload) {
      messages.push(payload);
    }
  };
  context.window.parent = context.parent;
  context.addEventListener = (type, fn) => {
    context[`__on_${type}`] = context[`__on_${type}`] || [];
    context[`__on_${type}`].push(fn);
  };
  context.removeEventListener = (type, fn) => {
    context[`__on_${type}`] = (context[`__on_${type}`] || []).filter((entry) => entry !== fn);
  };
  context.YT = {
    Player: class FakePlayer {
      constructor(id, options) {
        this.id = id;
        this.options = options;
        this.state = -1;
        this.currentTime = 0;
        this.duration = 120;
        this.muted = false;
        this.destroyed = false;
        players.push(this);
      }
      playVideo() {
        this.state = 1;
      }
      pauseVideo() {
        this.state = 2;
      }
      mute() {
        this.muted = true;
      }
      unMute() {
        this.muted = false;
      }
      isMuted() {
        return this.muted;
      }
      getPlayerState() {
        return this.state;
      }
      getCurrentTime() {
        return this.currentTime;
      }
      getDuration() {
        return this.duration;
      }
      seekTo(seconds) {
        this.currentTime = seconds;
      }
      destroy() {
        this.destroyed = true;
      }
      loadModule() {}
      unloadModule() {}
    }
  };
  vm.runInContext(PROXY_SCRIPT, context, { filename: "docs/youtube-proxy.html" });
  return {
    clock,
    document,
    context,
    messages,
    players,
    dispatch(event) {
      (context.__on_message || []).forEach((fn) => fn(event));
    },
    types() {
      return messages.map((message) => message.type);
    }
  };
}

function homeScreen(methods12, methods13) {
  return {
    ...methods12(),
    ...methods13()
  };
}

const cases = [];

async function main() {
  installMemoryStorage();
  const page = installPageGlobals();
  const { createHomeScreenMethods12 } =
    await import("../../js/ui/screens/home/homeScreenMethods-12-sync-collection-hero-media.js");
  const { createHomeScreenMethods13 } =
    await import("../../js/ui/screens/home/homeScreenMethods-13-mount-trailer-layer.js");
  const { createMetaDetailsScreenMethods01 } =
    await import("../../js/ui/screens/detail/metaDetailsScreenMethods-01-get-route-state-key.js");
  const { createMetaDetailsScreenMethods27 } =
    await import("../../js/ui/screens/detail/metaDetailsScreenMethods-27-on-pointer-move.js");
  const { resolveTrailerSource } =
    await import("../../js/ui/screens/home/homeScreenHelpers-06-resolve-trailer-source.js");
  const { buildYoutubeEmbedUrl } =
    await import("../../js/ui/screens/detail/metaDetailsScreenHelpers-06-build-youtube-embed-url.js");

  function resetPage() {
    page.clock.reset(1_700_000_000_000);
    const document = createDocument();
    const window = createWindow(document);
    globalThis.document = document;
    globalThis.window = window;
    page.document = document;
    page.window = window;
  }

  {
    const proxy = bootProxy("?v=abcdefghijk");
    const script = proxy.document.head.children.find((node) => node.tagName === "SCRIPT");
    const ready = proxy.types().includes("ready");
    const ok =
      Boolean(script?.src?.includes("https://www.youtube.com/iframe_api")) &&
      proxy.players.length === 0 &&
      !ready;
    cases.push(
      caseResult(
        "proxy-document-before-api-ready",
        ok ? "PASS" : "FAIL",
        "verified-behavior",
        "Running the proxy document injects the official iframe_api script. Before onYouTubeIframeAPIReady, no player exists and no ready or firstFrame message is posted.",
        { script: script?.src || "", players: proxy.players.length, messages: proxy.types() }
      )
    );
  }

  {
    const proxy = bootProxy("?v=abcdefghijk");
    proxy.context.onYouTubeIframeAPIReady();
    proxy.players[0].options.events.onReady({ target: proxy.players[0] });
    const types = proxy.types();
    const ok =
      types.includes("ready") &&
      !types.includes("firstFrame") &&
      proxy.players[0].state === 1 &&
      proxy.players[0].currentTime === 0;
    cases.push(
      caseResult(
        "api-ready-and-playing-at-zero-are-not-first-frame",
        ok ? "PASS" : "FAIL",
        "verified-behavior",
        "onReady posts ready and calls playVideo. currentTime is still 0, so firstFrame is not posted. API ready is not a decoded frame.",
        { types, state: proxy.players[0].state, currentTime: proxy.players[0].currentTime }
      )
    );
  }

  {
    const proxy = bootProxy("?v=abcdefghijk");
    proxy.context.onYouTubeIframeAPIReady();
    const player = proxy.players[0];
    player.state = 3;
    player.currentTime = 0;
    player.options.events.onStateChange({ data: 3, target: player });
    const ok = !proxy.types().includes("firstFrame");
    cases.push(
      caseResult(
        "buffering-is-not-first-frame",
        ok ? "PASS" : "FAIL",
        "verified-behavior",
        "playerState 3 (buffering) does not emit firstFrame.",
        { types: proxy.types() }
      )
    );
  }

  {
    const proxy = bootProxy("?v=abcdefghijk");
    proxy.context.onYouTubeIframeAPIReady();
    const player = proxy.players[0];
    player.options.events.onReady({ target: player });
    player.currentTime = 0.4;
    player.state = 1;
    proxy.clock.advance(250);
    const firstFrames = proxy.messages.filter((message) => message.type === "firstFrame");
    proxy.clock.advance(250);
    const again = proxy.messages.filter((message) => message.type === "firstFrame");
    const ok = firstFrames.length === 1 && again.length === 1 && firstFrames[0].currentTime === 0.4;
    cases.push(
      caseResult(
        "first-frame-once-when-playing-past-zero",
        ok ? "PASS" : "FAIL",
        "verified-behavior",
        "The state poll emits firstFrame once when playerState is playing and currentTime > 0. A later poll does not emit it again.",
        { firstFrames: again.length, sample: firstFrames[0] || null }
      )
    );
  }

  {
    const proxy = bootProxy("?v=abcdefghijk");
    proxy.context.onYouTubeIframeAPIReady();
    proxy.clock.advance(4499);
    const before = proxy.document.body.querySelector("iframe");
    proxy.clock.advance(1);
    const frame = proxy.document.body.querySelector("iframe");
    const ok =
      !before &&
      String(frame?.src || "").includes("https://www.youtube.com/embed/abcdefghijk") &&
      proxy.players[0].destroyed === true;
    cases.push(
      caseResult(
        "watchdog-4500-direct-embed",
        ok ? "PASS" : "FAIL",
        "verified-behavior",
        "If onReady has not fired, the 4500ms watchdog destroys the API player and inserts a direct youtube.com/embed iframe. That is a fallback document, not a firstFrame.",
        {
          before: Boolean(before),
          src: frame?.src || "",
          firstFrame: proxy.types().includes("firstFrame")
        }
      )
    );
  }

  {
    const proxy = bootProxy("?direct=1&v=abcdefghijk");
    const frame = proxy.document.body.querySelector("iframe");
    const script = proxy.document.head.children.find((node) => node.tagName === "SCRIPT");
    const ok =
      !script &&
      String(frame?.src || "").includes("/embed/abcdefghijk") &&
      proxy.players.length === 0;
    cases.push(
      caseResult(
        "direct-param-skips-api",
        ok ? "PASS" : "FAIL",
        "verified-behavior",
        "direct=1 skips iframe_api and inserts the embed iframe immediately. No YT.Player is constructed.",
        { src: frame?.src || "" }
      )
    );
  }

  {
    const proxy = bootProxy("?v=abcdefghijk");
    proxy.context.onYouTubeIframeAPIReady();
    const player = proxy.players[0];
    player.options.events.onReady({ target: player });
    proxy.dispatch({
      source: {},
      data: { source: "nuvio-detail-trailer", type: "command", command: "pause" }
    });
    const ignored = player.state === 1;
    proxy.dispatch({
      source: proxy.context.parent,
      data: { source: "someone-else", type: "command", command: "pause" }
    });
    const wrongSource = player.state === 1;
    proxy.dispatch({
      source: proxy.context.parent,
      data: { source: "nuvio-detail-trailer", type: "command", command: "pause" }
    });
    const accepted = player.state === 2;
    const ok = ignored && wrongSource && accepted;
    cases.push(
      caseResult(
        "stale-command-source-ignored",
        ok ? "PASS" : "FAIL",
        "verified-behavior",
        "Proxy commands are accepted only from window.parent with source nuvio-detail-trailer. A foreign source or a non-parent window does not pause.",
        { ignored, wrongSource, accepted }
      )
    );
  }

  {
    function proxyStarted(search) {
      const proxy = bootProxy(search);
      const scripts = proxy.document.head.children.filter((node) => node.tagName === "SCRIPT");
      const frames = (proxy.document.body?.children || []).filter((node) => node.tagName === "IFRAME");
      const apiReady =
        typeof proxy.context.onYouTubeIframeAPIReady === "function"
          ? proxy.context.onYouTubeIframeAPIReady()
          : null;
      return {
        players: proxy.players.length,
        apiScripts: scripts.filter((node) => String(node.src || "").includes("iframe_api")).length,
        frames: frames.length,
        types: proxy.types(),
        messages: proxy.messages,
        apiReady
      };
    }
    const missing = proxyStarted("");
    const blank = proxyStarted("?v=");
    const shortId = proxyStarted("?v=abcdefghij");
    const spaced = proxyStarted("?v=abc%20defghij");
    const directMissing = proxyStarted("?direct=1");
    const explicitDefault = bootProxy("?v=qBg39HCJiTU");
    explicitDefault.context.onYouTubeIframeAPIReady();
    const explicitPlayer = explicitDefault.players[0];
    const rejected = [missing, blank, shortId, spaced, directMissing];
    const noPlayer = rejected.every(
      (entry) =>
        entry.players === 0 &&
        entry.apiScripts === 0 &&
        entry.frames === 0 &&
        entry.types.includes("error") &&
        !entry.types.includes("ready") &&
        !entry.types.includes("firstFrame")
    );
    const explicitStillPlays =
      explicitPlayer?.options?.videoId === "qBg39HCJiTU" && explicitDefault.players.length === 1;
    const ok = noPlayer && explicitStillPlays;
    cases.push(
      caseResult(
        "missing-video-id-does-not-autoplay",
        ok ? "PASS" : "FAIL",
        ok ? "verified-behavior" : "reproduced-defect",
        ok
          ? "A missing, blank, short, or spaced v does not load iframe_api, construct YT.Player, or insert a direct embed. The page posts error. An explicit qBg39HCJiTU still starts, so the old default is not banned."
          : "A missing or invalid v still started a player, or an explicit id was rejected.",
        {
          expected: "No YT.Player, iframe_api, or direct embed unless v is 11 url-safe characters.",
          actual: {
            missing,
            blank,
            shortId,
            spaced,
            directMissing,
            explicitVideoId: explicitPlayer?.options?.videoId || null
          },
          callChain: [
            "docs/youtube-proxy.html query parse",
            "isPlayableVideoId",
            "postToParent error",
            "return before YT.Player and iframe_api"
          ]
        }
      )
    );
  }

  resetPage();
  {
    const home = homeScreen(createHomeScreenMethods12, createHomeScreenMethods13);
    const container = globalThis.document.createElement("div");
    let revealed = 0;
    home.mountTrailerLayer(
      container,
      { kind: "youtube", embedUrl: "https://nuvio.local/youtube-proxy.html?v=abcdefghijk" },
      () => {
        revealed += 1;
      }
    );
    const frame = container.querySelector("iframe");
    const beforeLoad = container.classList.contains("is-active");
    frame.dispatchEvent({ type: "load" });
    page.clock.advance(6999);
    const beforeFallback = container.classList.contains("is-active");
    page.clock.advance(1);
    const afterFallback = container.classList.contains("is-active");
    const unconfirmed = container.classList.contains("is-unconfirmed");
    const timeoutRecovered = afterFallback === false && revealed === 0 && unconfirmed === true;
    cases.push(
      caseResult(
        "home-load-is-not-immediate-ready",
        beforeLoad === false && beforeFallback === false && revealed === 0 ? "PASS" : "FAIL",
        "verified-behavior",
        "Home does not mark the trailer active on iframe load, nor at 6999ms. The load event only arms a timer.",
        { beforeLoad, beforeFallback, revealed }
      )
    );
    cases.push(
      caseResult(
        "home-7s-load-fallback-is-not-playback",
        timeoutRecovered ? "PASS" : "FAIL",
        timeoutRecovered ? "verified-behavior" : "reproduced-defect",
        timeoutRecovered
          ? "7000ms after iframe load adds is-unconfirmed and does not add is-active or call onReady. The surface is visible without counting as confirmed playback."
          : "The 7s load fallback still confirmed playback, or it left the trailer with no visible recovery class.",
        {
          expected: { isActive: false, onReadyCalls: 0, isUnconfirmed: true },
          actual: { afterFallback, revealed, unconfirmed, currentTime: 0 },
          callChain: [
            "homeScreenMethods-13-mount-trailer-layer.js frame load listener",
            "setTimeout(showUnconfirmed, 7000)",
            "container.classList.add(is-unconfirmed)"
          ]
        }
      )
    );
  }

  resetPage();
  {
    const home = homeScreen(createHomeScreenMethods12, createHomeScreenMethods13);
    const container = globalThis.document.createElement("div");
    let revealed = 0;
    home.mountTrailerLayer(
      container,
      { kind: "youtube", embedUrl: "https://nuvio.local/youtube-proxy.html?v=abcdefghijk" },
      () => {
        revealed += 1;
      }
    );
    const frame = container.querySelector("iframe");
    globalThis.window.dispatchMessage({
      source: {},
      data: {
        source: "nuvio-youtube-proxy",
        type: "firstFrame",
        videoId: "abcdefghijk",
        currentTime: 1
      }
    });
    page.clock.advance(200);
    const foreignIgnored = !container.classList.contains("is-active");
    globalThis.window.dispatchMessage({
      source: frame.contentWindow,
      data: { source: "not-the-proxy", type: "firstFrame", currentTime: 1 }
    });
    page.clock.advance(200);
    const wrongSourceIgnored = !container.classList.contains("is-active");
    globalThis.window.dispatchMessage({
      source: frame.contentWindow,
      data: {
        source: "nuvio-youtube-proxy",
        type: "firstFrame",
        videoId: "abcdefghijk",
        currentTime: 1.2
      }
    });
    page.clock.advance(149);
    const beforeDelay = !container.classList.contains("is-active");
    page.clock.advance(1);
    const afterDelay = container.classList.contains("is-active") && revealed === 1;
    const ok = foreignIgnored && wrongSourceIgnored && beforeDelay && afterDelay;
    cases.push(
      caseResult(
        "home-first-frame-reveals-after-150",
        ok ? "PASS" : "FAIL",
        "verified-behavior",
        "Home ignores a firstFrame from the wrong window or the wrong source. A matching firstFrame reveals 150ms later, not immediately.",
        { foreignIgnored, wrongSourceIgnored, beforeDelay, afterDelay, revealed }
      )
    );
  }

  resetPage();
  {
    const home = homeScreen(createHomeScreenMethods12, createHomeScreenMethods13);
    const container = globalThis.document.createElement("div");
    let revealed = 0;
    home.mountTrailerLayer(
      container,
      { kind: "youtube", embedUrl: "https://nuvio.local/youtube-proxy.html?v=abcdefghijk" },
      () => {
        revealed += 1;
      }
    );
    const frame = container.querySelector("iframe");
    globalThis.window.dispatchMessage({
      source: frame.contentWindow,
      data: {
        source: "nuvio-youtube-proxy",
        type: "state",
        state: { currentTime: 0, paused: false, loading: false, controllable: false }
      }
    });
    page.clock.advance(1199);
    const before = container.classList.contains("is-active");
    page.clock.advance(1);
    const after = container.classList.contains("is-active");
    const unconfirmed = container.classList.contains("is-unconfirmed");
    const recovered = before === false && after === false && revealed === 0 && unconfirmed === true;
    cases.push(
      caseResult(
        "home-direct-embed-state-is-not-first-frame",
        recovered ? "PASS" : "FAIL",
        recovered ? "verified-behavior" : "reproduced-defect",
        recovered
          ? "A controllable:false, loading:false state at currentTime 0 shows is-unconfirmed after 1200ms and does not call onReady. Direct embed remains visible without a first-frame claim."
          : "Direct-embed state still confirmed playback, or the unconfirmed surface was not shown.",
        {
          expected: { isActive: false, onReadyCalls: 0, isUnconfirmed: true },
          actual: { before, after, revealed, unconfirmed },
          callChain: [
            "docs/youtube-proxy.html direct embed load posts loading:false currentTime:0",
            "homeScreenMethods-13 controllable === false && loading === false",
            "showUnconfirmed(1200)"
          ]
        }
      )
    );
  }

  resetPage();
  {
    const home = homeScreen(createHomeScreenMethods12, createHomeScreenMethods13);
    const container = globalThis.document.createElement("div");
    let revealed = 0;
    home.mountTrailerLayer(
      container,
      { kind: "youtube", embedUrl: "https://nuvio.local/youtube-proxy.html?v=abcdefghijk" },
      () => {
        revealed += 1;
      }
    );
    const frame = container.querySelector("iframe");
    const post = (data) =>
      globalThis.window.dispatchMessage({ source: frame.contentWindow, data });
    post({
      source: "nuvio-youtube-proxy",
      type: "ready",
      videoId: "abcdefghijk"
    });
    post({
      source: "nuvio-youtube-proxy",
      type: "state",
      state: { currentTime: 0, paused: false, loading: true, controllable: true, playerState: 3 }
    });
    post({
      source: "nuvio-youtube-proxy",
      type: "state",
      state: { currentTime: 0, paused: false, loading: false, controllable: true, playerState: 1 }
    });
    page.clock.advance(2000);
    const ignoredEarly =
      revealed === 0 &&
      !container.classList.contains("is-active") &&
      !container.classList.contains("is-unconfirmed");
    frame.dispatchEvent({ type: "load" });
    page.clock.advance(7000);
    const unconfirmed = container.classList.contains("is-unconfirmed") && revealed === 0;
    post({
      source: "nuvio-youtube-proxy",
      type: "firstFrame",
      videoId: "abcdefghijk",
      currentTime: 0.4
    });
    page.clock.advance(150);
    const confirmed =
      container.classList.contains("is-active") &&
      !container.classList.contains("is-unconfirmed") &&
      revealed === 1;
    const ok = ignoredEarly && unconfirmed && confirmed;
    cases.push(
      caseResult(
        "home-unconfirmed-timeout-still-confirms-first-frame",
        ok ? "PASS" : "FAIL",
        ok ? "verified-behavior" : "reproduced-defect",
        ok
          ? "API ready, buffering, and playing at currentTime 0 do not confirm. The 7s timeout shows is-unconfirmed, and a later firstFrame still calls onReady and replaces that class with is-active."
          : "Timeout recovery blocked a later firstFrame, or a zero-time state confirmed playback.",
        { ignoredEarly, unconfirmed, confirmed, revealed }
      )
    );
  }

  resetPage();
  {
    const home = homeScreen(createHomeScreenMethods12, createHomeScreenMethods13);
    const container = globalThis.document.createElement("div");
    let revealed = 0;
    home.mountTrailerLayer(
      container,
      { kind: "youtube", embedUrl: "https://nuvio.local/youtube-proxy.html?v=abcdefghijk" },
      () => {
        revealed += 1;
      }
    );
    const frame = container.querySelector("iframe");
    frame.dispatchEvent({ type: "load" });
    page.clock.advance(7000);
    globalThis.window.dispatchMessage({
      source: frame.contentWindow,
      data: { source: "nuvio-youtube-proxy", type: "error", videoId: "abcdefghijk" }
    });
    const clearedError =
      revealed === 0 &&
      !container.classList.contains("is-active") &&
      !container.classList.contains("is-unconfirmed");
    globalThis.window.dispatchMessage({
      source: frame.contentWindow,
      data: {
        source: "nuvio-youtube-proxy",
        type: "state",
        state: { currentTime: 1.5, paused: false, loading: false, controllable: true }
      }
    });
    page.clock.advance(150);
    const laterFrame =
      revealed === 1 &&
      container.classList.contains("is-active") &&
      !container.classList.contains("is-unconfirmed");
    const ok = clearedError && laterFrame;
    cases.push(
      caseResult(
        "home-error-clears-unconfirmed-without-blocking-later-frame",
        ok ? "PASS" : "FAIL",
        ok ? "verified-behavior" : "reproduced-defect",
        ok
          ? "An error message removes the unconfirmed surface and does not call onReady. A later playing state with currentTime > 0 can still confirm."
          : "Error handling confirmed playback or blocked a later frame.",
        { clearedError, laterFrame, revealed }
      )
    );
  }

  resetPage();
  {
    const css = [
      readFileSync(new URL("../../css/components-16.css", import.meta.url), "utf8"),
      readFileSync(new URL("../../css/components-17.css", import.meta.url), "utf8")
    ].join("\n");
    const heroRule = css.includes(".home-hero-trailer-layer.is-unconfirmed");
    const posterRule = css.includes(".home-poster-trailer-layer.is-unconfirmed");
    const ok = heroRule && posterRule;
    cases.push(
      caseResult(
        "home-unconfirmed-css-is-visible",
        ok ? "PASS" : "FAIL",
        ok ? "verified-behavior" : "reproduced-defect",
        ok
          ? "is-unconfirmed has a hero opacity rule and an expanded poster display rule, so timeout recovery is not left at opacity 0. It does not use trailer-active."
          : "The unconfirmed class has no visibility rule.",
        { heroRule, posterRule }
      )
    );
  }

  resetPage();
  {
    const home = homeScreen(createHomeScreenMethods12, createHomeScreenMethods13);
    const container = globalThis.document.createElement("div");
    let revealed = 0;
    home.mountTrailerLayer(
      container,
      { kind: "youtube", embedUrl: "https://nuvio.local/youtube-proxy.html?v=abcdefghijk" },
      () => {
        revealed += 1;
      }
    );
    const frame = container.querySelector("iframe");
    frame.dispatchEvent({ type: "load" });
    page.clock.advance(7000);
    const listenersBefore = globalThis.window.listenerCount("message");
    home.clearTrailerLayer(container);
    const listenersAfter = globalThis.window.listenerCount("message");
    page.clock.advance(8000);
    const cleared =
      listenersBefore === 1 &&
      listenersAfter === 0 &&
      container.querySelector("iframe") == null &&
      !container.classList.contains("is-active") &&
      !container.classList.contains("is-unconfirmed") &&
      revealed === 0 &&
      frame.src === "";
    cases.push(
      caseResult(
        "home-clear-removes-timer-listener-and-frame",
        cleared ? "PASS" : "FAIL",
        "verified-behavior",
        "clearTrailerLayer removes the message listener, clears the 7s timer, blanks the iframe, and does not reveal after the abandoned timer.",
        { listenersBefore, listenersAfter, revealed, src: frame.src }
      )
    );
  }

  resetPage();
  {
    const home = homeScreen(createHomeScreenMethods12, createHomeScreenMethods13);
    const container = globalThis.document.createElement("div");
    home.mountTrailerLayer(container, {
      kind: "youtube",
      embedUrl: "https://nuvio.local/youtube-proxy.html?v=abcdefghijk"
    });
    const frame = container.querySelector("iframe");
    const details = {
      ...createMetaDetailsScreenMethods01(),
      ...createMetaDetailsScreenMethods27(),
      container: globalThis.document.createElement("div"),
      trailerUiRefs: { frame },
      trailerSource: { kind: "youtube", ytId: "abcdefghijk" },
      trailerMuted: true,
      trailerSubtitlesEnabled: false,
      trailerPlaybackMode: "auto",
      isTrailerPlaying: true,
      cancelTraktCommentsRequest() {},
      cancelPendingEpisodeHold() {},
      cancelPendingSeasonHold() {},
      cancelPendingPosterHold() {},
      cancelPendingHeroHold() {},
      destroyDetailHoldDialog() {},
      clearEpisodeTitleMarquee() {},
      stopTrailerPlayback() {
        this.isTrailerPlaying = false;
      },
      stopTrailerProxyLoadingTimer() {},
      postTrailerProxyCommand() {},
      startTrailerFirstFramePolling() {},
      updateTrailerOverlay() {},
      markTrailerVisualReady() {
        this.visualReady = (this.visualReady || 0) + 1;
      },
      scheduleTrailerFallbackReveal() {}
    };
    details.bindTrailerProxyMessaging();
    globalThis.window.dispatchMessage({
      source: {},
      origin: "https://evil.example",
      data: {
        source: "nuvio-youtube-proxy",
        type: "firstFrame",
        videoId: "abcdefghijk",
        currentTime: 2
      }
    });
    const rejectedForeign = !details.visualReady;
    globalThis.window.dispatchMessage({
      source: frame.contentWindow,
      origin: "https://nuvio.local",
      data: {
        source: "nuvio-youtube-proxy",
        type: "firstFrame",
        videoId: "other-video",
        currentTime: 2
      }
    });
    const rejectedStaleId = !details.visualReady;
    globalThis.window.dispatchMessage({
      source: frame.contentWindow,
      origin: "https://nuvio.local",
      data: {
        source: "nuvio-youtube-proxy",
        type: "firstFrame",
        videoId: "abcdefghijk",
        currentTime: 2
      }
    });
    const accepted = details.visualReady === 1;
    home.clearTrailerLayer(container);
    let cleanupThrew = false;
    try {
      details.cleanup();
    } catch {
      cleanupThrew = true;
    }
    globalThis.window.dispatchMessage({
      source: frame.contentWindow,
      origin: "https://nuvio.local",
      data: {
        source: "nuvio-youtube-proxy",
        type: "firstFrame",
        videoId: "abcdefghijk",
        currentTime: 3
      }
    });
    const afterBack = details.visualReady === 1 && globalThis.window.listenerCount("message") === 0;
    const ok = rejectedForeign && rejectedStaleId && accepted && afterBack;
    cases.push(
      caseResult(
        "rapid-home-details-back-cleans-up",
        ok ? "PASS" : "FAIL",
        "verified-behavior",
        "Details rejects a foreign window and a stale video id, accepts a matching firstFrame, and the real cleanup removes the listener. Home clear blanks its iframe. No further firstFrame is applied.",
        {
          rejectedForeign,
          rejectedStaleId,
          accepted,
          afterBack,
          cleanupThrew,
          listeners: globalThis.window.listenerCount("message")
        }
      )
    );
  }

  {
    const missing = resolveTrailerSource({});
    const blank = resolveTrailerSource({ trailers: [{ ytId: "", url: "" }] });
    const emptyUrl = buildYoutubeEmbedUrl("");
    const present = resolveTrailerSource({ trailers: [{ ytId: "abcdefghijk" }] });
    resetPage();
    const home = homeScreen(createHomeScreenMethods12, createHomeScreenMethods13);
    const container = globalThis.document.createElement("div");
    home.mountTrailerLayer(container, { kind: "youtube", embedUrl: "" });
    const ok =
      missing == null &&
      blank == null &&
      emptyUrl === "" &&
      present?.ytId === "abcdefghijk" &&
      container.querySelector("iframe") == null;
    cases.push(
      caseResult(
        "missing-metadata-does-not-mount-player",
        ok ? "PASS" : "FAIL",
        "verified-behavior",
        "resolveTrailerSource and buildYoutubeEmbedUrl produce no embed when metadata has no video id. Home does not mount an iframe for an empty embedUrl. This is separate from the proxy page's own default id.",
        { missing, blank, emptyUrl, present: present?.embedUrl || null }
      )
    );
  }

  cases.push(
    caseResult(
      "tv-first-rendered-frame",
      "NOT_RUN",
      "not-run",
      "A virtual document cannot prove the first composited frame on the LG 65UR78006LL. firstFrame remains a player-API signal, not a TV frame.",
      { device: "65UR78006LL", webos: "8.4", chromium: "94" }
    )
  );

  const counts = cases.reduce((acc, entry) => {
    acc[entry.verdict] = (acc[entry.verdict] || 0) + 1;
    return acc;
  }, {});
  const output = { suite: "youtube", node: process.version, cases, counts };
  writeFileSync(
    new URL("./youtube-results.json", import.meta.url),
    `${JSON.stringify(output, null, 2)}\n`
  );
  console.log(
    JSON.stringify(
      {
        suite: "youtube",
        counts,
        cases: cases.map((entry) => ({ id: entry.id, verdict: entry.verdict }))
      },
      null,
      2
    )
  );
  if (!cases.length) process.exit(1);
}

await main();
