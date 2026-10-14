"""Summarize home_reload_ab.mjs: long tasks and CPU inside getTitleWatchedItems, fix on versus off.
  python3 home_ab_report.py <results folder of one run>"""
import json, os, statistics, sys

out = sys.argv[1]
FN = "getTitleWatchedItems"


def inclusive_ms(prof_path, name):
    p = json.load(open(prof_path))
    nodes = {n["id"]: n for n in p["nodes"]}
    parent = {c: n["id"] for n in p["nodes"] for c in n.get("children", [])}
    self_us = {}
    for nid, d in zip(p["samples"], p["timeDeltas"]):
        self_us[nid] = self_us.get(nid, 0) + d
    total = 0
    for nid, t in self_us.items():
        x = nid
        while x in nodes:
            if nodes[x]["callFrame"]["functionName"] == name:
                total += t
                break
            x = parent.get(x)
    return round(total / 1000)


data = json.load(open(os.path.join(out, "home.json")))
rows = []
for r in data["results"]:
    r[FN + "Ms"] = inclusive_ms(os.path.join(out, f"prof_block{r['block']}.cpuprofile"), FN)
    rows.append(r)
cols = ["block", "fix", "cards", "nodes", "longTasks", "longTaskMs", "worstLongTaskMs", FN + "Ms"]
print("\t".join(cols))
for r in rows:
    print("\t".join(str(r[c]) for c in cols))
print("\nmedian (n)\tfix on\tfix off")
for k in ["longTaskMs", "worstLongTaskMs", FN + "Ms"]:
    med = {}
    for arm in ["on", "off"]:
        v = [r[k] for r in rows if r["fix"] == arm]
        med[arm] = f"{round(statistics.median(v))} ({len(v)})" if v else "None (0)"
    print(f"{k}\t{med['on']}\t{med['off']}")
