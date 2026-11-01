import json, sys, collections
prof = json.load(open(sys.argv[1]))
nodes = {n['id']: n for n in prof['nodes']}
parent = {}
for n in prof['nodes']:
    for c in n.get('children', []):
        parent[c] = n['id']
def key(n):
    cf = n['callFrame']
    url = cf['url'].rsplit('/', 1)[-1]
    return f"{cf['functionName'] or '(anon)'} @{url}:{cf['lineNumber']+1}"
self_t = collections.Counter()
incl_t = collections.Counter()
samples = prof['samples']; deltas = prof['timeDeltas']
total = 0.0
for s, d in zip(samples, deltas):
    d = max(d, 0) / 1000.0  # ms
    total += d
    n = nodes[s]
    self_t[key(n)] += d
    seen = set()
    cur = s
    while cur is not None:
        k = key(nodes[cur])
        if k not in seen:
            incl_t[k] += d; seen.add(k)
        cur = parent.get(cur)
print(f"total sampled ms: {total:.0f}")
print("--- top self time")
for k, v in self_t.most_common(int(sys.argv[2]) if len(sys.argv) > 2 else 30):
    print(f"{v:9.0f} ms {100*v/total:5.1f}%  {k}")
print("--- top inclusive time")
for k, v in incl_t.most_common(int(sys.argv[3]) if len(sys.argv) > 3 else 40):
    print(f"{v:9.0f} ms {100*v/total:5.1f}%  {k}")
