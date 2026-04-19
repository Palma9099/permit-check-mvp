import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Permit History & Unpermitted Improvement Check',
  description:
    'Records-level diagnostic for Florida property permit history. Plain-English report for realtors, investors, and owners.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-page text-ink">{children}</body>
    </html>
  );
}
