// Runs the built Nuvio app in Chromium 94 configured like the LG TV, then leaves it open on CDP port 9222
// so the scripts in lab/perf can measure it exactly as they measure the TV.
//
//   CHROME        path to the Chromium 94 binary (setup.sh prints it)
//   THROTTLE      CPU slow-down factor (default: from calibration, see README). 1 = no throttling
//   ROWS, ITEMS   Home rows and titles per row served by the fake addon (default 20, 40)
//   PERF_MODE     Nuvio effects mode stored before start: "reduced" (TV setting) or "full"
//   HEADLESS=1    run without a display (less faithful: no real compositor frames). Prefer xvfb-run.
//   NET=open      allow internet access (default: everything except 127.0.0.1 is blocked, for repeatability)
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME;
const PORT = +(process.env.PORT || 8090);
const CDP_PORT = +(process.env.CDP_PORT || 9222);
const THROTTLE = +(process.env.THROTTLE || 1);
const ROWS = +(process.env.ROWS || 20);
const PERF_MODE = process.env.PERF_MODE || "reduced";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!CHROME || !fs.existsSync(CHROME)) {
  console.error("Set CHROME to the Chromium 94 binary (run lab/emu/setup.sh).");
  process.exit(2);
}

// Values read from the real TV (LG 65UR78006LL, webOS 8.4) on 2026-10-14.
const TV_UA =
  "Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.128 Safari/537.36 WebAppManager";
const TV_DEVICE_INFO = {
  modelName: "65UR78006LL",
  panelType: "LCD",
  platformVersion: "13.40.90",
  platformVersionDot: 90,
  platformVersionMajor: 13,
  platformVersionMinor: 40,
  screenHeight: 2160,
  screenWidth: 3840
};
// Engine flags read from the TV's web app manager process.
// Home layout, theme and experience mode as set on the TV (no account data). Edit to test other settings.
const TV_SETTINGS = JSON.parse(
  fs.readFileSync(path.join(HERE, process.env.SETTINGS || "tv-settings.json"), "utf8")
);
const TV_FLAGS = [
  "--num-raster-threads=1",
  "--force-gpu-mem-available-mb=250",
  "--enable-gpu-rasterization",
  "--disable-oop-rasterization",
  "--in-process-gpu"
];

const server = spawn(process.execPath, [path.join(HERE, "serve.mjs")], {
  stdio: "inherit",
  env: process.env
});
server.on("exit", (code) => {
  console.error(`serve.mjs exited (${code}). Is port ${PORT} free? Set PORT=...`);
  try {
    chrome.kill();
  } catch {}
  process.exit(1);
});
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "nuvio-emu-"));
const args = [
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profileDir}`,
  "--window-size=1920,1080",
  "--window-position=0,0",
  "--force-device-scale-factor=1",
  `--user-agent=${TV_UA}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-extensions",
  "--autoplay-policy=no-user-gesture-required",
  "--disable-features=Translate",
  "--password-store=basic",
  ...TV_FLAGS
];
if (process.env.NET !== "open")
  args.push("--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1");
if (process.env.HEADLESS === "1") args.push("--headless", "--hide-scrollbars");
if (os.platform() === "linux") args.push("--no-sandbox");
args.push("about:blank");
const chrome = spawn(CHROME, args, { stdio: ["ignore", "ignore", "pipe"] });
chrome.stderr.on("data", () => {});
const stop = () => {
  try {
    chrome.kill();
  } catch {}
  try {
    server.kill();
  } catch {}
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
chrome.on("exit", (code) => {
  console.log("chrome exited", code);
  try {
    server.kill();
  } catch {}
  process.exit(1);
});

let page;
for (let i = 0; i < 60 && !page; i++) {
  await sleep(500);
  try {
    page = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()).find(
      (t) => t.type === "page"
    );
  } catch {}
}
if (!page) {
  console.error("Chromium did not open its debug port");
  stop();
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const ev = async (expression) =>
  (await send("Runtime.evaluate", { expression, returnByValue: true })).result?.result?.value;

// Runs before any app script on every load: TV globals plus first-run settings for a guest with the lab addon.
const boot = `(() => {
  const info = ${JSON.stringify(JSON.stringify(TV_DEVICE_INFO, null, 4))};
  const noop = () => {};
  const palm = { deviceInfo: info, identifier: 'space.nuvio.webos', launchParams: '', launchReason: '', locale: 'en-US', country: 'USA',
    timeZone: 'UTC', isActivated: true, isMinimal: false, highContrast: 'off', screenOrientation: 'landscape',
    activate: noop, deactivate: noop, stageReady: noop, stagePreparing: noop, platformBack: noop, setWindowOrientation: noop,
    keepAlive: noop, setKeyMask: noop, setInputRegion: noop, PmLogString: noop, PmLogInfoWithClock: noop, getIdentifier: () => 'space.nuvio.webos',
    close: noop, hide: noop };
  window.PalmSystem = palm;
  window.webOSSystem = palm;
  // Luna service calls answer with an error, asynchronously, the way an unavailable service does.
  window.PalmServiceBridge = function () { this.onservicecallback = null; };
  window.PalmServiceBridge.prototype.call = function () { const cb = this.onservicecallback; setTimeout(() => cb && cb(JSON.stringify({ returnValue: false, errorCode: -1, errorText: 'perf-lab emulator: no luna service' })), 5); };
  window.PalmServiceBridge.prototype.cancel = noop;
  if (!localStorage.getItem('__perfLabSeeded')) {
    const tv = ${JSON.stringify(TV_SETTINGS)};
    for (const k of ['layoutPreferences', 'themeSettings', 'experienceMode']) localStorage.setItem(k, JSON.stringify(tv[k]));
    localStorage.setItem('skipAuthQrGate', 'true');
    localStorage.setItem('hasSeenAuthQrOnFirstLaunch', 'true');
    localStorage.setItem('rememberLastProfile', 'true');
    localStorage.setItem('installedAddonUrls', JSON.stringify(['http://127.0.0.1:${PORT}/addon']));
    localStorage.setItem('tvPerfMode', JSON.stringify('${PERF_MODE}'));
    localStorage.setItem('__perfLabSeeded', '1');
  }
})();`;
await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: boot });
await send("Emulation.setDeviceMetricsOverride", {
  width: 1920,
  height: 1080,
  deviceScaleFactor: 1,
  mobile: false
});
await send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
const t0 = Date.now();
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/app/index.html` });

// Startup metric: time until Home shows all rows and the first visible posters have loaded.
let ready = null,
  last = "";
for (let i = 0; i < 240; i++) {
  await sleep(500);
  const s = await ev(
    `(()=>{const h=document.getElementById("home");const rows=document.querySelectorAll("#home .home-row").length;const imgs=[...document.querySelectorAll("#home img")].filter(i=>{const b=i.getBoundingClientRect();return b.bottom>0&&b.top<innerHeight&&b.right>0&&b.left<innerWidth});const withSrc=imgs.filter(i=>i.getAttribute("src"));const loaded=withSrc.filter(i=>i.complete&&i.naturalWidth>0).length;const failed=withSrc.filter(i=>i.complete&&i.naturalWidth===0).map(i=>i.src.slice(0,60));const pending=withSrc.length-loaded-failed.length;const vis=[...document.querySelectorAll("#app > *")].filter(e=>e.offsetWidth>0).map(e=>e.id||e.className).join(",");return JSON.stringify({vis,homeVisible:!!h&&h.offsetWidth>0,rows,visibleImgs:withSrc.length,loaded,pending,failed:failed.slice(0,3)})})()`
  );
  if (s !== last) {
    console.log(`t+${Date.now() - t0}ms`, s);
    last = s;
  }
  const o = JSON.parse(s || "{}");
  // Guest start shows the profile picker; press OK on the focused (first) profile, as a person would.
  if (o.vis === "profileSelection" && i % 4 === 0) {
    for (const type of ["rawKeyDown", "keyUp"])
      await send("Input.dispatchKeyEvent", {
        type,
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13
      });
  }
  if (o.homeVisible && o.rows >= ROWS && o.loaded > 0 && o.pending === 0) {
    ready = Date.now() - t0;
    break;
  }
}
const result = {
  device: "emu",
  throttle: THROTTLE,
  rows: ROWS,
  perfMode: PERF_MODE,
  homeReadyMs: ready
};
console.log("EMU_READY", JSON.stringify(result));
console.log(`CDP for lab/perf scripts: CDP_URL=http://127.0.0.1:${CDP_PORT} DEVICE=emu`);
ws.close();
if (process.env.EXIT_WHEN_READY === "1") stop();
