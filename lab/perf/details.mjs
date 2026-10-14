// Details-open timing: press OK on a Home card, record when the details screen appears and settles,
// then press Back once. Compares "cold" (OK right after focusing a new card) with "dwell" (OK after
// waiting DWELL_MS, so the Home hero has already fetched the title's metadata in the background).
//   node details.mjs [order]      order default "CDDCCD" (C = cold, D = dwell), one new card per trial
// Safety: OK is only pressed on a card with data-action="openDetail" outside Continue Watching, so it
// can never start playback. Back is pressed once per trial; the run stops if Home does not return.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, sleep, KEYS, DEVICE } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORDER = (process.argv[2] || "CDDCCD").toUpperCase();
const DWELL_MS = +(process.env.DWELL_MS || 5000);
const WAIT_MS = +(process.env.WAIT_MS || 12000);
const BACK = ["GoBack", 461];

const c = await connect();
const safeCard = () =>
  c.ev(`(()=>{const a=document.activeElement;if(!a||!a.closest(".home-row"))return "not_in_row";
    if(a.closest(".home-row-continue"))return "continue_row";
    return a.dataset.action==="openDetail"?"ok":"action:"+(a.dataset.action||"none")})()`);

// In-page recorder: polls every 50 ms from just before OK until collected.
// The resource-timing buffer (250 entries) is full on a long-lived page; clear it so new requests are recorded.
const ARM = `(()=>{const d=document.getElementById("detail");performance.setResourceTimingBufferSize(2000);performance.clearResourceTimings();window.__dt={t0:performance.now(),samples:[],longtasks:[]};
  try{window.__dtObs&&window.__dtObs.disconnect();window.__dtObs=new PerformanceObserver(l=>{for(const e of l.getEntries())window.__dt.longtasks.push([Math.round(e.startTime-window.__dt.t0),Math.round(e.duration)])});window.__dtObs.observe({entryTypes:["longtask"]})}catch(e){}
  clearInterval(window.__dtTimer);window.__dtTimer=setInterval(()=>{const vis=!!d&&d.offsetWidth>0&&getComputedStyle(d).display!=="none";
    const imgs=vis?[...d.querySelectorAll("img")]:[];
    window.__dt.samples.push([Math.round(performance.now()-window.__dt.t0),vis?1:0,vis?d.innerText.length:0,vis?d.getElementsByTagName("*").length:0,imgs.filter(i=>i.complete&&i.naturalWidth>0).length])},50);return true})()`;
const COLLECT = `(()=>{clearInterval(window.__dtTimer);const t0=window.__dt.t0;
  const res=performance.getEntriesByType("resource").filter(e=>e.startTime>=t0).map(e=>[(()=>{try{return new URL(e.name).host}catch(x){return "?"}})(),e.initiatorType,Math.round(e.startTime-t0),Math.round(e.responseEnd-t0)]);
  return JSON.stringify({samples:window.__dt.samples,longtasks:window.__dt.longtasks,res})})()`;

function summarize(raw) {
  const { samples, longtasks, res } = JSON.parse(raw);
  const first = (f) => (samples.find(f) || [null])[0];
  const visibleMs = first((s) => s[1] === 1);
  const maxText = Math.max(0, ...samples.map((s) => s[2]));
  const contentMs = first((s) => s[2] >= maxText * 0.9 && s[2] > 0);
  // Settled = last time the text length or element count changed.
  let settledMs = null;
  for (let i = 1; i < samples.length; i++)
    if (samples[i][2] !== samples[i - 1][2] || samples[i][3] !== samples[i - 1][3])
      settledMs = samples[i][0];
  const xhr = res.filter((r) => r[1] === "xmlhttprequest" || r[1] === "fetch");
  const imgs = res.filter((r) => r[1] === "img");
  const hosts = {};
  for (const r of xhr) hosts[r[0]] = (hosts[r[0]] || 0) + 1;
  return {
    visibleMs,
    contentMs,
    settledMs,
    lastRequestEndMs: xhr.length ? Math.max(...xhr.map((r) => r[3])) : null,
    requests: xhr.length,
    images: imgs.length,
    requestHosts: hosts,
    longTasks: longtasks.length,
    longTaskMs: longtasks.reduce((a, l) => a + l[1], 0),
    worstLongTaskMs: Math.max(0, ...longtasks.map((l) => l[1]))
  };
}

const results = [];
for (const [i, kind] of [...ORDER].entries()) {
  if (!(await c.onHome())) {
    console.log("ABORT_NOT_ON_HOME before trial", i + 1);
    break;
  }
  await c.key(KEYS.R); // new card each trial, so its details are not cached yet
  await sleep(kind === "D" ? DWELL_MS : 400);
  const safe = await safeCard();
  if (safe !== "ok") {
    console.log("SKIP trial", i + 1, "focused card is", safe);
    continue;
  }
  await c.ev(ARM);
  await c.key(KEYS.OK);
  await sleep(WAIT_MS);
  const s = summarize(await c.ev(COLLECT));
  s.kind = kind === "D" ? "dwell" : "cold";
  results.push(s);
  console.log(JSON.stringify({ trial: i + 1, ...s }));
  if (s.visibleMs == null) {
    console.log("ABORT details screen never appeared; not pressing Back");
    break;
  }
  await c.key(BACK);
  await sleep(2500);
  if (!(await c.onHome())) {
    console.log("ABORT Home did not return after one Back; stopping without more keys");
    break;
  }
}

const out = path.join(
  HERE,
  "../results",
  DEVICE,
  process.env.LABEL || `details_${new Date().toISOString().slice(0, 10)}`
);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  path.join(out, "details.json"),
  JSON.stringify({ order: ORDER, dwellMs: DWELL_MS, results }, null, 1)
);
console.log("saved", out);
c.close();
process.exit(0);
