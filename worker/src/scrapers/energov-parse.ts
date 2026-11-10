// Tyler EnerGov Citizen Self Service: the parts that are pure functions.
//
// Split out of energov.ts so the repo-root tests can import them without
// dragging playwright into the Next.js build's TypeScript program. See "Why the
// adapters are split into *-parse.ts" in worker/README.md.
//
// Nothing in this file may import playwright, or anything that does.

/** EnerGov's search modules. The numbers are the product's, not ours. */
export const MODULE = {
  All: 1,
  Permit: 2,
  Plan: 3,
  Inspection: 4,
  CodeCase: 5,
  Request: 6,
  License: 10,
  Project: 11,
} as const;

/**
 * Which modules a tenant exposes on its public search.
 *
 * This is per-tenant configuration and it is the whole story on this platform.
 * Two Florida tenants, same vendor, same page, opposite answers:
 *
 *   Hialeah      1,2,3,4,5,6,10,11   Code Case ENABLED
 *   St Lucie Co  1,2,3,4,6,10,11     Code Case REMOVED (note the gap at 5)
 *
 * So "the agency runs EnerGov" says nothing about whether its code cases are
 * public, and an adapter that assumes module 5 exists will search nothing and
 * report a clean property.
 */
export function moduleIdsFrom(optionValues: string[]): number[] {
  const ids: number[] = [];
  for (const v of optionValues) {
    // The select carries Angular-style values: "number:5".
    const m = String(v).match(/(\d+)\s*$/);
    if (m) ids.push(Number(m[1]));
  }
  return Array.from(new Set(ids)).sort((a, b) => a - b);
}

export const hasCodeModule = (ids: number[]): boolean => ids.includes(MODULE.CodeCase);

/** One code case as EnerGov returns it. */
export interface EnergovCase {
  caseNumber: string | null;
  caseType: string | null;
  status: string | null;
  appliedDate: string | null;
  address: string | null;
  parcel: string | null;
  description: string | null;
}

/** Counts EnerGov reports alongside the rows. */
export interface EnergovCounts {
  codeCases: number;
  permits: number;
  total: number;
}

const str = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  return s ? s : null;
};

/** "2025-05-08T07:38:08" -> "2025-05-08". Anything else passes through. */
export function isoDay(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})T/);
  return m ? m[1] : s;
}

/**
 * Parse the response the portal's own search returns.
 *
 * Shape confirmed against Hialeah on 2026-11-09 for 135 W 60 ST, which is the
 * case a county-only check reported as "None open":
 *
 *   CaseNumber "BWOP-001873-2025", CaseType "Building Without A Permit",
 *   CaseStatus "Lien", MainParcel "0421310020800"
 */
export function parseSearchResponse(body: unknown): {
  ok: boolean;
  cases: EnergovCase[];
  counts: EnergovCounts;
} {
  const r = (body as any)?.Result;
  const success = (body as any)?.Success === true;
  if (!r || !success) return { ok: false, cases: [], counts: { codeCases: 0, permits: 0, total: 0 } };

  const rows: any[] = Array.isArray(r.EntityResults) ? r.EntityResults : [];
  const cases = rows
    // ModuleName 5 is a code case. A module-5 search should only return those,
    // but filter anyway so an "All" search cannot smuggle permits in as cases.
    .filter((x) => Number(x?.ModuleName) === MODULE.CodeCase)
    .map(
      (x): EnergovCase => ({
        caseNumber: str(x.CaseNumber),
        caseType: str(x.CaseType),
        status: str(x.CaseStatus),
        appliedDate: isoDay(x.ApplyDate),
        address: str(x.AddressDisplay) ?? str(x.Address?.FullAddress),
        parcel: str(x.MainParcel),
        description: str(x.Description),
      }),
    );

  return {
    ok: true,
    cases,
    counts: {
      codeCases: Number(r.CodeCasesFound) || 0,
      permits: Number(r.PermitsFound) || 0,
      total: Number(r.TotalFound) || 0,
    },
  };
}

/**
 * Does a case status mean money is attached to the property?
 *
 * "Lien" is the one that matters most: it is already recorded and it travels
 * with the land. The Hialeah case that started this work is status "Lien".
 */
export function isEncumbering(status: string | null): boolean {
  return /lien|fine|judgment|special magistrate/i.test(status ?? '');
}

/** A tenant we know how to search. */
export interface EnergovTenant {
  /** Host, e.g. "hialeahfl-energovpub.tylerhost.net". */
  host: string;
  name: string;
  /** A county tenant covers unincorporated area; a city covers itself. */
  kind: 'county' | 'city';
  /** Modules confirmed on the live search page, with the date in the registry. */
  modules: number[];
  /**
   * Path to the Self Service app, no trailing slash. It is NOT constant, and
   * guessing it wastes time: Tyler-hosted tenants use /apps/selfservice (Doral
   * capitalises it /apps/SelfService, which its server does not care about),
   * while a self-hosted tenant such as Miami Beach serves it from its own
   * domain at /energovprod/selfservice. Defaults to the common case.
   */
  basePath?: string;
}

export const searchUrl = (t: EnergovTenant) =>
  `https://${t.host}${t.basePath ?? '/apps/selfservice'}#/search`;

/** What to say when a tenant does not publish code cases at all. */
export function noCodeModuleNote(t: EnergovTenant): string {
  return `${t.name} runs EnerGov but does not publish code cases on its public portal - that module is switched off for this tenant. We checked nothing here, which is not the same as the property being clear. Contact ${t.name} directly for code case history.`;
}

/** What an empty result means, given who this tenant is. */
export function coverageNote(t: EnergovTenant, nothingFound: boolean): string {
  if (t.kind === 'county') {
    const bare = t.name.replace(/\s+County$/i, '');
    return `${t.name}'s portal covers code cases in unincorporated ${bare} County. If this address sits inside a city, that city is the code authority and ${
      nothingFound ? 'finding nothing here says nothing about the property' : 'these county records are only part of the picture'
    }.`;
  }
  return `${t.name} runs its own code enforcement, so this search covers the whole city.`;
}

/**
 * The portal pages its results, so the rows we read can be fewer than the
 * cases it says exist. Silently returning the first page would under-report a
 * property - the same class of mistake as calling an unchecked source clean -
 * so the caller states the gap instead.
 */
export function truncationNote(read: number, reported: number, name: string): string | null {
  if (reported <= read) return null;
  return `${name}'s portal reports ${reported} matching code cases but returns them a page at a time; ${read} were read here. Open the portal link to see the rest - do not read this list as complete.`;
}

/** The caveat that always applies on this platform. */
export const AMOUNT_NOTE =
  'EnerGov shows a case status but not the dollar amount. A status of "Lien" means one is recorded against the property; the figure comes from the county records or the city directly.';
