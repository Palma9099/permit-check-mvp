# Historical Street View — How It Works & How To Maintain It

This documents the **THEN vs NOW Street View** comparison in the Permit Check
report: how the old/new ground-level images are sourced, how the AI decides
what counts as a finding, and what to check first when it breaks.

---

## What it does

For a subject parcel, the report shows an **old-vs-new Street View pair** for
each fronting street (corner lots get 2+ sides). The AI then compares the
frames and flags ground-level changes — fences/gates, additions, garage/front
doors, driveway material, window **replacement** — cross-checked against the
county permit record. A change with no matching permit in the THEN→NOW window
is a `flag`; a change that lines up with a permit (or no change) is a `match`.

Example (6704 SW 134 PL): THEN 2008 vs NOW 2022 on the front, plus a Side 2
(2008 vs 2025). The fence going from open wood slats (2008) to a tall solid
privacy fence (2022) with no permit → **Perimeter gate FLAG**.

---

## The pipeline (where each piece lives)

1. **`src/lib/images/google-historical.ts` — `searchGooglePanoramas()`**
   Calls Google's undocumented `GeoPhotoService.SingleImageSearch` endpoint —
   the same one that powers the time-slider on maps.google.com. Returns every
   pano near a point, including dated Street View Car captures.
   - Dates are mapped to panos by the **explicit pano index** Google returns in
     each date entry (`date[0]`), not by array position. (Earlier code zipped
     them by reversed position, which mis-stapled or dropped dates whenever the
     dated panos weren't the trailing N entries.)

2. **`searchGooglePanoramasMulti()`** (same file)
   Queries **several points** and unions the panos by ID, preferring the dated
   copy. This is the fix for the biggest failure mode (see below).

3. **`src/lib/images/streetview.ts` — `buildStreetViewEngine()`**
   The orchestration: picks the search points (geocode + parcel centroid +
   nearest-edge midpoint), filters dated panos within 30 m of the building,
   clusters them by camera position (corner lots → multiple sides), and for
   each side selects **earliest = THEN, latest = NOW** (requires a ≥3-year gap).
   Renders each frame via the documented Street View Static API, aimed at the
   building (perpendicular to the road-facing parcel edge).

4. **`src/lib/vision-compare.ts` — `compareImagery()`**
   Sends the THEN/NOW frames (aerial + Street View, per side) plus the permit
   digest to Claude and parses the structured findings. The system prompt holds
   all the "what counts as a finding" rules.

5. **`src/app/Report.tsx`** renders the THEN/NOW grid, the current Street View,
   and the finding cards. When no automatic history exists, it shows a callout
   pointing the user to the **upload-an-old-photo** slot.

---

## The #1 failure mode: "Historical Street View unavailable"

**Symptom:** the report shows a current Street View but says *"No dated Street
View Car captures near this property — current view only."*

**Root cause (fixed):** Google's pano search is **sensitive to the query
coordinate**. For a house set back from the road, the rooftop geocode lands deep
in the lot, and a search from there returns a *different* pano cluster with
**no dated captures** — even though the dated curb captures sit ~12 m away. The
old code searched only from the rooftop geocode, so set-back lots (very common
in FL) silently lost their history.

**The fix:** `searchGooglePanoramasMulti()` searches from the geocode **+ parcel
centroid + road-facing edge midpoint** and unions the results, so the dated
curb captures are found regardless of where the geocode lands.

**If it regresses across the board** (every property suddenly "unavailable"),
the most likely cause is that Google rotated the undocumented `pb` payload
format on `SingleImageSearch`. Fix location: `makeSearchUrl()` in
`google-historical.ts`. Refresh the payload from the reference implementation
the code mirrors — the `streetview` Python package by robolyst
(github.com/robolyst/streetview), which keeps its payload current. Symptoms of
a rotated payload: HTTP 400, "Invalid 'pb' parameter", or dates coming back
empty for every address.

**Genuinely no history:** some parcels really do have only one Google drive.
That's expected — the report falls back to the manual upload prompt so the
realtor can supply an old MLS/listing photo as the THEN reference, and the AI
runs the same facade comparison against it.

---

## AI finding guardrails (`vision-compare.ts` system prompt)

Two rules keep the findings honest. **Update them here if you see false
positives** — it's just prompt text.

1. **No cosmetic/lighting flags.** THEN and NOW Street View are shot at
   different times of day, seasons, and sun angles, so apparent color, paint,
   tint, reflection, shadow, or brightness shifts are imagery artifacts, not
   real changes. They are never a `flag`. A real paint/color change is still
   cosmetic and (in unincorporated Miami-Dade) needs no permit → `note` at most.

2. **Windows = replacement only.** A window finding requires a genuine
   replacement signal — frame material/style change (wood single-hung →
   aluminum/impact), a changed opening size/shape, or windows added/removed.
   Glass tint or trim **color** is never a window finding.

`flag` is reserved for changes in **material, structure, footprint, or style**
(new fence material, replaced window frames, added structure) — not appearance.

> Note: the model is non-deterministic, so findings vary run-to-run and a
> borderline call will occasionally slip through. The fix is always to tighten
> the relevant rule in the system prompt, not to special-case the address.

---

## Quick reference

| Concern | File |
|---|---|
| Google pano endpoint / payload / date parsing | `src/lib/images/google-historical.ts` |
| Multi-point search, clustering, THEN/NOW selection, headings | `src/lib/images/streetview.ts` |
| AI comparison prompt + finding rules | `src/lib/vision-compare.ts` |
| Report rendering + upload fallback callout | `src/app/Report.tsx` |

**Key constants** (`streetview.ts`): `MAX_PANO_DIST_M = 30` (pano must be within
30 m of the building), `CLUSTER_RADIUS_M = 5` (camera-position clustering),
`MIN_THEN_NOW_YEARS = 3` (minimum span for a real THEN/NOW pair).
