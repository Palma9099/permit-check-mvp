// Telling "there is no such record" apart from "we could not find out".
//
// Both of those used to come back as null. So a wrong key, a dropped
// connection or a table that was never created reached the reader as "No lien
// search found" - the exact wording that reads as a broken link and sends a
// title company back to the PDF they are already holding. The whole
// withdrawn-versus-404 design exists to stop that, and an outage walked
// straight through it.
//
//   ok: true   we reached the database. `record` is the row, or null when
//              there genuinely is none, which includes an id that could not
//              exist in the first place.
//   ok: false  we could not tell. Never render this as "not found", never
//              cache it, and never let it answer a staff question about
//              whether a record exists.
export type Lookup<T> = { ok: true; record: T | null } | { ok: false; detail: string };

export const found = <T,>(record: T): Lookup<T> => ({ ok: true, record });
export const absent = <T,>(): Lookup<T> => ({ ok: true, record: null });
export const failed = <T,>(detail: string): Lookup<T> => ({ ok: false, detail });

// One PostgREST select, read as a Lookup. An empty array is the only answer
// that means "no such row": every transport error and every non-2xx status is
// a failure, because none of them tell us anything about the record.
export async function selectOne<T>(url: string, init: RequestInit): Promise<Lookup<T>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e: any) {
    return failed(`could not reach the database: ${String(e?.message ?? e).slice(0, 160)}`);
  }
  if (!res.ok) {
    return failed(`the database answered ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`);
  }
  let rows: unknown;
  try {
    rows = await res.json();
  } catch {
    return failed('the database answered with something that is not JSON');
  }
  if (!Array.isArray(rows)) return failed('the database answered with an unexpected shape');
  return rows[0] ? found(rows[0] as T) : absent<T>();
}
