"""Score aerial-check results against the answer key.

Input: results.json, a list of {folio, ok, error?, source, frames:[years],
observations:[{area, severity, whatWeSaw}]} gathered by running /api/check on
each answer-key folio. A case passes when an expected area is reported as
changed ("note" or "flag") in a window that contains the permit year or the
year after (flights are early in the year, so work permitted in 2021 may first
show in the 2022 flight).

Usage: python3 scripts/answer-key/score.py results.json
"""
import json, re, sys
from pathlib import Path

key = {c['folio']: c for c in json.loads(Path(__file__).with_name('answer-key.json').read_text())}
results = json.loads(Path(sys.argv[1]).read_text())

def window(text):
    m = re.search(r'between (\D*)(\d{4}) and (\D*)(\d{4})', text)
    return (int(m.group(2)), int(m.group(4))) if m else None

rows, tally = [], {'hit': 0, 'wrong-years': 0, 'miss': 0, 'no-run': 0}
extra_flags = []
for r in results:
    c = key.get(r['folio'])
    if not c:
        continue
    if not r.get('ok'):
        tally['no-run'] += 1
        rows.append((c, 'no-run', r.get('error', '')))
        continue
    py = c['permitYear']
    got = [o for o in r['observations'] if o['area'] in c['expectAreas'] and o['severity'] in ('note', 'flag')]
    verdict, detail = 'miss', 'expected area not reported as changed'
    for o in got:
        w = window(o['whatWeSaw'])
        if w and w[0] <= py + 1 and w[1] >= py:
            verdict, detail = 'hit', o['whatWeSaw']
            break
        verdict, detail = 'wrong-years', o['whatWeSaw']
    tally[verdict] += 1
    rows.append((c, verdict, detail))
    for o in r['observations']:
        if o['severity'] == 'flag':
            extra_flags.append((c['folio'], c['address'], o['area'], o['whatWeSaw']))

for c, v, d in rows:
    print(f"{v:11} {c['kind']:8} {c['permitYear']} {c['address']:22} {d[:110]}")
n = sum(tally.values()) - tally['no-run']
print('\n', tally, f"hit rate {tally['hit']}/{n}" if n else '')
print('\nFlags raised (check by eye; the permitted work itself should be a note, not a flag):')
for f in extra_flags:
    print(' ', f)
