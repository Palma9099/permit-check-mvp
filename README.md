# Permit History & Unpermitted Improvement Check — MVP

A standalone web app that runs a records-level permit history diagnostic
against Florida municipal/AHJ data. Enter an address, get a plain-English
realtor-grade report with confidence grades, top flags, and recommended
next steps. Optional Word-document download.

**v1 coverage:** unincorporated Miami-Dade County and cities within it.
Uses Miami-Dade Property Appraiser public JSON and the RER Open Data
ArcGIS FeatureServer. **No API keys or logins required.**

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
│           └── docx/
│               └── route.ts  POST → runDiagnostic → buildDocx → .docx
├── lib/
│   ├── types.ts            DiagnosticReport + domain types
│   ├── miami-dade.ts       Pipeline: PA + ArcGIS → DiagnosticReport
│   └── docx-report.ts      DiagnosticReport → Word .docx via docx@8
```

## API

**POST `/api/check`** — body `{ address?: string; folio?: string }` →
returns `DiagnosticReport` JSON.

**POST `/api/check/docx`** — body `{ address?: string; folio?: string }`
OR a full `DiagnosticReport` object → returns a Word document.

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
