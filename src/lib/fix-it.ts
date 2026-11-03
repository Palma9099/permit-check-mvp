// "Fix it" paths: for each problem the report finds, the real route to closing
// it, who does the work, and what drives the price. Dollar and time ranges are
// deliberately NOT invented here. Put real numbers in FIX_IT_RANGES (strings
// like "$2,500 to $6,000" and "4 to 10 weeks") and they appear on the cards.
// Until then the cards promise a fixed quote within one business day.

import type { DiagnosticReport } from './types';
import type { Readiness } from './readiness';

export interface FixIt {
  key: string;
  title: string;
  why: string;
  steps: string[];
  owner: string;
  tone: 'red' | 'amber';
  quoteTopic: string;
  cost: string | null;
  timeline: string | null;
}

// Edit these to show real ranges on every report. Leave null to show none.
export const FIX_IT_RANGES: Record<string, { cost: string | null; timeline: string | null }> = {
  legalize: { cost: null, timeline: null },
  roof: { cost: null, timeline: null },
  flood: { cost: null, timeline: null },
  code: { cost: null, timeline: null },
  closeout: { cost: null, timeline: null },
  septic: { cost: null, timeline: null },
  milestone: { cost: null, timeline: null },
};

function mk(
  key: string,
  base: Omit<FixIt, 'key' | 'cost' | 'timeline'>,
): FixIt {
  const r = FIX_IT_RANGES[key] ?? { cost: null, timeline: null };
  return { key, ...base, cost: r.cost, timeline: r.timeline };
}

export function buildFixIts(r: DiagnosticReport, rd: Readiness): FixIt[] {
  const by = Object.fromEntries(rd.factors.map((f) => [f.key, f]));
  const out: FixIt[] = [];

  if (by.permits.penalty >= 12 || by.aerial.penalty >= 8) {
    out.push(
      mk('legalize', {
        title: 'Legalize unpermitted work',
        why: 'Work with no permit can block a sale, a loan or an insurance claim, and it transfers to the next owner.',
        steps: [
          'Measure and document what exists now.',
          'Sealed engineering if the work is structural, to show it meets code.',
          'File an after-the-fact permit with the county.',
          'Pass inspections and get the permit closed out.',
        ],
        owner: 'Airavata (engineering) and Palma (permitting)',
        tone: by.permits.penalty >= 12 ? 'red' : 'amber',
        quoteTopic: 'Legalize unpermitted work (after-the-fact permit)',
      }),
    );
  }

  if (by.roof.penalty >= 8) {
    out.push(
      mk('roof', {
        title: 'Make the roof insurable',
        why: 'Roof age is the first thing Florida insurers check. An old or unpermitted roof can mean no policy, or a very high premium.',
        steps: [
          'Roof inspection and 4-point inspection.',
          'Wind-mitigation inspection for premium credits.',
          'If the roof is near end of life, scope a permitted replacement.',
          'Collect the permit and inspection papers for the insurer.',
        ],
        owner: 'Palma (inspections and permitting)',
        tone: by.roof.tone === 'red' ? 'red' : 'amber',
        quoteTopic: 'Roof, 4-point and wind-mitigation inspections',
      }),
    );
  }

  if (r.flood?.inSFHA) {
    out.push(
      mk('flood', {
        title: 'Get an elevation certificate',
        why: 'In a high-risk flood zone, a surveyor-signed elevation certificate can lower the flood premium and is needed for many renovations.',
        steps: ['Order an elevation certificate from a licensed surveyor.', 'Compare it to the base flood elevation.', 'Use it to re-quote flood insurance.'],
        owner: 'Palma (coordination)',
        tone: 'amber',
        quoteTopic: 'Elevation certificate and flood review',
      }),
    );
  }

  if ((r.codeEnforcement?.openCount ?? 0) > 0) {
    out.push(
      mk('code', {
        title: 'Close the open code case',
        why: 'Open cases can carry daily fines and liens that pass to the new owner.',
        steps: ['Read the case and the required corrections.', 'Complete the work and any needed permits.', 'Request re-inspection until the county closes the case.'],
        owner: 'Palma (code compliance)',
        tone: 'red',
        quoteTopic: 'Resolve an open code enforcement case',
      }),
    );
  }

  const ph = r.countyExtras?.permitHealth;
  if (ph && (ph.noInspection > 0 || ph.inspectedNoCloseout > 0)) {
    out.push(
      mk('closeout', {
        title: 'Close out open permits',
        why: 'A permit with no final can show up as open work to an insurer or buyer.',
        steps: ['Pull the permit file from the county.', 'Schedule the missing inspections.', 'Get the final or certificate of completion on record.'],
        owner: 'Palma (permitting)',
        tone: ph.noInspection > 0 ? 'amber' : 'amber',
        quoteTopic: 'Close out open or unfinished permits',
      }),
    );
  }

  if (r.countyExtras?.sewer?.septicOrWellFlag) {
    out.push(
      mk('septic', {
        title: 'Check the septic system',
        why: 'A failing septic system is costly. Lenders and buyers often want an inspection before closing.',
        steps: ['Request the septic permit and last inspection from the county health department.', 'Order a septic inspection.', 'Price any repair or a sewer connection.'],
        owner: 'Palma (coordination)',
        tone: 'amber',
        quoteTopic: 'Septic inspection and records',
      }),
    );
  }

  if (by.recert.penalty > 0) {
    out.push(
      mk('milestone', {
        title: 'Plan the milestone inspection',
        why: 'Older buildings can be forced into a structural inspection and funded reserves.',
        steps: ['Confirm the county deadline.', 'Order the structural inspection.', 'Budget for any repairs it finds.'],
        owner: 'Airavata (engineering)',
        tone: 'amber',
        quoteTopic: 'Milestone / recertification inspection',
      }),
    );
  }

  return out;
}

export interface PacketItem {
  item: string;
  status: 'needed' | 'recommended' | 'ok';
  note: string;
}

// The papers an insurance agent or lender will ask for, so a buyer is not
// surprised three days before closing.
export function buildInsurancePacket(r: DiagnosticReport, rd: Readiness): PacketItem[] {
  const age = r.property.yearBuilt ? new Date().getFullYear() - r.property.yearBuilt : null;
  const roofRisk = rd.factors.find((f) => f.key === 'roof')!.penalty >= 8;
  const out: PacketItem[] = [];
  out.push({
    item: '4-point inspection',
    status: age && age >= 25 ? 'needed' : 'recommended',
    note: age && age >= 25 ? `Insurers commonly require one for homes this old (${age} years).` : 'Often requested by insurers; cheap insurance against surprises.',
  });
  out.push({
    item: 'Wind-mitigation inspection',
    status: 'recommended',
    note: 'Documents roof shape, roof-to-wall straps, openings and more. It earns premium credits.',
  });
  out.push({
    item: 'Roof condition certificate',
    status: roofRisk ? 'needed' : 'ok',
    note: roofRisk ? 'No recent roof permit on record. Many insurers ask for proof of age and remaining life.' : 'A recent roof permit is on record.',
  });
  if (r.flood?.inSFHA) {
    out.push({ item: 'Elevation certificate', status: 'needed', note: 'Needed to price flood insurance in a high-risk zone.' });
  }
  const ph = r.countyExtras?.permitHealth;
  if (ph && (ph.noInspection > 0 || ph.inspectedNoCloseout > 0)) {
    out.push({ item: 'Permit close-out papers', status: 'recommended', note: 'Some permits show no close-out date. Have the finals on hand.' });
  }
  if (r.countyExtras?.sewer?.septicOrWellFlag) {
    out.push({ item: 'Septic inspection', status: 'needed', note: 'The county lists the parcel as possibly on septic or a well.' });
  }
  return out;
}
