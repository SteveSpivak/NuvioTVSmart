// Fixed CPU benchmark run inside the page, to compare the emulator with the real TV.
// The ratio tv_ms / emu_ms per part tells how much to slow the emulator (CPU throttling rate).
// Touches the page only with a detached, hidden container that is removed afterwards.
// Usage: node calibrate.mjs [rounds]   -> prints JSON with median ms per part
import fs from "node:fs";
import { connect, DEVICE } from "./lib.mjs";
const rounds = +(process.argv[2] || 5);
const c = await connect();
const bench = `(()=>{
  const t=()=>performance.now(), out={js:0,json:0,dom:0,style:0};
  let s=t(); let a=[]; for(let i=0;i<200000;i++)a.push((i*7919)%100003); a.sort((x,y)=>x-y); let h=0; for(let i=0;i<2e6;i++)h=(h*31+i)|0; out.js=t()-s;
  s=t(); const o={items:Array.from({length:3000},(_, i)=>({id:"tt"+i,name:"Title "+i,poster:"https://x/p/"+i+".jpg",genres:["a","b"],year:2000+i%25}))}; for(let i=0;i<5;i++)JSON.parse(JSON.stringify(o)); out.json=t()-s;
  const box=document.createElement("div"); box.style.cssText="position:absolute;left:-5000px;top:0;width:1800px;visibility:hidden"; document.body.appendChild(box);
  s=t(); for(let r=0;r<5;r++){ box.innerHTML=""; for(let i=0;i<600;i++){const d=document.createElement("article");d.className="bench-card";d.innerHTML='<div class="p"><img alt=""></div><h3>Card '+i+'</h3><p>x</p>';d.style.cssText="display:inline-block;width:220px;height:330px;margin:8px";box.appendChild(d);} void box.offsetHeight; } out.dom=t()-s;
  s=t(); for(let r=0;r<20;r++){ box.style.fontSize=(10+r%5)+"px"; for(const e of box.children)e.style.transform="translateX("+(r%3)+"px)"; void box.offsetHeight; } out.style=t()-s;
  box.remove(); return JSON.stringify(out);
})()`;
const runs = [];
for (let i = 0; i < rounds; i++) runs.push(JSON.parse(await c.ev(bench)));
const med = (k) => {
  const v = runs.map((r) => r[k]).sort((a, b) => a - b);
  return Math.round(v[Math.floor(v.length / 2)]);
};
const info = JSON.parse(
  await c.ev(
    "JSON.stringify({ua:navigator.userAgent,cores:navigator.hardwareConcurrency,mem:navigator.deviceMemory||null,vw:innerWidth,vh:innerHeight,dpr:devicePixelRatio})"
  )
);
const medianMs = { js: med("js"), json: med("json"), dom: med("dom"), style: med("style") };
const out = {
  device: DEVICE,
  when: new Date().toISOString(),
  rounds,
  throttle: +(process.env.THROTTLE || 1),
  medianMs,
  info
};
// On the emulator, compare with the TV reference and suggest the CPU throttling rate to use.
const ref = new URL("../emu/calibration-tv.json", import.meta.url);
if (DEVICE !== "tv" && fs.existsSync(ref)) {
  const tv = JSON.parse(fs.readFileSync(ref, "utf8")).medianMs;
  const ratios = Object.keys(tv)
    .map((k) => (tv[k] / Math.max(1, medianMs[k])) * out.throttle)
    .sort((a, b) => a - b);
  out.tvRatios = Object.fromEntries(
    Object.keys(tv).map((k) => [k, +((tv[k] / Math.max(1, medianMs[k])) * out.throttle).toFixed(1)])
  );
  out.suggestedThrottle = +ratios[Math.floor(ratios.length / 2)].toFixed(1);
}
console.log(JSON.stringify(out));
c.close();
process.exit(0);
