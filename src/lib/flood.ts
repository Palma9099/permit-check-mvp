// Flood risk from FEMA's National Flood Hazard Layer (NFHL).
//
// Free public ArcGIS service, nationwide, so this works in every county, not just
// the ones we scrape. We report the effective FEMA flood zone, whether the parcel
// sits in a Special Flood Hazard Area (SFHA), the static base flood elevation when
// mapped, and the two things a Florida buyer needs to hear: flood-insurance
// exposure and the 50% "substantial improvement" rule.
//
// HONESTY: the FEMA zone is the mapped effective zone, but a parcel's exact rating
// can differ (Letter of Map Amendment, partial-in-zone lots, map revisions). We
// present it as the FEMA map's read, to be confirmed on the FEMA Map Service Center
// and with the community floodplain administrator. No premium is quoted.

export interface FloodRisk {
  zone: string | null;              // FEMA effective zone, e.g. "AE", "AH", "VE", "X"
  zoneSubtype: string | null;
  inSFHA: boolean | null;           // Special Flood Hazard Area (1% annual chance)
  baseFloodElevationFt: number | null;
  summary: string;                  // plain-English zone read
  insuranceNote: string;            // flood-insurance exposure
  fiftyPercentNote: string | null;  // substantial-improvement (50%) caveat when in SFHA
  source: string;
  failureReason: string | null;
}

const NFHL_ZONES_LAYER =
  'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query';

// High-risk SFHA zone prefixes (1%-annual-chance). V/VE are coastal high-hazard.
function classifyZone(zone: string | null): { high: boolean; coastal: boolean } {
  const z = (zone ?? '').toUpperCase();
  const coastal = z.startsWith('V');
  const high =
    coastal ||
    z.startsWith('A'); // A, AE, AH, AO, A1-A30, AR, A99 — all SFHA. ("AREA NOT INCLUDED"/"D" won't match well; handled below.)
  const undetermined = z === 'D' || z.includes('NOT INCLUDED') || z === '';
  return { high: high && !undetermined, coastal };
}

function zoneEnglish(zone: string | null, coastal: boolean, high: boolean): string {
  const z = (zone ?? '').toUpperCase();
  if (!z) return 'No FEMA flood zone polygon was returned for this point.';
  if (z === 'D') return 'FEMA Zone D: flood hazard is undetermined here (unstudied area).';
  if (z.startsWith('X'))
    return z.includes('0.2') || z.includes('SHADED')
      ? 'FEMA Zone X (shaded): moderate risk, within the 0.2% (500-year) floodplain.'
      : 'FEMA Zone X: minimal flood hazard, outside the mapped 1% and 0.2% floodplains.';
  if (coastal)
    return `FEMA Zone ${z}: coastal high-hazard area, subject to wave action during a base flood, the most severe flood zone.`;
  if (high) return `FEMA Zone ${z}: a Special Flood Hazard Area with a 1%-annual-chance (100-year) flood risk.`;
  return `FEMA Zone ${z}.`;
}

export async function assessFlood(
  lat: number,
  lng: number,
  opts?: { hasUnpermittedAdditions?: boolean },
): Promise<FloodRisk> {
  const fail = (reason: string): FloodRisk => ({
    zone: null,
    zoneSubtype: null,
    inSFHA: null,
    baseFloodElevationFt: null,
    summary:
      'We could not retrieve the FEMA flood zone automatically. Check it on the FEMA Map Service Center (msc.fema.gov) before you rely on it.',
    insuranceNote:
      'Flood risk and flood-insurance requirements are set by the FEMA map for the parcel; verify the zone before closing.',
    fiftyPercentNote: null,
    source: 'FEMA National Flood Hazard Layer',
    failureReason: reason,
  });

  const url =
    `${NFHL_ZONES_LAYER}?geometry=${lng}%2C${lat}` +
    '&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects' +
    '&outFields=FLD_ZONE%2CZONE_SUBTY%2CSFHA_TF%2CSTATIC_BFE&returnGeometry=false&f=json';

  let data: any;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return fail(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err: any) {
    return fail(String(err?.message ?? err).slice(0, 120));
  }
  if (data?.error) return fail(`NFHL error: ${data.error?.message ?? 'unknown'}`);

  const feat = Array.isArray(data?.features) ? data.features[0] : null;
  const attrs = feat?.attributes ?? null;

  if (!attrs) {
    // No mapped polygon at the point — usually means minimal-hazard / unmapped.
    return {
      zone: null,
      zoneSubtype: null,
      inSFHA: false,
      baseFloodElevationFt: null,
      summary:
        'No FEMA flood-hazard polygon covers this point, which usually means minimal mapped flood risk. Confirm on the FEMA Map Service Center.',
      insuranceNote:
        'Flood insurance is likely not federally required here, but about a quarter of flood claims come from outside high-risk zones, so a low-cost preferred-risk policy is still worth pricing.',
      fiftyPercentNote: null,
      source: 'FEMA National Flood Hazard Layer',
      failureReason: null,
    };
  }

  const zone: string | null = attrs.FLD_ZONE ?? null;
  const zoneSubtype: string | null = attrs.ZONE_SUBTY ?? null;
  const sfhaFlag = String(attrs.SFHA_TF ?? '').toUpperCase();
  const bfeRaw = typeof attrs.STATIC_BFE === 'number' ? attrs.STATIC_BFE : null;
  const baseFloodElevationFt = bfeRaw != null && bfeRaw > -1000 && bfeRaw !== 0 ? bfeRaw : null;

  const { high, coastal } = classifyZone(zone);
  const inSFHA = sfhaFlag === 'T' ? true : sfhaFlag === 'F' ? false : high;

  let summary = zoneEnglish(zone, coastal, high);
  if (zoneSubtype) summary += ` (${zoneSubtype}).`;
  if (baseFloodElevationFt != null) summary += ` Mapped base flood elevation is about ${baseFloodElevationFt} ft.`;

  const insuranceNote = inSFHA
    ? 'A federally-backed mortgage will require flood insurance in this zone. Budget for it, and ask the seller for the current premium and any elevation certificate, which can lower it.'
    : 'Flood insurance is likely not federally required here, but roughly a quarter of flood claims come from outside high-risk zones, so a low-cost preferred-risk policy is worth pricing.';

  const fiftyPercentNote = inSFHA
    ? `Because this parcel is in a Special Flood Hazard Area, the 50% "substantial improvement" rule applies: once the cost of repairs or improvements reaches 50% of the structure's value, the whole building generally has to be brought into flood compliance, which can mean elevating it.${
        opts?.hasUnpermittedAdditions
          ? ' Resolving unpermitted additions here can count toward that threshold, so confirm the path with the floodplain administrator before starting.'
          : ''
      }`
    : null;

  return {
    zone,
    zoneSubtype,
    inSFHA,
    baseFloodElevationFt,
    summary,
    insuranceNote,
    fiftyPercentNote,
    source: 'FEMA National Flood Hazard Layer',
    failureReason: null,
  };
}
