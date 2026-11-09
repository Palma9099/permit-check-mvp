import type { Metadata } from 'next';
import LienSearchClient from './LienSearchClient';
import { liveCoverage } from '@/lib/lien-search';

export const metadata: Metadata = {
  title: 'Palma Lien Search: Florida municipal lien search',
  description:
    'Recorded code liens, unpaid fines, open cases and open permits for any Florida address. Pulled live where the county or city publishes them; taxes and Official Records the same business day.',
};

export default function LienSearchPage() {
  return <LienSearchClient coverage={liveCoverage()} />;
}
