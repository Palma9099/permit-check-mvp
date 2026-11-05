// Palma Verified settings shared by the server and the staff page (no Node
// imports here, so the browser can load it).

// What a Verified record costs the seller, and how long it stays valid.
export const VERIFIED_PRICE = '$5.99';
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
