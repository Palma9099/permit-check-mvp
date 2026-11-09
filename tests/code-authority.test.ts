// Who enforces code here, and did we ask them?
//
// This file exists because of a report we actually sent. 135 W 60 ST, Hialeah
// came back "Code and liens: None open - No open cases or recorded liens", in
// green, for a property with an active violation. Nothing had failed:
// Miami-Dade County's code records were searched and genuinely held nothing.
// But Miami-Dade County is not the code authority inside the City of Hialeah,
// and the report could not tell "the authority said no" from "we never asked
// the authority".
//
// The property appraiser returns Municipality: "HIALEAH" for that parcel
// (strap 04-2131-002-0800), so the information needed to catch this was
// already on hand and simply unused.

import { describe, expect, it } from 'vitest';
import {
  cityLabel,
  cityGoverns,
  codeVerdict,
  verdictValue,
  verdictDetail,
  verdictTone,
  verdictBuyerNote,
  verdictOwnerNote,
  type CodeAuthority,
} from '@/lib/code-authority';

const hialeah: CodeAuthority = {
  municipality: 'HIALEAH',
  cityGoverns: true,
  cityChecked: false,
  countyChecked: true,
};

const unincorporated: CodeAuthority = {
  municipality: null,
  cityGoverns: false,
  cityChecked: false,
  countyChecked: true,
};

describe('reading the municipality', () => {
  it('title-cases a shouting property-appraiser value', () => {
    expect(cityLabel('HIALEAH')).toBe('Hialeah');
    expect(cityLabel('MIAMI BEACH')).toBe('Miami Beach');
  });

  it('keeps City of Miami distinct from Miami-Dade County', () => {
    expect(cityLabel('MIAMI')).toBe('City of Miami');
  });

  it('treats unincorporated and blank as no city', () => {
    expect(cityLabel('UNINCORPORATED')).toBeNull();
    expect(cityLabel('')).toBeNull();
    expect(cityLabel(null)).toBeNull();
    expect(cityGoverns('UNINCORPORATED')).toBe(false);
    expect(cityGoverns(null)).toBe(false);
  });

  it('knows a named city governs', () => {
    expect(cityGoverns('HIALEAH')).toBe(true);
  });
});

describe('the Hialeah report must never read as clear', () => {
  const v = codeVerdict(hialeah, 0, 0);

  it('does not return a clear verdict on zero county hits', () => {
    expect(v.kind).toBe('unchecked');
  });

  it('says "Not checked", not "None open"', () => {
    expect(verdictValue(v)).toBe('Not checked');
    expect(verdictValue(v)).not.toMatch(/none/i);
  });

  it('is never green', () => {
    expect(verdictTone(v)).toBe('amber');
    expect(verdictTone(v)).not.toBe('green');
  });

  it('names the authority and says what we did search', () => {
    const d = verdictDetail(v, true);
    expect(d).toMatch(/Hialeah/);
    expect(d).toMatch(/not searched/i);
    expect(d).toMatch(/county/i);
  });

  it('tells a buyer plainly that nobody looked', () => {
    const b = verdictBuyerNote(v);
    expect(b).toMatch(/NOT a clean result/);
    expect(b).toMatch(/nobody has looked/i);
    expect(b).toMatch(/Hialeah/);
    // The exact sentence the old report printed must not survive anywhere.
    expect(b).not.toMatch(/No open violations means/);
  });

  it('tells an owner it is unknown rather than clear', () => {
    expect(verdictOwnerNote(v)).toMatch(/unknown rather than clear/i);
  });
});

describe('a verdict is only clear when the deciding authority was asked', () => {
  it('is clear for unincorporated land the county searched', () => {
    const v = codeVerdict(unincorporated, 0, 0);
    expect(v.kind).toBe('clear');
    expect(verdictTone(v)).toBe('green');
    expect(verdictValue(v)).toBe('None open');
  });

  it('is clear for a city whose own records we did search', () => {
    const v = codeVerdict({ ...hialeah, cityChecked: true }, 0, 0);
    expect(v.kind).toBe('clear');
    expect(verdictTone(v)).toBe('green');
  });

  it('is not clear when nothing at all was searched', () => {
    const v = codeVerdict(
      { municipality: null, cityGoverns: false, cityChecked: false, countyChecked: false },
      0,
      0,
    );
    expect(v.kind).toBe('unchecked');
    expect(verdictTone(v)).toBe('amber');
  });

  it('reports hits as red regardless of who was asked', () => {
    const v = codeVerdict(hialeah, 2, 0);
    expect(v.kind).toBe('hits');
    expect(verdictTone(v)).toBe('red');
    expect(verdictValue(v)).toBe('2 open');
  });

  it('leads with liens when there are any, because they block a closing', () => {
    expect(verdictValue(codeVerdict(unincorporated, 1, 3))).toBe('3 liens or fines');
  });
});

describe('wording details that matter in print', () => {
  it('does not promise a lien check that did not run', () => {
    expect(verdictDetail(codeVerdict(unincorporated, 0, 0), false)).toMatch(/Liens not checked/i);
    expect(verdictDetail(codeVerdict(unincorporated, 0, 0), true)).toMatch(/No open cases or recorded liens/i);
  });

  it('omits the "we searched X" clause when nothing was searched', () => {
    const v = codeVerdict({ ...hialeah, countyChecked: false }, 0, 0);
    expect(verdictDetail(v, true)).not.toMatch(/We searched/);
  });
});
