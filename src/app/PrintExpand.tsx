'use client';

import { useEffect } from 'react';

// Open every <details> while the page is printing, then put them back.
//
// The report keeps its evidence - property record, score breakdown,
// before/after aerials, Street View history, flags, flood, insurance - inside a
// "Full details" accordion. A closed <details> prints closed, so a buyer who
// hit Cmd+P got four pages of summary tiles and none of the evidence behind
// them. That is worse than a short report: it looks complete.
//
// CSS in globals.css covers the same ground for a saved page, but Chrome and
// Safari both honour the [open] attribute more reliably than a display
// override on the shadow content, so set it properly and restore afterwards.
export default function PrintExpand() {
  useEffect(() => {
    // Remember only the ones WE opened, so a section the reader had already
    // expanded stays expanded after printing.
    let opened: HTMLDetailsElement[] = [];

    const expand = () => {
      opened = Array.from(document.querySelectorAll('details')).filter((d) => !d.open);
      for (const d of opened) d.open = true;
    };
    const restore = () => {
      for (const d of opened) d.open = false;
      opened = [];
    };

    window.addEventListener('beforeprint', expand);
    window.addEventListener('afterprint', restore);

    // Safari and older Chrome fire the media query rather than the events.
    const mql = window.matchMedia('print');
    const onChange = (e: MediaQueryListEvent) => (e.matches ? expand() : restore());
    mql.addEventListener?.('change', onChange);

    return () => {
      window.removeEventListener('beforeprint', expand);
      window.removeEventListener('afterprint', restore);
      mql.removeEventListener?.('change', onChange);
    };
  }, []);

  return null;
}
