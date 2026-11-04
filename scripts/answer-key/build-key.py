"""Build the aerial answer key from Miami-Dade permit records.

Each case is a single-family house with one closed-out permit for work that
is visible from above (pool, rooftop solar, shed, attached addition, shingle
to tile re-roof). The aerial check should show that area changing in the
county flight after the permit was issued. Writes answer-key.json.

Usage: python3 scripts/answer-key/build-key.py [per_kind]
"""
import json, random, sys, urllib.parse, urllib.request, datetime as dt
from pathlib import Path

B = 'https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/ArcGIS/rest/services/miamidade_permit_data/FeatureServer/0/query'
PER_KIND = int(sys.argv[1]) if len(sys.argv) > 1 else 5
random.seed(7)

KINDS = [
    ('pool', 'Pool', "ApplicationTypeDescription='ADDITION - DETACHED' AND CategoryDescription1='SWIMMING POOL'"),
    ('solar', 'Solar', "ApplicationTypeDescription='ROOF MOUNTED INSTAL' AND CategoryDescription1='SOLAR PHOTOVOLTAIC'"),
    ('shed', 'Shed / detached', "ApplicationTypeDescription='ADDITION - DETACHED' AND DetailDescriptionComments LIKE '%SHED%'"),
    ('addition', 'Rear addition|Patio / cover|Screen enclosure', "ApplicationTypeDescription='ADDITION - ATTACHED' AND CategoryDescription1='BUILDING (COUNTY)'"),
    ('reroof', 'Roof', "ApplicationTypeDescription='RE-ROOF/REPAIR' AND DetailDescriptionComments LIKE '%SHINGLE TO TILE%'"),
]

def query(where, n=400):
    q = urllib.parse.urlencode({
        'where': where, 'f': 'json', 'resultRecordCount': n, 'orderByFields': 'PermitIssuedDate',
        'outFields': 'FolioNumber,PropertyAddress,PermitIssuedDate,DetailDescriptionComments,CategoryDescription1,CoCcDate',
    })
    d = json.load(urllib.request.urlopen(f'{B}?{q}', timeout=90))
    if 'error' in d:
        raise SystemExit(d['error'])
    return [f['attributes'] for f in d['features']]

def year(ts):
    if isinstance(ts, (int, float)):
        return dt.datetime.utcfromtimestamp(ts / 1000).year
    return int(str(ts)[:4])

cases = []
for kind, areas, cond in KINDS:
    picked = []
    for yr in range(2020, 2025):
        rows = query(f"{cond} AND CoCcDate IS NOT NULL AND FolioNumber IS NOT NULL AND PermitIssuedDate >= DATE '{yr}-03-01' AND PermitIssuedDate < DATE '{yr}-10-01'", 60)
        rows = [r for r in rows if r['FolioNumber'] and r['FolioNumber'].startswith('30')]  # unincorporated, single folio
        # Interior work and legalizing something that already stood show nothing new from above.
        rows = [r for r in rows if not any(w in (r['DetailDescriptionComments'] or '') for w in ('INTERIOR', 'LEGALIZ'))]
        random.shuffle(rows)
        if rows:
            picked.append(rows[0])
    random.shuffle(picked)
    for r in picked[:PER_KIND]:
        cases.append({
            'kind': kind, 'expectAreas': areas.split('|'), 'folio': r['FolioNumber'], 'address': r['PropertyAddress'],
            'permitYear': year(r['PermitIssuedDate']), 'permit': (r['DetailDescriptionComments'] or '').strip(),
        })
    print(kind, len(picked[:PER_KIND]))

out = Path(__file__).with_name('answer-key.json')
out.write_text(json.dumps(cases, indent=1))
print('wrote', out, len(cases))
