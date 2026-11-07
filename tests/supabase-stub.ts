// A stand-in for the Supabase REST table the record libraries talk to.
//
// These libraries speak to Supabase over plain fetch, so the honest way to
// test them without a database is to answer that fetch. The stub behaves like
// PostgREST in the three ways the code depends on: a filtered select returns an
// array, a PATCH with Prefer: return=representation returns the updated rows,
// and a POST returns the inserted row.
//
// It also RECORDS every call, because half of what matters is not the reply but
// what was sent: a withdrawal must actually set the status and the reason, and
// a test that only checks the HTTP code would pass on a PATCH that wrote
// nothing.

export interface Call {
  url: string;
  method: string;
  body: any;
  headers: Record<string, string>;
}

export interface Stub {
  rows: Map<string, any>;
  calls: Call[];
  /** Force the next request to fail, to prove the caller reports it. */
  failNext: { status: number; text: string } | null;
  restore: () => void;
}

export function installSupabaseStub(seed: any[] = []): Stub {
  const real = globalThis.fetch;
  const stub: Stub = {
    rows: new Map(seed.map((r) => [r.id, { ...r }])),
    calls: [],
    failNext: null,
    restore: () => {
      globalThis.fetch = real;
    },
  };

  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    stub.calls.push({ url, method, body, headers: (init.headers ?? {}) as Record<string, string> });

    if (stub.failNext) {
      const { status, text } = stub.failNext;
      stub.failNext = null;
      return new Response(text, { status });
    }

    // Any id=eq.X filter, which is how both libraries address one record.
    const match = /id=eq\.([^&]+)/.exec(url);
    const id = match ? decodeURIComponent(match[1]) : null;

    if (method === 'GET') {
      const row = id ? stub.rows.get(id) : null;
      // A folio query (status=eq.verified&...) returns whatever is live.
      if (!id && /folio=eq\./.test(url)) {
        const folio = /folio=eq\.([^&]+)/.exec(url)?.[1];
        const live = [...stub.rows.values()].filter(
          (r) => r.folio === folio && r.status === 'verified' && Date.parse(r.expires_at) > Date.now(),
        );
        // tier.desc: 'premium' sorts after 'instant', so premium wins.
        live.sort((a, b) => String(b.tier).localeCompare(String(a.tier)));
        return Response.json(live.slice(0, 1));
      }
      return Response.json(row ? [row] : []);
    }

    if (method === 'PATCH' && id) {
      const row = stub.rows.get(id);
      if (!row) return Response.json([]);
      Object.assign(row, body);
      return Response.json([row]);
    }

    if (method === 'POST') {
      const row = Array.isArray(body) ? body[0] : body;
      stub.rows.set(row.id, { ...row });
      return Response.json([stub.rows.get(row.id)]);
    }

    return new Response('unexpected request', { status: 500 });
  }) as any;

  return stub;
}

// A finished lien search, shaped the way the staff route publishes it.
export function lienRow(over: Partial<any> = {}) {
  return {
    id: 'LS-ABCDEFGHJK',
    folio: '3049260021120',
    address: '123 TEST ST, MIAMI, FL 33133',
    status: 'final',
    searched_at: '2026-11-01T12:00:00.000Z',
    completed_at: '2026-11-01T12:30:00.000Z',
    reviewer: 'A. Palma',
    client: { company: 'Test Title Co', name: 'J. Closer', email: 'closer@test.invalid', closingDate: '2026-11-20' },
    search: { folio: '3049260021120', prettyFolio: '30-4926-002-1120', found: 1, failed: 0, sections: [], staffSteps: [] },
    staff: [{ key: 'taxes', title: 'Property taxes', result: 'clear', amount: null, note: null }],
    notes: null,
    ...over,
  };
}

// A published Verified record.
export function verifiedRow(over: Partial<any> = {}) {
  const year = 1000 * 60 * 60 * 24 * 365;
  return {
    id: 'PV-ABCDEFG',
    folio: '3049260021120',
    address: '123 TEST ST, MIAMI, FL 33133',
    tier: 'premium',
    status: 'verified',
    verified_at: new Date(Date.now() - 1000).toISOString(),
    expires_at: new Date(Date.now() + year).toISOString(),
    reviewer: 'A. Palma',
    checks: [{ key: 'permits', label: 'Permit history', ok: true, note: null }],
    summary: null,
    notes: null,
    hero_image: null,
    ...over,
  };
}
