// Who is reading the report? The same county facts mean different things to a
// buyer, an owner, a seller and a professional, so the report re-words itself
// around the answer to one question asked up front. The data never changes by
// role; only the framing, the order of advice and the calls to action do.

import type { DiagnosticReport } from './types';
import { computeReadiness } from './readiness';

export type Persona = 'buyer' | 'owner' | 'seller' | 'pro' | 'other';

export const PERSONA_ORDER: Persona[] = ['buyer', 'owner', 'seller', 'pro', 'other'];

export const PERSONAS: Record<Persona, { label: string; short: string; hint: string }> = {
  buyer: { label: 'I am thinking of buying it', short: 'Buyer', hint: 'Find out what to ask, fix or negotiate before you offer.' },
  owner: { label: 'I own it', short: 'Owner', hint: 'See where your home stands with insurers and the county.' },
  seller: { label: 'I am selling it', short: 'Seller', hint: 'See what a buyer will find, and fix it before you list.' },
  pro: { label: 'I am a professional', short: 'Professional', hint: 'Agent, inspector, lender or contractor working for a client.' },
  other: { label: 'Just curious', short: 'Other', hint: 'A neutral look at the records.' },
};

export function parsePersona(v: unknown): Persona | null {
  return typeof v === 'string' && (PERSONA_ORDER as string[]).includes(v) ? (v as Persona) : null;
}

export interface PersonaCopy {
  readinessTitle: string;
  readinessAsk: string;
  forYouTitle: string;
  fixTitle: string;
  fixIntro: string;
  fixButton: string;
  packetTitle: string;
  packetIntro: string;
  shareTitle: string;
  shareIntro: string;
  // The deal-negotiation section only makes sense to someone on the buying side.
  showNegotiation: boolean;
  // How the popup text on each scorecard metric is labelled and ordered.
  tipFirst: 'buyer' | 'owner';
  tipLabels: { buyer: string; owner: string };
  // Word for "you" in the PDF negotiate page heading.
  dealPageTitle: string;
  dealPageKicker: string;
}

const COPY: Record<Persona, PersonaCopy> = {
  buyer: {
    readinessTitle: 'Closing readiness',
    readinessAsk: 'Can it close and be insured?',
    forYouTitle: 'What this means if you buy it',
    fixTitle: 'Fix it, or make the seller',
    fixIntro: 'Each problem has a route to closing it. Ask the seller to fix it or credit you, or get a fixed quote to price it yourself.',
    fixButton: 'Get a fixed quote to price it',
    packetTitle: 'Insurance packet',
    packetIntro: 'The papers an insurance agent or lender will ask for, so nothing surprises you near closing.',
    shareTitle: 'Share this record',
    shareIntro: 'A dated, shareable summary of this property\'s records check. Send it to your agent, lender or partner. It is valid for 30 days.',
    showNegotiation: true,
    tipFirst: 'buyer',
    tipLabels: { buyer: 'If you are buying', owner: 'If you own it' },
    dealPageTitle: 'Use it in the deal',
    dealPageKicker: 'Negotiate',
  },
  owner: {
    readinessTitle: 'Home health',
    readinessAsk: 'Where does your home stand with insurers and the county?',
    forYouTitle: 'What this means for your home',
    fixTitle: 'Fix it',
    fixIntro: 'Each problem has a route to closing it. Tap a card for the steps and a fixed quote.',
    fixButton: 'Get a fixed quote',
    packetTitle: 'Papers that protect your coverage',
    packetIntro: 'The papers an insurer will ask for. Having them on hand can lower your premium and speeds up a claim or a sale.',
    shareTitle: 'Keep a dated record',
    shareIntro: 'A dated summary of where your property stands. Keep it for your files or hand it to your insurance agent. It is valid for 30 days.',
    showNegotiation: false,
    tipFirst: 'owner',
    tipLabels: { buyer: 'What a buyer or insurer would see', owner: 'What to do about it' },
    dealPageTitle: 'Keep it in good standing',
    dealPageKicker: 'Your home',
  },
  seller: {
    readinessAsk: 'Will it pass a buyer\'s inspection and insurance check?',
    readinessTitle: 'Listing readiness',
    forYouTitle: 'What this means if you sell it',
    fixTitle: 'Fix before you list',
    fixIntro: 'Buyers and their insurers will find these. Fixing them first protects your price and your closing date.',
    fixButton: 'Get it fixed before I list',
    packetTitle: 'Papers buyers will ask for',
    packetIntro: 'Have these ready when you list. Buyers and insurers ask for them, and missing papers are a common reason a deal slips.',
    shareTitle: 'Show buyers a clean record',
    shareIntro: 'Send this dated record to buyers and agents up front. It builds trust and cuts surprises late in the deal. It is valid for 30 days.',
    showNegotiation: false,
    tipFirst: 'buyer',
    tipLabels: { buyer: 'What a buyer will see', owner: 'What to do about it' },
    dealPageTitle: 'Before you list',
    dealPageKicker: 'Sell with fewer surprises',
  },
  pro: {
    readinessTitle: 'Closing readiness',
    readinessAsk: 'Can your client close and insure it?',
    forYouTitle: 'Client summary',
    fixTitle: 'Fix it for your client',
    fixIntro: 'Each problem has a route to closing it. Request a fixed quote you can hand to your client.',
    fixButton: 'Quote for my client',
    packetTitle: 'Client insurance packet',
    packetIntro: 'The papers an insurer or lender will ask your client for.',
    shareTitle: 'Send this to your client',
    shareIntro: 'A dated, shareable summary for your client or file. It is valid for 30 days.',
    showNegotiation: true,
    tipFirst: 'buyer',
    tipLabels: { buyer: 'For a buyer client', owner: 'For an owner client' },
    dealPageTitle: 'Client talking points',
    dealPageKicker: 'For your client',
  },
  other: {
    readinessTitle: 'Closing readiness',
    readinessAsk: 'Can it close and be insured?',
    forYouTitle: 'What this means',
    fixTitle: 'Fix it',
    fixIntro: 'Each problem has a route to closing it. Tap a card for the steps and a fixed quote.',
    fixButton: 'Get a fixed quote',
    packetTitle: 'Insurance packet',
    packetIntro: 'The papers an insurance agent or lender will ask for.',
    shareTitle: 'Share this record',
    shareIntro: 'A dated, shareable summary of this property\'s records check. It is valid for 30 days.',
    showNegotiation: true,
    tipFirst: 'buyer',
    tipLabels: { buyer: 'If you are buying', owner: 'If you own it' },
    dealPageTitle: 'Use it in the deal',
    dealPageKicker: 'Negotiate',
  },
};

export function personaCopy(role: Persona | null | undefined): PersonaCopy {
  return COPY[role ?? 'other'];
}

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

// Three short, role-specific takeaways drawn from the same readiness result.
export function takeaways(role: Persona | null | undefined, r: DiagnosticReport): string[] {
  const rd = r.readiness ?? computeReadiness(r);
  const who = role ?? 'other';
  const top = [...rd.factors].sort((a, b) => b.penalty - a.penalty)[0];
  const out: string[] = [];

  out.push(
    who === 'seller'
      ? `A buyer's check would score this home ${rd.score} out of 100. ${bandSummaryFor(who, rd)}`
      : who === 'owner'
      ? `Your home scores ${rd.score} out of 100 for insurance and county standing. ${bandSummaryFor(who, rd)}`
      : who === 'pro'
      ? `Closing readiness is ${rd.score} out of 100 (${rd.bandLabel}). ${rd.bandSummary}`
      : `Closing readiness is ${rd.score} out of 100. ${rd.bandSummary}`,
  );

  out.push(
    top && top.penalty > 0
      ? `${who === 'seller' ? 'The first thing a buyer will hit' : who === 'owner' ? 'The biggest item to look after' : 'Biggest issue'}: ${top.label.toLowerCase()}. ${top.reason}`
      : 'No major issues found in the records.',
  );

  const tax = r.countyExtras?.tax;
  if (tax && tax.increase > 0) {
    const est = money(tax.estAnnualIncrease);
    out.push(
      who === 'seller'
        ? `Buyers will see the tax reset: about ${est} a year more for them. Be ready for that question.`
        : who === 'owner'
        ? `The county values your home at ${money(tax.marketValue)} but taxes you on ${money(tax.currentTaxable)}. That cap saves you about ${est} a year while you own it.`
        : who === 'pro'
        ? `Tax reset on a sale: about ${est} a year more (estimate).`
        : who === 'buyer'
        ? `Expect taxes to rise about ${est} a year after you buy, because the cap resets.`
        : `Taxes can rise about ${est} a year after a sale, because the cap resets.`,
    );
  } else if (r.countyExtras?.evacuation?.zone) {
    out.push(`Hurricane evacuation Zone ${r.countyExtras.evacuation.zone}. Roofs, windows and doors need Miami-Dade product approval.`);
  }
  return out;
}

// Insurance advice written for the reader. Buyers and neutral readers keep the
// report's own (buyer-voiced) recommendations.
export function insuranceTips(role: Persona | null | undefined): string[] | null {
  if (role === 'owner') {
    return [
      'Order a wind-mitigation inspection. Roof shape, roof-to-wall straps and opening protection earn premium credits.',
      'Keep the roof permit, final inspection and any warranty together in one folder.',
      'Ask your agent to re-quote after any roof or opening upgrade.',
      'Impact windows or shutters are usually the biggest single premium credit if you do not have them.',
    ];
  }
  if (role === 'seller') {
    return [
      'Order a 4-point and wind-mitigation inspection now, so a buyer\'s insurer has papers to review.',
      'Gather the roof permit, final inspection and any warranty. Buyers will ask for them.',
      'If the roof is near the end of its life, price a replacement or plan a credit before you list.',
      'Know what your insurance costs today. Buyers will ask.',
    ];
  }
  if (role === 'pro') {
    return [
      'Order the 4-point and wind-mitigation inspections for your client before the contingency ends.',
      'Get a bindable insurance quote, not an estimate, before your client commits.',
      'Ask for the roof permit, final inspection and warranty from the seller.',
      'Flag opening protection and roof-deck attachment on the wind-mitigation form. They drive the biggest credits.',
    ];
  }
  return null;
}

// The readiness verdict sentence, worded for the reader. Buyers, professionals
// and neutral readers keep the original wording.
export function bandSummaryFor(role: Persona | null | undefined, rd: { band: string; bandSummary: string }): string {
  const by: Record<string, Record<string, string>> = {
    owner: {
      ready: 'Your home looks in good standing with insurers and the county.',
      'fix-first': 'A few items could raise your premium or cause trouble at a sale. Worth fixing soon.',
      hard: 'Insurers or a buyer would likely push back as things stand. Fix the red items first.',
      'high-risk': 'Several serious items. Address them before you renew, refinance or sell.',
    },
    seller: {
      ready: 'A buyer is unlikely to hit major problems in the records.',
      'fix-first': 'A buyer will likely raise a few items. Fix them first to protect your price.',
      hard: 'Expect pushback from buyers, lenders or insurers. Fix the red items before you list.',
      'high-risk': 'Several serious items could sink a deal. Fix them before you list.',
    },
  };
  return (role && by[role]?.[rd.band]) || rd.bandSummary;
}
