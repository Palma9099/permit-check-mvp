// Turn each finding into a buyer decision: what it means, how it typically gets
// resolved, whether sealed engineering is likely, what drives the cost, and what
// to ask the seller. Plus an aggregated negotiation pack a realtor can act on.
//
// HONESTY: this is deterministic guidance keyed to the finding type. We deliberately
// do NOT print a fabricated dollar amount, we describe the cost DRIVERS and the
// process. Real numbers come from a contractor/engineer quote for the specific work.

import type {
  Flag,
  CodeCase,
  Permit,
  InsuranceRisk,
  FloodRisk,
  RecertExposure,
  ResolutionItem,
  NegotiationPack,
} from './types';

export type { ResolutionItem, NegotiationPack };

function isUnresolvedPermit(p: Permit): boolean {
  const s = (p.status ?? '').toLowerCase();
  if (!s) return false;
  if (/final|closed|complete|c\.?o\.?|certificate of occupancy|cofo|void|withdrawn|cancel/.test(s))
    return false;
  return /open|active|expired|pending|issued|in progress|hold|stop/.test(s);
}

const ADDITION_RE = /addition|unpermit|extra feature|no matching permit|enclos|convert/i;

export function buildNegotiationPack(input: {
  flags: { strong: Flag[]; medium: Flag[] };
  openCases: CodeCase[];
  permits: Permit[];
  insurance: InsuranceRisk;
  flood: FloodRisk;
  recert: RecertExposure;
}): NegotiationPack | null {
  const items: ResolutionItem[] = [];

  // 1. Likely unpermitted work (from the strong/medium flags).
  const additionFlag = [...input.flags.strong, ...input.flags.medium].find((f) =>
    ADDITION_RE.test(`${f.title} ${f.detail}`),
  );
  if (additionFlag) {
    items.push({
      finding: 'Possible unpermitted work',
      what: 'The records suggest work that may not have a matching permit. Unpermitted structural work can block a sale, a refinance, or an insurance claim, and it becomes your problem once you own it.',
      path: 'Resolved with an after-the-fact permit: the existing construction is documented and shown to meet the code, which for structural work means sealed engineering, then inspected and finaled.',
      engineeringLikely: true,
      costDrivers:
        'Cost depends on the size and type of work, whether it already meets current code, and how much has to be opened up or corrected. Budget for permit fees, engineering, and possible corrective work; a clean, code-compliant addition is far cheaper to legalize than one that needs rework.',
      askSeller:
        'Will you legalize the unpermitted work before closing, or credit the after-the-fact permit and engineering?',
    });
  }

  // 2. Open code-enforcement cases.
  if (input.openCases.length > 0) {
    items.push({
      finding: `${input.openCases.length} open code-enforcement case${input.openCases.length === 1 ? '' : 's'}`,
      what: 'An open case can carry fines that accrue daily and can become a lien on the property, which follows the title to you.',
      path: 'Resolved by curing the violation and getting the case closed by the county, ideally before closing so no lien attaches.',
      engineeringLikely: /structur|unsafe|permit|construct/i.test(
        input.openCases.map((c) => c.problemDescription).join(' '),
      ),
      costDrivers:
        'Cost depends on the violation, whether fines have accrued, and whether the fix needs a permit or engineering. Confirm the current fine balance with the county, it can grow until the case is closed.',
      askSeller:
        'Will the open code case(s) be cleared and closed, and all fines paid, before closing?',
    });
  }

  // 3. Unresolved (open/expired) permits.
  const openPermits = input.permits.filter(isUnresolvedPermit);
  if (openPermits.length > 0) {
    items.push({
      finding: `${openPermits.length} permit${openPermits.length === 1 ? '' : 's'} not finaled`,
      what: 'A permit that was never finaled or inspected leaves work legally incomplete. It commonly surfaces at closing or during a title search and can hold up the sale.',
      path: 'Resolved by completing the remaining inspections and closing the permit, or, if it expired, reactivating or re-permitting the work. Structural scopes may need an engineer to verify what was built.',
      engineeringLikely: openPermits.some((p) =>
        /struct|roof|addition|found|column|beam|slab|wall/i.test(`${p.appType} ${p.scope}`),
      ),
      costDrivers:
        'Cost depends on how much work remains, whether it still meets code, and whether an engineer must verify concealed conditions. Finaling a substantially complete permit is minor; reopening an expired structural permit costs more.',
      askSeller:
        'Will the open or expired permit(s) be finaled and closed before closing?',
    });
  }

  // 4. Roof / insurability.
  if (input.insurance.band === 'aging' || input.insurance.band === 'old' || input.insurance.band === 'unknown') {
    items.push({
      finding:
        input.insurance.band === 'unknown' ? 'Roof age unconfirmed' : 'Aging roof / insurance risk',
      what: 'In Florida the roof decides whether the home can be insured and at what price. An older or unconfirmed roof can mean a required replacement, a non-renewal, or a much higher premium, sometimes the difference in whether the deal pencils.',
      path: 'Confirm the roof age and condition with a roof and wind-mitigation inspection, then either replace it or price the replacement into the deal and the insurance budget.',
      engineeringLikely: false,
      costDrivers:
        'Cost is driven by roof size, material, and the wind-mitigation features that earn premium credits. A full re-roof is a major line item; a newer roof with good wind-mit features lowers both risk and premium.',
      askSeller:
        'What is the roof’s exact age and permit, and will you credit a replacement or provide a bindable insurance quote?',
    });
  }

  // 5. Flood / SFHA.
  if (input.flood.inSFHA) {
    items.push({
      finding: `Flood zone ${input.flood.zone ?? 'SFHA'} (high-risk)`,
      what: 'The parcel is in a FEMA Special Flood Hazard Area, so a federally-backed mortgage will require flood insurance, and the 50% "substantial improvement" rule limits what you can renovate without elevating the home.',
      path: 'Get a bindable flood quote and ask for an elevation certificate (it can sharply lower the premium). For renovations, confirm the 50% threshold with the floodplain administrator first.',
      engineeringLikely: false,
      costDrivers:
        'Flood premium is driven by the elevation of the lowest floor relative to the base flood elevation; an elevation certificate showing the home sits at or above it can cut the cost substantially.',
      askSeller:
        'Do you have an elevation certificate and the current flood-insurance premium you can transfer or share?',
    });
  }

  // 6. Milestone / recertification exposure (condos & larger buildings).
  if (input.recert.applies === 'likely' || input.recert.applies === 'possible') {
    items.push({
      finding: 'Milestone / recertification exposure',
      what: 'Older condos and larger buildings can be forced into a structural milestone inspection and a funded reserve study (SIRS). A pending or overdue one can mean a special assessment landing on you as the new owner.',
      path: 'Confirm the building’s milestone / recertification status and deadline with the county, and get the latest inspection report and reserve study from the association.',
      engineeringLikely: true,
      costDrivers:
        'The inspection itself is modest; the real exposure is the repair scope it can trigger and the reserve funding the association must collect, which can arrive as a special assessment.',
      askSeller:
        'Can you provide the latest milestone / recertification report and reserve study, and confirm no special assessment is pending?',
    });
  }

  if (items.length === 0) return null;

  const sellerQuestions = items.map((it) => it.askSeller);
  const engineeringFlagged = items.some((it) => it.engineeringLikely);

  const contingencyItems: string[] = [
    'Make the offer contingent on a satisfactory 4-point and wind-mitigation inspection and a bindable insurance quote.',
  ];
  if (additionFlag || openPermits.length > 0) {
    contingencyItems.push(
      'Add a permit/records contingency: seller resolves open or unpermitted items, or credits the cost, before closing.',
    );
  }
  if (input.openCases.length > 0) {
    contingencyItems.push('Require all open code cases closed and fines paid at or before closing.');
  }
  if (input.flood.inSFHA) {
    contingencyItems.push('Request the elevation certificate and current flood premium during due diligence.');
  }
  if (engineeringFlagged) {
    contingencyItems.push(
      'Budget for sealed structural engineering to legalize or verify the flagged work; get a scope and fee before removing contingencies.',
    );
  }

  const material = items.length >= 2 || engineeringFlagged || input.openCases.length > 0;
  const exposureSummary = material
    ? `This property has ${items.length} item${items.length === 1 ? '' : 's'} that can affect price, insurability, or closing${
        engineeringFlagged ? ', at least one likely needing sealed engineering' : ''
      }. Treat them as negotiation leverage and price the resolution into your offer.`
    : `This property has ${items.length} item to confirm. It looks relatively clean on the records, but still verify insurance and the item above before removing contingencies.`;

  return { items, sellerQuestions, contingencyItems, exposureSummary, engineeringFlagged };
}
