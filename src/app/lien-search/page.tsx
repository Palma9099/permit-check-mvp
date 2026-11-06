import type { Metadata } from 'next';
import LienSearchClient from './LienSearchClient';

export const metadata: Metadata = {
  title: 'Palma Lien Search: Miami-Dade municipal lien search',
  description: 'Recorded code liens, unpaid fines, open cases and open permits for any Miami-Dade folio in seconds. Full search with taxes and Official Records the same business day.',
};

export default function LienSearchPage() {
  return <LienSearchClient />;
}
