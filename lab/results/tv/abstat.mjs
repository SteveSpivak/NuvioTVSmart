// Summarize intentab.jsonl: median per group for OPEN (trailerIntent off) vs INTENT (on).
import fs from "node:fs";
const rows = fs.readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l));
const med = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const metrics = {
  "Details shell ms": (r) => r.shellMs,
  "Open long tasks total ms": (r) => r.open.ltTotal,
  "Open longest task ms": (r) => r.open.ltMax,
  "Scroll 12 Downs long tasks total ms": (r) => r.scroll.ltTotal,
  "Scroll key p95 ms": (r) => r.scroll.p95,
  "Back long tasks total ms": (r) => r.back.ltTotal,
  "Back longest task ms": (r) => r.back.ltMax,
  "Home ready after Back ms": (r) => r.homeMs,
  "Home Right/Left long tasks total ms": (r) => r.nav.ltTotal,
};
const g = { OPEN: rows.filter((r) => r.label.startsWith("OPEN")), INTENT: rows.filter((r) => r.label.startsWith("INTENT")) };
console.log(`| Metric (median) | OPEN n=${g.OPEN.length} | INTENT n=${g.INTENT.length} | Change |`);
console.log("|---|---|---|---|");
for (const [k, f] of Object.entries(metrics)) {
  const a = med(g.OPEN.map(f)), b = med(g.INTENT.map(f));
  console.log(`| ${k} | ${a} | ${b} | ${a ? Math.round(((b - a) / a) * 100) : 0}% |`);
}
