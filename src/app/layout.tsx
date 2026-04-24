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
      <body className="min-h-screen bg-page text-ink">
        <div className="flex justify-end px-4 sm:px-6 pt-3">
          <a
            href="https://tools.palma.llc"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
              color: '#b68a4b',
              textDecoration: 'none',
              padding: '6px 12px',
              border: '1px solid rgba(182,138,75,0.3)',
              borderRadius: '999px',
            }}
          >
            ← All Palma Tools
          </a>
        </div>
        {children}
      </body>
    </html>
  );
}
