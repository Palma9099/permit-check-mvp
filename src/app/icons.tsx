// Line icons for the landing page. Inline SVG, no dependency, inherits color
// from the tile so they stay sharp at any size and match the brand.

const base = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function KeyIcon() {
  return (
    <svg {...base}>
      <circle cx="7.5" cy="15.5" r="3.5" />
      <path d="M10 13 19.5 3.5M16.5 6.5l3 3M13.5 9.5l2 2" />
    </svg>
  );
}

export function HomeSearchIcon() {
  return (
    <svg {...base}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 21 21" />
      <path d="M7.5 11.2 10.5 8.5l3 2.7M8.7 10.4V13.4h3.6v-3" />
    </svg>
  );
}

export function ClipboardCheckIcon() {
  return (
    <svg {...base}>
      <rect x="5" y="4.5" width="14" height="16.5" rx="2.2" />
      <path d="M9 4.5V3.8A.8.8 0 0 1 9.8 3h4.4a.8.8 0 0 1 .8.8v.7" />
      <path d="m8.8 13.2 2.4 2.4 4.2-4.6" />
    </svg>
  );
}

export function IconTile({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-[#1f3864] text-[#d9b46a] shadow-sm">
      {children}
    </div>
  );
}
