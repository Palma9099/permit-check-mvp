// Insurability & roof-age risk — derived, records-only, never a quote.
//
// In Florida the roof is the single biggest factor in whether a home can be
// insured and at what price. Admitted carriers increasingly decline or non-renew
// homes with older roofs, pushing owners to Citizens or the surplus-lines market.
// We can't quote a policy, but from the permit record we CAN tell a buyer roughly
// where the roof stands and what to demand before closing.
//
// HONESTY: everything here is an estimate framed for the buyer to verify. We never
// state a premium, name a carrier as fact, or guarantee insurability. Values are
// derived from real inputs (the most recent roofing permit year, the year built)
// or clearly marked unknown.

import type { Permit, InsuranceRisk } from '../types';

export type { InsuranceRisk };

const ROOF_RE = /\broof|re-?roof|reroof|shingle|tile roof|roofing\b/i;
const OPENING_RE = /impact|shutter|hurricane|window|\bdoor(s)?\b|opening protection|fenestration/i;

function isRoofPermit(p: Permit): boolean {
  return ROOF_RE.test(p.appType ?? '') || ROOF_RE.test(p.scope ?? '');
}
function isOpeningPermit(p: Permit): boolean {
  return OPENING_RE.test(p.appType ?? '') || OPENING_RE.test(p.scope ?? '');
}

function yearOf(iso: string | null): number | null {
  if (!iso) return null;
  const m = /(\d{4})/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  return y >= 1900 && y <= 2100 ? y : null;
}

/**
 * Assess roof-age-driven insurability from the permit record.
 * @param permits    subject permits (may be empty for links-only counties)
 * @param yearBuilt  property year built, if known
 * @param currentYear the report's generation year (passed in so this stays pure)
 * @param permitsPulled whether live permits were actually retrieved for this county
 *                      (false ⇒ absence of a roof permit is unknown, not "original roof")
 */
export function assessInsurance(
  permits: Permit[],
  yearBuilt: number | null,
  currentYear: number,
  permitsPulled: boolean,
): InsuranceRisk {
  const roofYears = permits
    .filter(isRoofPermit)
    .map((p) => yearOf(p.issueDate))
    .filter((y): y is number => y != null);
  const roofPermitYear = roofYears.length ? Math.max(...roofYears) : null;
  const openingProtection = permits.some(isOpeningPermit);

  let roofAgeYears: number | null = null;
  let roofBasis: string;
  let band: InsuranceRisk['band'];

  if (roofPermitYear != null) {
    roofAgeYears = Math.max(0, currentYear - roofPermitYear);
    roofBasis = `Most recent roofing permit was issued in ${roofPermitYear}, about ${roofAgeYears} year${roofAgeYears === 1 ? '' : 's'} ago.`;
    band =
      roofAgeYears <= 10 ? 'newer' : roofAgeYears <= 15 ? 'watch' : roofAgeYears <= 20 ? 'aging' : 'old';
  } else if (!permitsPulled) {
    roofBasis =
      'We could not pull permits for this county automatically, so the roof age is unconfirmed. Verify it from the roofing permit or a roof inspection.';
    band = 'unknown';
  } else if (yearBuilt != null) {
    // Permits were pulled and none is a roofing permit → the roof may be original.
    const age = Math.max(0, currentYear - yearBuilt);
    roofBasis = `No roofing permit is on file, so the roof may be original to the ${yearBuilt} home (about ${age} years old). Verify with a roof inspection.`;
    band = age > 20 ? 'old' : age > 15 ? 'aging' : 'unknown';
    roofAgeYears = null; // unconfirmed — we don't assert an original-roof age as fact
  } else {
    roofBasis = 'No roofing permit and no year built are on record, so the roof age is unknown.';
    band = 'unknown';
  }

  const insurabilityNote: string = {
    newer:
      'A roof this age is generally insurable on the standard admitted market, all else equal.',
    watch:
      'Around this age, carriers increasingly ask for a roof-condition or 4-point inspection, but the home is still commonly insurable.',
    aging:
      'At this age many admitted carriers decline or require replacement within a set period, and Citizens or surplus-lines coverage becomes more likely.',
    old: 'At this age most admitted carriers require roof replacement before binding coverage; expect non-renewal risk and higher premiums.',
    unknown:
      'Roof age drives insurability in Florida. Because it is unconfirmed here, treat an older or original roof as a real cost and pricing risk until an inspection confirms it.',
  }[band];

  const windMitNote = openingProtection
    ? 'Window, door, or shutter work is on file, which can support wind-mitigation premium credits once verified by inspection.'
    : 'No opening-protection permit (impact windows/doors or shutters) is on file. A wind-mitigation inspection determines any credits.';

  const recommendations: string[] = [
    'Get a quote bound before your inspection contingency ends — insurability, not price alone, can end a Florida deal.',
    'Order a 4-point inspection and a wind-mitigation inspection; these, not records, set the premium.',
  ];
  if (band === 'aging' || band === 'old' || band === 'unknown') {
    recommendations.push(
      'Ask the seller for the roof’s age, permit, and any warranty, and factor a possible replacement into your offer.',
    );
  }
  if (!openingProtection) {
    recommendations.push(
      'Confirm opening protection and roof-deck attachment on the wind-mit form — they drive the biggest premium credits.',
    );
  }

  return {
    roofPermitYear,
    roofAgeYears,
    roofBasis,
    band,
    insurabilityNote,
    openingProtection,
    windMitNote,
    recommendations,
  };
}
