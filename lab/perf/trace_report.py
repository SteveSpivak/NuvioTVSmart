import json, sys, collections
label = sys.argv[1]
d = json.load(open(f'trace_{label}.json'))
ev = d['events']
tname = {}
for e in ev:
    if e.get('ph') == 'M' and e.get('name') == 'thread_name':
        tname[(e['pid'], e['tid'])] = e['args'].get('name', '?')
per = collections.defaultdict(list)
for e in ev:
    ph = e.get('ph')
    if ph in ('X', 'B', 'E'):
        per[(e['pid'], e['tid'])].append(e)
out = []; w = out.append
w(f'TRACE {label} seq {d["seq"]} presses {d["presses"]} wall {d["wallMs"]} ms events {len(ev)}')
detail = collections.defaultdict(lambda: collections.Counter())
biggest = []
for th, es in sorted(per.items(), key=lambda kv: -len(kv[1])):
    # convert to intervals
    iv = []; stack = []
    for e in sorted(es, key=lambda e: (e['ts'], 0 if e['ph'] != 'E' else 1)):
        if e['ph'] == 'X': iv.append((e['ts'], e['ts'] + e.get('dur', 0), e['name'], e))
        elif e['ph'] == 'B': stack.append(e)
        elif stack:
            b = stack.pop(); iv.append((b['ts'], e['ts'], b['name'], b))
    iv.sort(key=lambda x: (x[0], -x[1]))
    selft = collections.Counter(); cnt = collections.Counter(); st = []
    def close(item):
        s, e_, name, child = item
        selft[name] += (e_ - s) - child
        cnt[name] += 1
    for s, e_, name, raw in iv:
        while st and st[-1][1] <= s: close(st.pop())
        if st: st[-1][3] += min(e_, st[-1][1]) - s
        st.append([s, e_, name, 0])
        if tname.get(th) == 'CrRendererMain' and name in ('Paint', 'Layout', 'UpdateLayoutTree', 'UpdateLayerTree', 'CompositeLayers', 'FunctionCall', 'EventDispatch', 'TimerFire', 'FireAnimationFrame', 'Decode Image', 'ParseHTML', 'PrePaint', 'Layerize', 'Commit'):
            biggest.append(((e_ - s) / 1000, name, json.dumps(raw.get('args', {}))[:150]))
    while st: close(st.pop())
    tot = sum(selft.values())
    if tot < 50000: continue
    w(f'-- thread {tname.get(th, "?")} {th}  busy {tot/1000:.0f} ms')
    for name, us in selft.most_common(16):
        if us < 5000: break
        w(f'   {us/1000:8.0f} ms  x{cnt[name]:<6d} {name}')
w('-- 20 longest single main-thread events')
for ms_, name, args in sorted(biggest, reverse=True)[:20]:
    w(f'   {ms_:7.0f} ms  {name:20s} {args}')
open(f'trace_{label}.txt', 'w').write('\n'.join(out))
print(len(out), 'lines')
