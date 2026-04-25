import type { Metadata } from 'next';
import Script from 'next/script';
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
        {/* Google tag (gtag.js) — GA4 retargeting */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-YBQ1SM3F7M"
          strategy="afterInteractive"
        />
        <Script id="gtag-init" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-YBQ1SM3F7M');
          `}
        </Script>
        {/* Meta Pixel */}
        <Script id="meta-pixel" strategy="afterInteractive">
          {`
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '428330677033994');
            fbq('track', 'PageView');
          `}
        </Script>
        <noscript>
          <img
            height="1"
            width="1"
            style={{ display: 'none' }}
            src="https://www.facebook.com/tr?id=428330677033994&ev=PageView&noscript=1"
            alt=""
          />
        </noscript>
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
