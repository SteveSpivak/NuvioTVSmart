"""Compare details_ab.mjs blocks: fix on (A) versus fix off (B).
  python3 details_ab_report.py <results/tv> <label prefix, e.g. 2026-10-14_ab_watchedMemo>
Prints per-open rows, per-arm medians, and CPU self time in the watched-items identity functions
(minified names in the 1.2.5 bundle: uy, dy, Hy, cy, zy)."""
import json, glob, os, statistics, sys

root, prefix = sys.argv[1], sys.argv[2]
WATCHED = {"uy", "dy", "Hy", "cy", "zy"}


def watched_ms(prof_path):
    p = json.load(open(prof_path))
    nodes = {n["id"]: n for n in p["nodes"]}
    dt = {}
    for nid, d in zip(p["samples"], p["timeDeltas"]):
        dt[nid] = dt.get(nid, 0) + d
    total = sum(v for k, v in dt.items() if nodes[k]["callFrame"]["functionName"] in WATCHED)
    return round(total / 1000)


rows = []
for d in sorted(x for x in glob.glob(os.path.join(root, prefix + "_*")) if os.path.isdir(x)):
    block = d.rsplit("_", 1)[1]
    arm = block[-1]
    data = json.load(open(os.path.join(d, "details.json")))
    # Skipped trials write neither a result nor a profile, so the n-th result matches the n-th profile.
    profs = sorted(glob.glob(os.path.join(d, "prof_trial*.cpuprofile")),
                   key=lambda x: int(x.rsplit("trial", 1)[1].split(".")[0]))
    for i, r in enumerate(data["results"]):
        prof = profs[i] if i < len(profs) else None
        rows.append({
            "block": block, "arm": arm, "kind": r["kind"],
            "settled": r["settledMs"], "content": r["contentMs"], "visible": r["visibleMs"],
            "longTaskMs": r["longTaskMs"], "worst": r["worstLongTaskMs"],
            "script": r.get("metrics", {}).get("ScriptDuration"),
            "task": r.get("metrics", {}).get("TaskDuration"),
            "watchedCpu": watched_ms(prof) if prof else None,
            "requests": r["requests"],
        })

cols = ["block", "kind", "visible", "content", "settled", "longTaskMs", "worst", "task", "script", "watchedCpu", "requests"]
print("\t".join(cols))
for r in rows:
    print("\t".join(str(r[c]) for c in cols))


def med(arm, key, kind=None):
    v = [r[key] for r in rows if r["arm"] == arm and (kind is None or r["kind"] == kind) and r[key] is not None]
    return (round(statistics.median(v)), len(v)) if v else (None, 0)


print("\nmedian (n)\tA fix on\tB fix off")
for key in ["visible", "content", "settled", "longTaskMs", "worst", "task", "script", "watchedCpu", "requests"]:
    for kind in [None, "cold", "dwell"]:
        a, b = med("A", key, kind), med("B", key, kind)
        print(f"{key}{'' if kind is None else ' ' + kind}\t{a[0]} ({a[1]})\t{b[0]} ({b[1]})")
