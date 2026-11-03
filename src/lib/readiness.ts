// Closing readiness: one 0 to 100 number for "can this home close and be
// insured at a normal price?", built from signals the report already has. It is
// a transparent heuristic, not an insurer's or lender's decision. Every point
// lost is tied to a named factor with a plain reason, so nobody has to trust a
// black box. Shared by the web report, the PDF and the shareable record.

import type { DiagnosticReport } from './types';

export type Tone = 'red' | 'amber' | 'green' | 'grey';

export interface ReadinessFactor {
  key: 'roof' | 'permits' | 'aerial' | 'flood' | 'code' | 'sewer' | 'recert';
  label: string;
  penalty: number; // points lost
  max: number; // most points this factor can cost
  tone: Tone;
  reason: string; // one plain sentence
}

export interface Readiness {
  score: number; // 0 to 100, higher is better
  band: 'ready' | 'fix-first' | 'hard' | 'high-risk';
  bandLabel: string;
  bandSummary: string;
  factors: ReadinessFactor[];
  // Facts that matter but are not scored (they change cost, not closability).
  notes: string[];
}

const BANDS: Array<{ min: number; band: Readiness['band']; label: string; summary: string }> = [
  { min: 85, band: 'ready', label: 'Ready to close', summary: 'No major closing or insurance blockers found in the records.' },
  { min: 65, band: 'fix-first', label: 'Closable, fix first', summary: 'Likely closable, but a few items should be settled before or during the contract.' },
  { min: 40, band: 'hard', label: 'Hard to close as is', summary: 'Expect insurance, lender or permit questions. Resolve the red items before you rely on a closing date.' },
  { min: 0, band: 'high-risk', label: 'High risk', summary: 'Several serious items. Get them priced and resolved before you commit.' },
];

function toneFor(penalty: number, max: number): Tone {
  if (penalty <= 0) return 'green';
  return penalty >= max * 0.6 ? 'red' : 'amber';
}

export function computeReadiness(r: DiagnosticReport): Readiness {
  const factors: ReadinessFactor[] = [];
  const year = r.property.yearBuilt;
  const age = year ? new Date().getFullYear() - year : null;

  // 1. Roof and insurability (the biggest Florida deal killer): up to 35.
  const roofMax = 35;
  const bandPenalty: Record<string, number> = { newer: 0, watch: 8, aging: 18, old: 30, unknown: 20 };
  let roofPenalty = bandPenalty[r.insurance?.band ?? 'unknown'] ?? 20;
  if (roofPenalty > 0 && r.insurance?.openingProtection) roofPenalty = Math.max(0, roofPenalty - 4);
  factors.push({
    key: 'roof',
    label: 'Roof and insurance',
    penalty: roofPenalty,
    max: roofMax,
    tone: toneFor(roofPenalty, roofMax),
    reason:
      roofPenalty === 0
        ? 'A recent roof permit is on record.'
        : r.insurance?.band === 'unknown'
        ? 'Roof age could not be confirmed from the records. Insurers will ask.'
        : 'No recent roof permit, so the roof may be original. Many insurers decline or surcharge older roofs.',
  });

  // 2. Permit gaps: up to 15.
  const permitMax = 15;
  const nPermits = r.permitHistory.totalSubjectPermits;
  const ph = r.countyExtras?.permitHealth;
  let permitPenalty = 0;
  let permitReason = 'Permit record looks consistent with the home.';
  if (nPermits === 0 && age && age > 15) {
    permitPenalty = 12;
    permitReason = `No permits for a ${age}-year-old home. Repairs may be unpermitted, or records may be on paper.`;
  } else if (ph && ph.noInspection > 0) {
    permitPenalty = 6;
    permitReason = 'A permit has no inspection on record. Ask the seller for the final.';
  } else if (ph && ph.inspectedNoCloseout > 0) {
    permitPenalty = 2;
    permitReason = 'Permits were inspected but show no close-out date. Ask for the final paperwork.';
  }
  factors.push({ key: 'permits', label: 'Permits', penalty: permitPenalty, max: permitMax, tone: toneFor(permitPenalty, permitMax), reason: permitReason });

  // 3. Changes seen from the air: up to 12 (the AI check is a lead, so it is capped low).
  const aerialMax = 12;
  const vc = r.thenVsNow?.visualComparison;
  const flagged = vc?.performed ? vc.observations.filter((o) => o.severity === 'flag').length : 0;
  const aerialPenalty = Math.min(aerialMax, flagged * 4);
  factors.push({
    key: 'aerial',
    label: 'Aerial changes',
    penalty: aerialPenalty,
    max: aerialMax,
    tone: toneFor(aerialPenalty, aerialMax),
    reason: !vc?.performed
      ? 'Older aerial photos were not available to compare.'
      : flagged
      ? `${flagged} change${flagged > 1 ? 's' : ''} seen between older and newer aerials. Confirm whether permits exist.`
      : 'Older and newer aerials look alike.',
  });

  // 4. Flood: up to 15.
  const floodMax = 15;
  const floodPenalty = r.flood?.inSFHA ? 12 : r.flood?.zone ? 0 : 4;
  factors.push({
    key: 'flood',
    label: 'Flood zone',
    penalty: floodPenalty,
    max: floodMax,
    tone: toneFor(floodPenalty, floodMax),
    reason: r.flood?.inSFHA
      ? `FEMA Zone ${r.flood.zone}: lenders require flood insurance, which adds monthly cost.`
      : r.flood?.zone
      ? `FEMA Zone ${r.flood.zone}: low risk, flood insurance usually not required.`
      : 'Flood zone could not be confirmed. Check the FEMA map.',
  });

  // 5. Open code cases: up to 10.
  const codeMax = 10;
  const open = r.codeEnforcement?.openCount ?? 0;
  const codePenalty = open > 0 ? 10 : 0;
  factors.push({
    key: 'code',
    label: 'Code cases',
    penalty: codePenalty,
    max: codeMax,
    tone: toneFor(codePenalty, codeMax),
    reason: open > 0 ? `${open} open county code case${open > 1 ? 's' : ''}. Fines and liens can pass to a new owner.` : 'No open code cases.',
  });

  // 6. Sewer or septic: up to 5.
  const sewerMax = 5;
  const sw = r.countyExtras?.sewer;
  const sewerPenalty = sw ? (sw.septicOrWellFlag ? 4 : sw.inServiceArea ? 0 : 2) : 0;
  factors.push({
    key: 'sewer',
    label: 'Sewer or septic',
    penalty: sewerPenalty,
    max: sewerMax,
    tone: toneFor(sewerPenalty, sewerMax),
    reason: sw?.summary ?? 'Sewer or septic status was not available for this county.',
  });

  // 7. Milestone and recertification: up to 4.
  const recertMax = 4;
  const recertApplies = !!r.recert && !/no|unlikely|not/i.test(String(r.recert.applies));
  const recertPenalty = recertApplies ? 4 : 0;
  factors.push({
    key: 'recert',
    label: 'Milestone / recert',
    penalty: recertPenalty,
    max: recertMax,
    tone: toneFor(recertPenalty, recertMax),
    reason: recertApplies ? 'An older building rule may require a structural inspection. Check the deadline.' : 'Not expected for this property type.',
  });

  const lost = factors.reduce((n, f) => n + f.penalty, 0);
  const score = Math.max(0, Math.min(100, 100 - lost));
  const b = BANDS.find((x) => score >= x.min) ?? BANDS[BANDS.length - 1];

  const notes: string[] = [];
  const tax = r.countyExtras?.tax;
  if (tax && tax.increase > 0) {
    notes.push(`Property tax can rise by about $${tax.estAnnualIncrease.toLocaleString('en-US')} a year after a sale (estimate).`);
  }
  if (r.countyExtras?.evacuation?.zone) {
    notes.push(`Hurricane evacuation Zone ${r.countyExtras.evacuation.zone}; Miami-Dade product approval rules apply to roofs, windows and doors.`);
  }

  return { score, band: b.band, bandLabel: b.label, bandSummary: b.summary, factors, notes };
}
