// Milestone inspection / county recertification / SIRS exposure.
//
// Two Florida programs can force a costly structural inspection and reserve study
// on an aging building:
//   • The statewide MILESTONE inspection (FS 553.899, as amended by SB 154, 2023):
//     condominium & cooperative buildings 3+ habitable stories, first due at 30
//     years (25 near salt water), then every 10.
//   • COUNTY RECERTIFICATION (Miami-Dade §8-11(f), Broward's program, and some
//     municipalities): most buildings EXCEPT single-family homes and duplexes, on
//     a recurring schedule now beginning ~30 years (25 coastal).
//   • The SIRS (Structural Integrity Reserve Study, FS 718.112) is the related
//     financial mandate for those condo/co-op associations.
//
// We can't confirm story count from the tax roll, so we key off the DOR use class
// and age and state the trigger conditionally. Single-family homes read as "not
// applicable," which is itself useful to a buyer.
//
// HONESTY: thresholds and timing are set by each jurisdiction and have been amended
// more than once since 2022; we present the general rule and say to confirm. No
// fabricated deadline or cost.

import type { RecertExposure } from '../types';
export type { RecertExposure };

type Klass = 'single-family' | 'duplex' | 'condo' | 'coop' | 'multifamily' | 'commercial' | 'unknown';

function classify(dor: string | null): { klass: Klass; label: string } {
  const s = (dor ?? '').toLowerCase();
  if (!s) return { klass: 'unknown', label: 'building' };
  if (/cooperat|co-?op\b/.test(s)) return { klass: 'coop', label: 'cooperative' };
  if (/condo/.test(s)) return { klass: 'condo', label: 'condominium' };
  if (/duplex|two[\s-]?family|2[\s-]?family/.test(s)) return { klass: 'duplex', label: 'duplex' };
  if (/single[\s-]?family|\bsfr\b|single fam/.test(s)) return { klass: 'single-family', label: 'single-family home' };
  if (/multi[\s-]?family|apartment|apt|townhouse|town home|3[\s-]?family|residential income/.test(s))
    return { klass: 'multifamily', label: 'multi-family building' };
  if (/commercial|office|store|retail|warehouse|industrial|hotel|motel|mixed use/.test(s))
    return { klass: 'commercial', label: 'commercial building' };
  return { klass: 'unknown', label: 'building' };
}

// County recertification exists as a countywide program in Miami-Dade and Broward.
function hasCountyRecert(countyKey: string): boolean {
  return countyKey === 'miami-dade' || countyKey === 'broward';
}

export function assessRecert(
  dorDescription: string | null,
  yearBuilt: number | null,
  countyKey: string,
  currentYear: number,
): RecertExposure {
  const { klass, label } = classify(dorDescription);
  const age = yearBuilt != null ? Math.max(0, currentYear - yearBuilt) : null;
  const countyRecert = hasCountyRecert(countyKey);

  // Single-family and duplex homes are exempt from both programs.
  if (klass === 'single-family' || klass === 'duplex') {
    return {
      applies: 'unlikely',
      buildingClass: label,
      programs: [],
      timing: 'n-a',
      detail: `This reads as a ${label} on the tax roll. Florida's milestone inspection (condos/co-ops) and county recertification (Miami-Dade and Broward) generally do not apply to ${klass === 'duplex' ? 'duplexes' : 'single-family homes'}, so this is usually not a concern here.`,
      recommendation: null,
    };
  }

  const programs: string[] = [];
  const isCondoCoop = klass === 'condo' || klass === 'coop';
  if (isCondoCoop) {
    programs.push('Milestone inspection (FS 553.899, if 3+ stories)');
    programs.push('Structural Integrity Reserve Study (SIRS)');
  }
  if (countyRecert && (isCondoCoop || klass === 'multifamily' || klass === 'commercial')) {
    programs.push(`${countyKey === 'broward' ? 'Broward' : 'Miami-Dade'} county recertification`);
  }

  // Timing from age against the ~30-year first trigger.
  let timing: string;
  if (age == null) {
    timing = 'unknown (year built not on record)';
  } else if (age >= 30) {
    timing = `about ${age} years old — at or past the initial ~30-year trigger (25 near salt water); confirm current status`;
  } else if (age >= 25) {
    timing = `about ${age} years old — near the 25-year coastal trigger; confirm whether the salt-water rule applies`;
  } else {
    timing = `about ${age} years old — roughly ${30 - age} years from the initial ~30-year trigger`;
  }

  if (programs.length === 0) {
    // Condo/co-op/multifamily somewhere without a countywide recert program, and
    // not clearly 3+ story condo → keep it soft.
    return {
      applies: klass === 'unknown' ? 'unknown' : 'possible',
      buildingClass: label,
      programs: [],
      timing: age != null ? timing : 'unknown',
      detail:
        klass === 'unknown'
          ? 'The building class could not be read from the tax roll. If this is a 3+ story condo or a multi-family or commercial building, milestone or recertification requirements may apply; confirm with the county.'
          : `This reads as a ${label}. Statewide milestone rules target 3+ story condos and co-ops, and this county has no countywide recertification program, so an inspection mandate is less likely here — but confirm with the local building department.`,
      recommendation: null,
    };
  }

  const overdue = age != null && age >= 25;
  const applies: RecertExposure['applies'] = isCondoCoop || klass === 'multifamily' ? 'likely' : 'possible';

  const detail =
    `This reads as a ${label}. ` +
    (isCondoCoop
      ? `If it is 3 or more habitable stories, the statewide milestone inspection applies (first at 30 years, 25 near salt water, then every 10), and the association also owes a Structural Integrity Reserve Study. `
      : '') +
    (countyRecert && (klass === 'multifamily' || klass === 'commercial')
      ? `${countyKey === 'broward' ? 'Broward' : 'Miami-Dade'}'s recertification program covers buildings like this on a recurring schedule. `
      : '') +
    `It is ${timing}.`;

  const recommendation = overdue
    ? 'Confirm the milestone / recertification status and any deadline with the county now — an overdue inspection can bring fines and assessments. We perform the structural inspection and sealed report.'
    : 'Ask the association or seller for the most recent milestone or recertification report and reserve study before you commit. We can perform the structural inspection and sealed report when one is due.';

  return { applies, buildingClass: label, programs, timing, detail, recommendation };
}
