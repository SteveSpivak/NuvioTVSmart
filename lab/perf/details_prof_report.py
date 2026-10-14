"""Sum the per-open CPU profiles written by `PROFILE=1 node details.mjs` and list where the time goes.
   python3 details_prof_report.py <results folder>   -> <folder>/prof_summary.txt"""
import collections, glob, json, os, sys

folder = sys.argv[1]
files = sorted(glob.glob(os.path.join(folder, 'prof_trial*.cpuprofile')))
self_t = collections.Counter()
incl_t = collections.Counter()
total = 0


def key(n):
    cf = n['callFrame']
    url = cf.get('url', '').split('/')[-1]
    return (cf.get('functionName') or '(anonymous)', url, cf.get('lineNumber', -1) + 1)


for f in files:
    p = json.load(open(f))
    nodes = {n['id']: n for n in p['nodes']}
    parent = {c: n['id'] for n in p['nodes'] for c in n.get('children', [])}
    us_by_node = collections.Counter()
    for s, dt in zip(p['samples'], p['timeDeltas']):
        us_by_node[s] += dt
    for i, us in us_by_node.items():
        if nodes[i]['callFrame'].get('functionName') == '(idle)':
            continue
        total += us
        self_t[key(nodes[i])] += us
        seen = set()
        j = i
        while j is not None:
            k = key(nodes[j])
            if k not in seen:
                seen.add(k)
                incl_t[k] += us
            j = parent.get(j)

d = json.load(open(os.path.join(folder, 'details.json')))
out = []
w = out.append
w(f'{len(files)} opens, busy (not idle) CPU sampled: {total / 1000:.0f} ms, {total / 1000 / max(1, len(files)):.0f} ms per open')
w('-- per open: script / style / layout ms (browser metrics), long tasks ms, settled ms')
for r in d['results']:
    m = r.get('metrics', {})
    w(f"  {r['kind']:5s} script {m.get('ScriptDuration')}  style {m.get('RecalcStyleDuration')} ({m.get('RecalcStyleCount')}x)"
      f"  layout {m.get('LayoutDuration')} ({m.get('LayoutCount')}x)  task {m.get('TaskDuration')}"
      f"  long {r['longTaskMs']}  settled {r['settledMs']}  nodes +{m.get('Nodes')} -> {m.get('NodesAfter')}")
ms = lambda us: f'{us / 1000 / max(1, len(files)):7.0f} ms/open {100 * us / max(1, total):5.1f}%'
w('-- top self time')
for k, us in self_t.most_common(25):
    w(f'  {ms(us)}  {k[0][:48]:48s} {k[1][:30]}:{k[2]}')
w('-- top inclusive time (app functions)')
n = 0
for k, us in incl_t.most_common(400):
    if k[0].startswith('(') or not k[1]:
        continue
    w(f'  {ms(us)}  {k[0][:48]:48s} {k[1][:30]}:{k[2]}')
    n += 1
    if n >= 35:
        break
open(os.path.join(folder, 'prof_summary.txt'), 'w').write('\n'.join(out) + '\n')
print('\n'.join(out[:8]))
