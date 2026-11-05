// Palma Verified settings shared by the server and the staff page (no Node
// imports here, so the browser can load it).

// Two tiers. "Checked" is automated from the report, with no person signing
// off, so it never carries the Verified name or seal.
export type Tier = 'instant' | 'premium';
export const TIERS: Record<Tier, { name: string; seal: string; price: string; blurb: string }> = {
  instant: {
    name: 'Palma Checked',
    seal: 'CHECKED',
    price: '$5.99',
    blurb: 'Instant, dated summary of what the public records show.',
  },
  premium: {
    name: 'Palma Verified',
    seal: 'VERIFIED',
    price: '$599',
    blurb: 'A Palma reviewer pulls the full permit history and confirms every item.',
  },
};
export const VERIFIED_PRICE = TIERS.premium.price;
export const VERIFIED_MONTHS = 6;

// The checks a reviewer must confirm before publishing.
export const VERIFIED_CHECKS: Array<{ key: string; label: string; help: string }> = [
  { key: 'history', label: 'Full permit history pulled and matched', help: 'Certified or portal history, including permits before 2020.' },
  { key: 'open', label: 'No open or expired permits', help: 'Every open or expired permit is closed out, or none exist.' },
  { key: 'changes', label: 'Every visible change is permitted or disclosed', help: 'Each finding from the photos has a permit, or is listed in the note.' },
  { key: 'code', label: 'No open code cases or liens', help: 'County code cases and lien search are clear.' },
  { key: 'roof', label: 'Roof age confirmed', help: 'From the roof permit, a roof inspection or the photos.' },
  { key: 'flood', label: 'Flood zone confirmed', help: 'FEMA flood map checked for this lot.' },
];
