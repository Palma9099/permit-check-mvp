# Permit History & Unpermitted Improvement Check — MVP

A standalone web app that runs a records-level permit history diagnostic
against Florida municipal/AHJ data. Enter an address, get a plain-English
realtor-grade report with confidence grades, top flags, a Then-vs-Now
imagery block, and recommended next steps. One-click PDF download.

**v1 coverage:** unincorporated Miami-Dade County and cities within it.
Uses Miami-Dade Property Appraiser public JSON and the RER Open Data
ArcGIS FeatureServer. **No API keys or logins required** for the core
records pipeline.

**Optional AI visual review:** set `ANTHROPIC_API_KEY` and the app will
use Claude vision to compare the subject's satellite image against a
block-context view, looking for roof / addition / fence discrepancies
against the permit record. Without the key, the report falls back to a
static visual checklist.

**v2 plans:** individual city portals (Miami Beach, Coral Gables, Hialeah,
Doral, etc.), Broward County, Palm Beach County.

---

## Run locally

```bash
npm install
npm run dev
# open http://localhost:3000
```

## Production build

```bash
npm run build
npm start
```

## Deploy

See [`DEPLOY.md`](./DEPLOY.md) for copy-paste instructions covering
GitHub + Vercel + custom subdomain on `palma.llc`.

---

## Architecture

```
src/
├── app/
│   ├── layout.tsx          Root HTML shell
│   ├── page.tsx            Landing page with address form
│   ├── Report.tsx          Client component rendering DiagnosticReport
│   ├── globals.css         Tailwind + custom report styles
│   └── api/
│       └── check/
│           ├── route.ts    POST → runDiagnostic → JSON
│           └── pdf/
│               └── route.ts  POST → runDiagnostic → buildPdf → .pdf
├── lib/
│   ├── types.ts            DiagnosticReport + domain types
│   ├── miami-dade.ts       Pipeline: PA + ArcGIS + geocoder → DiagnosticReport
│   └── pdf-report.ts       DiagnosticReport → PDF via pdfkit (standard AFM fonts)
```

## API

**POST `/api/check`** — body `{ address?: string; folio?: string }` →
returns `DiagnosticReport` JSON.

**POST `/api/check/pdf`** — body `{ address?: string; folio?: string }`
OR a full `DiagnosticReport` object → returns a PDF.

**GET `/api/check`** — health check.

## Data sources

- Miami-Dade Property Appraiser public JSON (`PAPublicServiceProxy`):
  owner, building, extra features, sales, benefit/taxable.
- Miami-Dade Open Data ArcGIS FeatureServer: `BuildingPermit_gdb`,
  `Open_Building_Violations`, `BuildingViolation_gdb`,
  `CodeComplianceViolation_Open_View`,
  `CodeComplianceViolation_ClosedPast5Years_View`,
  `EnergovCodeCasePublicView`, `inspectionsData`.

## Operating principle

This app does records-level triage only. It does **not** make legal or
final compliance determinations. Every finding is classified as:

- Confirmed by permit records
- Likely supported but incomplete
- Visible/claimed with no matching permit found
- Possible mismatch / possible unpermitted work
- Insufficient data to determine

Every report carries a confidence grade and explicit data limitations.
Always verify with the AHJ before acting.
