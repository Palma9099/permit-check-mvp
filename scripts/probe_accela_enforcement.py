# Which of the enumerated Florida Accela agencies actually publish an
# ENFORCEMENT search, and what record types does each expose?
#
# The record-type list is per-agency configuration, exactly like EnerGov's
# module 5 and citizenserve's file types. A portal answering says nothing; a
# type list containing code-enforcement work is the signal.
#
# Three outcomes are kept apart on purpose, because collapsing them is the
# defect this whole project keeps finding:
#   ENFORCEMENT  form present AND a code-enforcement record type offered
#   NO-CODE-TYPE form present, type list read, nothing enforcement-like in it
#   UNREADABLE   fetch failed, body too small, or the form never appeared
# UNREADABLE is NOT evidence of absence and is never counted either way.
import json, re, sys, urllib.request, urllib.error, socket
from concurrent.futures import ThreadPoolExecutor

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
HOME = "https://aca-prod.accela.com/{code}/Default.aspx"
URL = "https://aca-prod.accela.com/{code}/Cap/CapHome.aspx?module={module}&TabName={module}"

# The module NAME is per-agency, which a single guess gets wrong 17 times out
# of 28. Observed so far: Enforcement (Tampa, Pinellas, Fort Lauderdale),
# Code (North Port), CodeCompliance (Clearwater). So read each agency's own
# module list off its landing page and probe the one that is about code.
MODULEISH = re.compile(r"enforce|^code", re.I)

def modules_of(code):
    """Module names this agency's ACA links to, or None if unreadable."""
    try:
        req = urllib.request.Request(HOME.format(code=code), headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=40) as r:
            html = r.read().decode("utf-8", "replace")
    except Exception:
        return None
    mods = sorted(set(re.findall(r"module=([A-Za-z_]+)", html)))
    return mods or None

AGENCIES = [
    ("HCFL","Hillsborough County","county",1459762),("PINELLAS","Pinellas County","county",959107),
    ("LEECO","Lee County","county",760822),("POLKCO","Polk County","county",725046),
    ("BREVARD","Brevard County","county",606612),("PASCO","Pasco County","county",561891),
    ("SEMINOLECO","Seminole County","county",470856),("SARASOTACO","Sarasota County","county",434006),
    ("MANATEE","Manatee County","county",399710),("OSCEOLA","Osceola County","county",388656),
    ("TAMPA","City of Tampa","city",384959),("LEONCO","Leon County","county",292198),
    ("BOCC","Charlotte County","county",186847),("FTL","Fort Lauderdale","city",182760),
    ("MARTINCO","Martin County","county",158431),("CITRUS","Citrus County","county",153843),
    ("HOLLYWOOD","City of Hollywood","city",153067),("CLEARWATER","City of Clearwater","city",117292),
    ("NASSAU","Nassau County","county",90352),("NORTHPORT","City of North Port","city",74793),
    ("WESTON","City of Weston","city",68107),("BRADENTON","Bradenton","city",55698),
    ("DELAND","DeLand","city",37351),("COOPER","Cooper City","city",34401),
    ("WINTER","Winter Park","city",29795),("KEYBISCAYNE","Village of Key Biscayne","city",14809),
    ("LONGBOAT","Town of Longboat Key","city",7505),("MULBERRY","Mulberry","city",3952),
]

# Record types that mean code enforcement work on a property.
CODEISH = re.compile(r"code|violation|complaint|enforce|nuisance|lien|unsafe|demolition|"
                     r"remedial|notice to appear|civil case|abate|zoning", re.I)

def types_from(html):
    """Option labels of the record-type select, or None when it is not readable."""
    m = re.search(r'id="ctl00_PlaceHolderMain_generalSearchForm_ddlGSPermitType"(.*?)</select>', html, re.S)
    if not m:
        return None
    opts = re.findall(r'<option[^>]*>(.*?)</option>', m.group(1), re.S)
    out = []
    for o in opts:
        t = re.sub(r"<[^>]+>", "", o).strip()
        if t and not t.startswith("--"):
            out.append(t)
    return out or None

def probe(a):
    code, name, kind, pop = a
    mods = modules_of(code)
    if mods is None:
        return dict(code=code, name=name, kind=kind, pop=pop, state="UNREADABLE",
                    detail="landing page unreadable", types=[], module=None)
    # Variants seen across Florida: Enforcement (Tampa, Pinellas, FTL),
    # CodeEnforcement (Lee, Charlotte), CodeCompliance (Leon, Clearwater),
    # Code (North Port), Enforce (Brevard).
    KNOWN = ["Enforcement", "CodeEnforcement", "CodeCompliance", "Code", "Enforce"]
    linked = [m for m in mods if MODULEISH.search(m)]
    cands = linked + [k for k in KNOWN if k not in linked]
    best = None
    for module in cands:
        try:
            req = urllib.request.Request(URL.format(code=code, module=module), headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=40) as r:
                html = r.read().decode("utf-8", "replace")
        except Exception:
            continue
        if len(html) < 20000 or "txtGSParcelNo" not in html:
            continue
        ts = types_from(html)
        if ts is None:
            continue
        hits = [t for t in ts if CODEISH.search(t)]
        if hits:
            return dict(code=code, name=name, kind=kind, pop=pop, state="ENFORCEMENT",
                        detail=f"module={module}, {len(hits)} of {len(ts)} types",
                        types=hits, module=module)
        best = best or dict(code=code, name=name, kind=kind, pop=pop, state="NO-CODE-TYPE",
                            detail=f"module={module}, {len(ts)} types, none enforcement-like",
                            types=ts, module=module)
    if best:
        return best
    return dict(code=code, name=name, kind=kind, pop=pop, state="UNREADABLE",
                detail="no module served a readable code search (tried " + ",".join(cands[:5]) + ")",
                types=[], module=None)
    module = cands[0]
    try:
        req = urllib.request.Request(URL.format(code=code, module=module), headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=40) as r:
            html = r.read().decode("utf-8", "replace")
    except Exception as e:
        return dict(code=code, name=name, kind=kind, pop=pop, state="UNREADABLE",
                    detail=f"module={module} fetch: {str(e)[:30]}", types=[], module=module)
    if len(html) < 20000 or "txtGSParcelNo" not in html:
        return dict(code=code, name=name, kind=kind, pop=pop, state="UNREADABLE",
                    detail=f"module={module}, no search form ({len(html)} bytes)", types=[], module=module)
    ts = types_from(html)
    if ts is None:
        return dict(code=code, name=name, kind=kind, pop=pop, state="UNREADABLE",
                    detail=f"module={module}, record-type list not readable", types=[], module=module)
    hits = [t for t in ts if CODEISH.search(t)]
    if not hits:
        return dict(code=code, name=name, kind=kind, pop=pop, state="NO-CODE-TYPE",
                    detail=f"module={module}, {len(ts)} types, none enforcement-like", types=ts, module=module)
    return dict(code=code, name=name, kind=kind, pop=pop, state="ENFORCEMENT",
                detail=f"module={module}, {len(hits)} of {len(ts)} types", types=hits, module=module)

rows = []
with ThreadPoolExecutor(max_workers=5) as ex:
    for r in ex.map(probe, AGENCIES):
        rows.append(r)
        print("%-12s %-26s %-6s %9s  %-13s %s" % (
            r["code"], r["name"], r["kind"], "{:,}".format(r["pop"]), r["state"], r["detail"]))

print()
for st in ("ENFORCEMENT", "NO-CODE-TYPE", "NO-CODE-MODULE", "UNREADABLE"):
    sel = [r for r in rows if r["state"] == st]
    cities = [r for r in sel if r["kind"] == "city"]
    print("%-13s %2d agencies  (%2d cities, %s city residents; counties are unincorporated-only so NOT summed)"
          % (st, len(sel), len(cities), "{:,}".format(sum(r["pop"] for r in cities))))
print()
print("probed:", len(AGENCIES), " lines printed:", len(rows))
json.dump(rows, open("accela_enforcement.json","w"), indent=1)

