import json, sys, collections
label = sys.argv[1]
p = json.load(open(f'prof_{label}.cpuprofile'))
meta = json.load(open(f'prof_{label}.meta.json'))
nodes = {n['id']: n for n in p['nodes']}
parent = {}
for n in p['nodes']:
    for c in n.get('children', []):
        parent[c] = n['id']
self_us = collections.Counter()
for s, dt in zip(p['samples'], p['timeDeltas']):
    self_us[s] += dt
total = sum(self_us.values())

def key(n):
    cf = n['callFrame']
    url = cf.get('url', '').split('/')[-1]
    return (cf.get('functionName') or '(anonymous)', url, cf.get('lineNumber', -1) + 1, cf.get('columnNumber', -1) + 1)

by_fn = collections.Counter()
for i, us in self_us.items():
    by_fn[key(nodes[i])] += us
# inclusive time per function (count each function once per stack)
incl = collections.Counter()
for i, us in self_us.items():
    seen = set(); j = i
    while j is not None:
        k = key(nodes[j])
        if k not in seen:
            seen.add(k); incl[k] += us
        j = parent.get(j)
out = []
w = out.append
ms = lambda us: f'{us/1000:8.0f} ms {100*us/total:5.1f}%'
w(f'RUN {label}  seq {meta["seq"]}  presses {meta["presses"]}  wall {meta["wallMs"]} ms  sampled {total/1000:.0f} ms')
w('-- browser metrics, delta over the run')
for k, (a, b) in meta['metrics'].items():
    if a is None or b is None: continue
    dlt = b - a
    w(f'  {k:22s} {dlt*1000:10.0f} ms' if k.endswith('Duration') else f'  {k:22s} {a:12.0f} -> {b:12.0f}')
f = meta['frames']['f'][1:]
if f:
    fs = sorted(f); n = len(fs)
    w(f'-- frames: {n}  avg fps {1000*n/sum(f):.1f}  median {fs[n//2]} ms  p90 {fs[int(n*.9)]} ms  p99 {fs[min(n-1,int(n*.99))]} ms  max {fs[-1]} ms')
    w(f'   frames over 50 ms: {sum(1 for x in f if x>50)}  over 100 ms: {sum(1 for x in f if x>100)}  over 200 ms: {sum(1 for x in f if x>200)}  time in frames over 50 ms: {sum(x for x in f if x>50)} ms')
lt = meta['frames']['lt']
w(f'-- long tasks: {len(lt)}  total {sum(lt)} ms  worst {max(lt) if lt else 0} ms')
w('-- top self time')
for k, us in by_fn.most_common(28):
    w(f'  {ms(us)}  {k[0][:44]:44s} {k[1][:26]}:{k[2]}:{k[3]}')
w('-- top inclusive time (app functions)')
n = 0
for k, us in incl.most_common(200):
    if k[0].startswith('(') or not k[1]: continue
    w(f'  {ms(us)}  {k[0][:44]:44s} {k[1][:26]}:{k[2]}:{k[3]}')
    n += 1
    if n >= 28: break
open(f'prof_{label}.txt', 'w').write('\n'.join(out))
print(len(out), 'lines')
