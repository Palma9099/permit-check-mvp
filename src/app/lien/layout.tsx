import type { Metadata } from 'next';

// Finished lien searches are private to the client who ordered them.
export const metadata: Metadata = { title: 'Palma Lien Search', robots: { index: false, follow: false } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
