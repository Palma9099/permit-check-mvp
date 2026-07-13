# Accela Calibration Runbook — first live session

_permit-check-mvp · deep-scan worker · Phase 1_

Goal of the session: get the Accela flow reading a real **results grid** for
Broward, then Palm Beach — so the deep-scan email shows an actual permit + code
list, not "use the link." Budget ~60–90 min for the first portal, ~20 for the
second (same product).

The flow already **degrades safely** — nothing you do here can produce wrong
data, only "couldn't read it, here are the links." You're just tightening
selectors until the grid parses.

---

## 0. Before you start

- [ ] Migrations run in Supabase (`0001_scan_jobs.sql`, `0002_portal_results.sql`).
- [ ] You can run the worker **locally with a visible browser** (calibration is
      easiest to watch this way — deployment isn't required to calibrate):
  ```
  cd worker
  cp .env.example .env         # fill SUPABASE_* and RESEND_* (email not used by calibrate)
  npm install
  npx playwright install chromium
  ```
- [ ] Have a **real single-family address** in each county handy (not a condo /
      not a brand-new build). Example shapes:
  - Broward: `"1000 SW 2nd St, Fort Lauderdale, FL 33312"`
  - Palm Beach: `"400 S County Rd, Palm Beach, FL 33480"`

---

## 1. Run one calibration pass

From `worker/`:

```
CALIBRATE=1 HEADLESS=false npm run calibrate -- "<the Broward address>" broward
```

- `HEADLESS=false` → a real Chromium opens; **watch it** drive the form.
- `CALIBRATE=1` → on any miss the worker dumps, to the console, every input's
  `id`/`name`, every table's headers, and saves a **full-page screenshot**
  (`worker/calib-*.png`). That dump is exactly what you need to fix a selector.
- The browser is left open ~30s at the end for inspection.

At the end it prints `===== SCRAPE RESULT =====` with the structured JSON.

---

## 2. Read the result — decision tree

**A. `permits` has real rows with sane columns** → 🎉 Broward permits are done.
Spot-check that `permitNumber`, `type`, `status`, `issuedDate` line up with what
you see on screen. If a column is wrong (e.g. date in `status`), go to **Fix 4**.

**B. Log says `could not locate the street-name field`** → the address input
selector missed. Go to **Fix 1**.

**C. Log says `no results grid matched`** → the form submitted but the results
table wasn't recognized (or search returned a disambiguation list / an error /
a CAPTCHA). Go to **Fix 2 / 3**.

**D. Browser shows a results list but it's a "pick an address" step** (multiple
matches) before the grid → **Fix 5** (needs one extra click; note it and flag).

---

## 3. Fix recipes

### Fix 1 — address field not found
1. In the `CALIBRATE` console dump (or the open browser's DevTools → inspect the
   street-name box), find its real `id` / `name`.
2. Add a selector to `STREET_NAME_SEL` (and `STREET_NO_SEL` if separate) in
   `worker/src/scrapers/accela.ts`. Prefer an `id$="…"` suffix match (stable
   across postbacks) over a brittle full id.
3. If the form sits inside an `<iframe>`, note it — the generic `page.locator`
   won't reach it; we'll add `page.frameLocator(...)` support as a follow-up.
4. Re-run step 1.

### Fix 2 — wrong table picked / grid not recognized
1. Look at the dumped table headers. Find the one that's the permit list
   (columns like *Record Number, Record Type, Status, Date*).
2. If its headers don't contain any of `PERMIT_KEYWORDS`, add the distinguishing
   word to the keyword list in `accela.ts` (`PERMIT_KEYWORDS` / `CODE_KEYWORDS`).
3. If the right table has **no `<th>`/header row** (some ACA grids use a styled
   first row), that's why `readTables` skipped it — note it; we may need a
   grid-specific reader.
4. Re-run.

### Fix 3 — CAPTCHA or "too many results" / error page
- If the screenshot shows a CAPTCHA: stop automating that portal for now — slow
  the pacing, or fall back to links (already the default). Don't add a solver.
- If "please narrow your search": the street-name-only search was too broad;
  make sure the **street number** is also filling (check `STREET_NO_SEL`).

### Fix 4 — columns mis-mapped
Adjust the keyword arrays in the `colIndex(...)` calls in `runAccelaScrape`
(`accela.ts`). Order matters — the first header containing any keyword wins, so
put the most specific keyword first (e.g. `iIssued` uses `['issue','applied','open','date']`;
if `date` is grabbing a "date closed" column, drop `date` and rely on `issue`).

### Fix 5 — address disambiguation step
Accela sometimes returns a list of matching addresses before the record grid.
Note the address-row link selector from the dump; we'll add a "click the row
whose text contains the street number, then read the next grid" step to
`searchModule`. Flag it in the results log so it's picked up next.

---

## 4. Where you'll be editing

| Symptom | File | What to change |
|---|---|---|
| Field not filled | `worker/src/scrapers/accela.ts` | `STREET_NAME_SEL` / `STREET_NO_SEL` |
| Submit not clicked | `accela.ts` | `SUBMIT_SEL` |
| Wrong/again grid | `accela.ts` | `PERMIT_KEYWORDS` / `CODE_KEYWORDS` |
| Columns mis-mapped | `accela.ts` | the `colIndex([...])` keyword lists |
| Wrong agency/module | `worker/src/scrapers/jurisdictions.ts` | `agency`, `buildingModule`, `enforcementModule` |

Re-run `CALIBRATE=1 HEADLESS=false npm run calibrate -- …` after each change.

---

## 5. Per-portal checklist

**Broward** (`agency: BROWARD`, modules `Building` / `Enforcement`)
- [ ] Permits grid parses with real rows
- [ ] Columns (number/type/status/issued) map correctly
- [ ] Code-enforcement grid parses (or confirmed the module name is right)
- [ ] Value / contractor present? (only if the grid has those columns — else Phase 1.5 detail-drill)

**Palm Beach** (`agency: PBC`, modules `Building` / `CodeEnforcement`)
- [ ] Same four checks. If the enforcement module 404s, open
      `aca-prod.accela.com/PBC/` in the browser, find the code module's real name,
      update `enforcementModule`.

---

## 6. Add a new city (once Broward/PBC pass)

1. Open `https://aca-prod.accela.com/<GUESS>/` in the browser to confirm the
   **agency code** (e.g. many cities use their name or an abbreviation). If it
   loads that city's ACA home, the code is right.
2. Add one entry to `JURISDICTIONS` in `jurisdictions.ts` (`platform:'accela'`,
   the agency, module names, portal links, source).
3. Calibrate it with a real address in that city. Usually zero code changes —
   same product, same selectors.

---

## 7. Definition of done + results log

A portal is "calibrated" when a known address returns a permit grid with correct
columns and the JSON `ok:true`. Keep a running log:

| Jurisdiction | Agency | Permits ✓ | Code ✓ | Notes (disambiguation? iframe? value col?) |
|---|---|---|---|---|
| Broward | BROWARD | | | |
| Palm Beach | PBC | | | |

---

## 8. Guardrails (keep these true)

- One browser context, human-like pacing; if a portal rate-limits or shows a
  CAPTCHA, back off — don't hammer or solve it.
- Never edit the result mapping to *fill in* data the grid didn't show. The whole
  point is that a miss degrades to links, honestly.
- After calibrating, the worker auto-caches successful reads (`portal_results`),
  so you won't re-scrape the same parcel while tuning — clear that row if you
  need a fresh run.
