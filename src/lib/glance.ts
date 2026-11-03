// "At a glance" metrics shared by the web report and the PDF. One source, so the
// words on screen and in print never drift apart. Each metric carries a short
// explanation: what it is, what it means for a buyer, and for an owner.

import type { DiagnosticReport } from './types';

export type Tone = 'red' | 'amber' | 'green' | 'grey';

export interface GlanceInfo {
  what: string;
  buyer: string;
  owner: string;
}

export interface GlanceItem {
  key: 'permits' | 'roof' | 'flood' | 'recert' | 'code' | 'aerial';
  label: string;
  value: string;
  detail: string;
  tone: Tone;
  info: GlanceInfo;
}

export function buildGlance(r: DiagnosticReport): GlanceItem[] {
  const year = r.property.yearBuilt;
  const age = year ? new Date().getFullYear() - year : null;

  // Permits
  const n = r.permitHistory.totalSubjectPermits;
  const noPermitOld = n === 0 && !!age && age > 15;
  const permits: GlanceItem = {
    key: 'permits',
    label: 'Permits',
    value: n === 0 ? 'None found' : `${n} on file`,
    detail: n === 0 ? (year ? `Built ${year}. Nothing in county records.` : 'Nothing in county records.') : 'Listed in county records.',
    tone: n === 0 ? (noPermitOld ? 'amber' : 'grey') : 'green',
    info: {
      what: 'Permits the county has on record for this address.',
      buyer: noPermitOld
        ? `A home this old with no permits usually means the roof, A/C, windows or any additions were never permitted, or the permits are on paper. Unpermitted work can block insurance, a loan or a resale, and it becomes yours when you buy.`
        : n === 0
        ? 'No permits on file. For a newer home that can be normal. Ask the seller what work was done.'
        : 'Permits show what was done legally. Ask for final inspections on any that are still open.',
      owner: noPermitOld
        ? 'If work was done without a permit, an after-the-fact permit is usually the fix. Do it before you list the home or file an insurance claim.'
        : 'Keep your final inspection papers. Buyers and insurers ask for them.',
    },
  };

  // Roof and insurance
  const roofRisk = r.insurance.band === 'old' || r.insurance.band === 'unknown';
  const roof: GlanceItem = {
    key: 'roof',
    label: 'Roof and insurance',
    value: roofRisk ? 'Likely original' : 'No concern',
    detail: roofRisk ? 'No roof permit. Insurers may balk.' : 'Roof permit on record.',
    tone: roofRisk ? 'red' : 'green',
    info: {
      what: 'Roof age estimated from permits. Florida insurers price and approve homes mostly by roof age.',
      buyer: roofRisk
        ? 'Many Florida insurers decline roofs older than about 15 to 20 years or charge much more. Get a 4-point and wind-mitigation inspection and a bindable quote before your contingency ends. Budget for a possible new roof.'
        : 'A permitted newer roof helps you get coverage. Still order a 4-point and wind-mitigation inspection, since those set your premium.',
      owner: roofRisk
        ? 'A roof inspection and a wind-mitigation report can lower your premium. Replacing an aging roof protects your coverage and your resale value.'
        : 'Keep the roof permit and wind-mitigation report. They earn premium credits and help a sale.',
    },
  };

  // Flood
  const zone = r.flood.zone;
  const flood: GlanceItem = {
    key: 'flood',
    label: 'Flood zone',
    value: zone ? `Zone ${zone}` : 'Unknown',
    detail: zone ? (r.flood.inSFHA ? 'High-risk area. Insurance likely required.' : 'Low risk. Not required.') : 'Check FEMA map.',
    tone: zone ? (r.flood.inSFHA ? 'red' : 'green') : 'grey',
    info: {
      what: 'FEMA flood zone for this address. It drives flood insurance and what you can build.',
      buyer: r.flood.inSFHA
        ? 'Lenders require flood insurance in this zone, which adds real monthly cost. Big renovations may require raising the home. Get a flood quote before you offer.'
        : 'Lenders usually do not require flood insurance here, but about a quarter of flood claims come from low-risk zones. A low-cost policy is worth pricing.',
      owner: r.flood.inSFHA
        ? 'An elevation certificate can lower your flood premium. Keep it with your records.'
        : 'Low-cost preferred-risk flood coverage is often available. Storm surge and heavy rain can still reach low-risk zones.',
    },
  };

  // Milestone / recertification
  const recertNA = /no|unlikely|not/i.test(String(r.recert.applies));
  const recert: GlanceItem = {
    key: 'recert',
    label: 'Milestone / recert',
    value: recertNA ? 'Not expected' : 'May apply',
    detail: recertNA ? 'Condos and large buildings only.' : 'Check county deadline.',
    tone: recertNA ? 'grey' : 'amber',
    info: {
      what: "Florida's milestone inspection and recertification rules for older buildings.",
      buyer: recertNA
        ? 'These rules target condos, co-ops and larger buildings. This looks like a single-family home, so it is usually not a concern.'
        : 'Older buildings can be forced into a structural inspection and funded reserve study. Ask for the inspection status and any special assessments before you buy.',
      owner: recertNA
        ? 'Nothing to do now. Confirm with the county if the building type changes.'
        : 'Know your deadline. Missing it can bring fines and block permits and refinancing.',
    },
  };

  // Code enforcement
  const open = r.codeEnforcement.openCount;
  const code: GlanceItem = {
    key: 'code',
    label: 'Code cases',
    value: open === 0 ? 'None open' : `${open} open`,
    detail: open === 0 ? 'Clean in county records.' : 'See county code portal.',
    tone: open === 0 ? 'green' : 'red',
    info: {
      what: 'Open code violations the county has filed against this address.',
      buyer:
        open === 0
          ? 'No open violations means no county fines or liens tied to this address right now.'
          : 'Open cases can carry daily fines and liens that transfer to the new owner. Make the seller close them before closing.',
      owner:
        open === 0
          ? 'Keep it that way. Unresolved cases grow fines every day.'
          : 'Resolve open cases before you sell. Fines add up until the county signs off.',
    },
  };

  // Aerial photo comparison
  const vc = r.thenVsNow.visualComparison;
  const changes = vc?.performed ? vc.observations.filter((o) => o.severity === 'flag').length : 0;
  const aerial: GlanceItem = {
    key: 'aerial',
    label: 'Aerial photos',
    value: vc?.performed ? (changes ? `${changes} to check` : 'No changes') : 'Not compared',
    detail: vc?.performed ? (changes ? '2010 vs 2022, for review.' : '2010 vs 2022 look alike.') : 'No historical photos.',
    tone: vc?.performed ? (changes ? 'amber' : 'green') : 'grey',
    info: {
      what: 'We compare older and newer aerial photos of the lot against the permit record.',
      buyer: changes
        ? 'Visible changes without a matching permit (an addition, shed, roof or driveway) are questions for the seller, not proof. Ask, then confirm with the county.'
        : 'Nothing notable changed between the photos. It does not rule out interior work.',
      owner: changes
        ? 'Counties and buyers use aerial photos to spot unpermitted work. If you built it, permit it.'
        : 'Your lot looks consistent with the permit record. Keep records of any future work.',
    },
  };

  return [permits, roof, flood, recert, code, aerial];
}

export function glanceVerdict(items: GlanceItem[]): string {
  const k = items.filter((b) => b.tone === 'red' || b.tone === 'amber').length;
  return k ? `${k} thing${k > 1 ? 's' : ''} to check before you make an offer.` : 'Nothing alarming in county records.';
}

export function glanceNextSteps(items: GlanceItem[]): string[] {
  const by = Object.fromEntries(items.map((i) => [i.key, i])) as Record<GlanceItem['key'], GlanceItem>;
  const out: string[] = [];
  if (by.permits.tone === 'amber') out.push('Pull the certified permit file from the county, by address.');
  if (by.roof.tone === 'red') out.push('Order a roof, 4-point and wind-mitigation inspection.');
  if (by.aerial.tone === 'amber') out.push('Ask the seller about the changes seen from the air.');
  out.push('Get an insurance quote before your contingency ends.');
  return out.slice(0, 4);
}
