// Shared scraping utilities. County permit portals are overwhelmingly classic
// server-rendered HTML tables (ASP.NET GridView and friends), so a robust
// generic table reader handles most of them without brittle per-cell selectors.

import type { Page } from 'playwright';

export interface TableData {
  headers: string[];
  rows: string[][];
}

/** Read every <table> on the page that has a header row + at least one body row. */
export async function readTables(page: Page): Promise<TableData[]> {
  return page.evaluate(() => {
    const out: { headers: string[]; rows: string[][] }[] = [];
    const tables = Array.from(document.querySelectorAll('table'));
    for (const t of tables) {
      const trs = Array.from(t.querySelectorAll('tr'));
      if (trs.length < 2) continue;
      const headerCells = Array.from(trs[0].querySelectorAll('th,td')).map((c) =>
        (c.textContent || '').replace(/\s+/g, ' ').trim(),
      );
      const rows: string[][] = [];
      for (let i = 1; i < trs.length; i++) {
        const cells = Array.from(trs[i].querySelectorAll('td')).map((c) =>
          (c.textContent || '').replace(/\s+/g, ' ').trim(),
        );
        if (cells.length && cells.some((x) => x)) rows.push(cells);
      }
      if (headerCells.some((h) => h) && rows.length) out.push({ headers: headerCells, rows });
    }
    return out;
  });
}

/** Find the index of the first header that matches any of the given keywords. */
export function colIndex(headers: string[], keywords: string[]): number {
  const lower = headers.map((h) => h.toLowerCase());
  for (let i = 0; i < lower.length; i++) {
    if (keywords.some((k) => lower[i].includes(k))) return i;
  }
  return -1;
}

/** Pick the table whose headers best match the expected keywords. */
export function pickTable(tables: TableData[], keywords: string[]): TableData | null {
  let best: TableData | null = null;
  let bestScore = 0;
  for (const t of tables) {
    const joined = t.headers.join(' ').toLowerCase();
    const score = keywords.reduce((n, k) => (joined.includes(k) ? n + 1 : n), 0);
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return bestScore > 0 ? best : null;
}

/** Try a list of selectors; fill the first one that exists. Returns true if filled. */
export async function fillFirst(page: Page, selectors: string[], value: string): Promise<boolean> {
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    try {
      if (await el.count()) {
        await el.fill(value, { timeout: 5000 });
        return true;
      }
    } catch {
      /* try next */
    }
  }
  return false;
}

/** Try a list of selectors; click the first one that exists. Returns true if clicked. */
export async function clickFirst(page: Page, selectors: string[]): Promise<boolean> {
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    try {
      if (await el.count()) {
        await el.click({ timeout: 5000 });
        return true;
      }
    } catch {
      /* try next */
    }
  }
  return false;
}

export function cell(row: string[], idx: number): string | null {
  if (idx < 0 || idx >= row.length) return null;
  const v = row[idx]?.trim();
  return v ? v : null;
}

// Calibration aid. When CALIBRATE=1, dump what a human needs to fix a selector:
// every fillable input's id/name/placeholder, every table's headers + row count,
// and a full-page screenshot. No-op otherwise; never throws. See the calibration
// runbook (docs/accela-calibration-runbook.md).
export async function debugDump(page: Page, label: string, log: (m: string) => void): Promise<void> {
  if (process.env.CALIBRATE !== '1') return;
  try {
    const inputs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input,select,textarea'))
        .map((el) => ({
          id: (el as HTMLInputElement).id || '',
          name: (el as HTMLInputElement).name || '',
          type: (el as HTMLInputElement).type || el.tagName.toLowerCase(),
          ph: (el as HTMLInputElement).placeholder || '',
        }))
        .filter((x) => x.id || x.name)
        .slice(0, 60),
    );
    log(`[debug ${label}] ${inputs.length} field(s):`);
    for (const f of inputs) log(`   input id="${f.id}" name="${f.name}" type=${f.type}${f.ph ? ` ph="${f.ph}"` : ''}`);

    const tables = await readTables(page);
    log(`[debug ${label}] ${tables.length} table(s):`);
    tables.forEach((t, i) => log(`   [${i}] rows=${t.rows.length} headers: ${t.headers.join(' | ')}`));

    const file = `calib-${label.replace(/[^a-z0-9]+/gi, '_')}-${Date.now()}.png`;
    await page.screenshot({ path: file, fullPage: true }).catch(() => {});
    log(`[debug ${label}] screenshot: ${file}`);
  } catch (e: any) {
    log(`[debug ${label}] dump failed: ${e?.message ?? e}`);
  }
}
