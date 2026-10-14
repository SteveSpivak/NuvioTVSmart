// CPU profile + frame timing + long tasks while D-pad keys are sent. Writes prof_<label>.cpuprofile and .meta.json
// into the current directory. Usage: node prof.mjs <label> [sequence]
import fs from "node:fs";
import { connect, drive, sleep, DEFAULT_SEQ, DEVICE } from "./lib.mjs";
const label = process.argv[2] || "run";
const seq = process.argv[3] || DEFAULT_SEQ;
const c = await connect();
const state = () =>
  c.ev(
    `(()=>JSON.stringify({vis:[...document.querySelectorAll("#app > *")].filter(e=>e.offsetWidth>0).map(e=>e.id||e.className).join(","),dom:document.getElementsByTagName("*").length,imgs:document.images.length,heapMB:performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576):null}))()`
  );
const metrics = async () =>
  Object.fromEntries(
    ((await c.send("Performance.getMetrics")).result?.metrics || []).map((m) => [m.name, m.value])
  );
console.log("before", await state());
await c.send("Performance.enable");
// Frame recorder (requestAnimationFrame gaps) and long-task observer inside the page.
await c.ev(`(()=>{const w=window;w.__pf={f:[],on:true,last:performance.now()};const tick=n=>{if(!w.__pf.on)return;w.__pf.f.push(n-w.__pf.last);w.__pf.last=n;requestAnimationFrame(tick)};requestAnimationFrame(tick);
  w.__pf.lt=[];try{w.__pf.po=new PerformanceObserver(l=>{for(const e of l.getEntries())w.__pf.lt.push(Math.round(e.duration))});w.__pf.po.observe({entryTypes:["longtask"]})}catch(e){}return 1})()`);
const m0 = await metrics();
await c.send("Profiler.enable");
await c.send("Profiler.setSamplingInterval", { interval: 500 });
await c.send("Profiler.start");
const t0 = Date.now();
const { presses, aborted } = await drive(c, seq);
await sleep(1500);
const prof = (await c.send("Profiler.stop")).result?.profile;
const wallMs = Date.now() - t0;
const m1 = await metrics();
const frames = JSON.parse(
  await c.ev(
    `(()=>{const w=window;w.__pf.on=false;try{w.__pf.po.disconnect()}catch(e){};const r=JSON.stringify({f:w.__pf.f.map(x=>Math.round(x)),lt:w.__pf.lt});delete w.__pf;return r})()`
  )
);
console.log("after", await state());
fs.writeFileSync(`prof_${label}.cpuprofile`, JSON.stringify(prof));
const d = {};
for (const k of [
  "ScriptDuration",
  "LayoutDuration",
  "RecalcStyleDuration",
  "TaskDuration",
  "LayoutCount",
  "RecalcStyleCount",
  "JSHeapUsedSize",
  "Nodes",
  "JSEventListeners"
])
  d[k] = [m0[k], m1[k]];
fs.writeFileSync(
  `prof_${label}.meta.json`,
  JSON.stringify({
    label,
    device: DEVICE,
    throttle: process.env.THROTTLE || null,
    seq,
    presses,
    aborted,
    wallMs,
    metrics: d,
    frames
  })
);
console.log(aborted ? "INVALID_ABORTED" : "saved", label, "wallMs", wallMs, "presses", presses);
await c.send("Profiler.disable");
c.close();
process.exit(aborted ? 3 : 0);
