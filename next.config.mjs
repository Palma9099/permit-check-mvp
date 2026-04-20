/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // pdfkit reads AFM font files off disk at runtime. Telling Next.js to treat it
  // as an external keeps the bundler from tree-shaking those font files out of
  // the serverless package.
  experimental: {
    serverComponentsExternalPackages: ['pdfkit'],
  },
  // Allow embedding the Esri satellite image inside the <img> tag.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'services.arcgisonline.com' },
      { protocol: 'https', hostname: 'server.arcgisonline.com' },
    ],
  },
};
export default nextConfig;
