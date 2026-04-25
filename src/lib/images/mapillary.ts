// Mapillary historical Street View fetcher.
//
// Mapillary (Meta-owned) is a free, documented street-level imagery service.
// Each image is tagged with capture date + compass angle (heading the camera
// was facing), so we can find historical panos that pointed AT a given
// parcel and pair the earliest with the latest for a Then-vs-Now comparison.
//
// Coverage caveats for Florida residential properties:
//   - Main roads + commercial corridors are well covered, often with multiple
//     captures spanning 5+ years.
//   - Quiet residential streets are uneven. Some neighborhoods have no
//     Mapillary coverage at all; others have a single 2018ish drive-through
//     and nothing since.
//   - When coverage is too sparse (only one capture, or no capture facing
//     the parcel), we return null and the orchestrator falls back to
//     current-only Google Street View. This is the honest behavior — we
//     don't fabricate a historical comparison from one frame.
//
// Auth: Mapillary requires an OAuth client token in the
//   `Authorization: OAuth MLY|app_id|secret` header. Sign up at
//   mapillary.com/dashboard/developers, set MAPILLARY_TOKEN on Vercel.
// Without a token, this module returns null and the report degrades
// gracefully.
//
// Graph API:
//   https://graph.mapillary.com/images
//   ?fields=id,captured_at,thumb_2048_url,compass_angle,computed_geometry
//   &bbox=west,south,east,north
//   &limit=N

const MAPILLARY_GRAPH = 'https://graph.mapillary.com/images';

export interface MapillaryImage {
  id: string;
  capturedAt: string;       // ISO date
  capturedYear: number;
  imageUrl: string;         // direct thumbnail URL (already signed by Mapillary)
  compassAngle: number;     // 0-359, direction camera was facing
  imageLat: number;
  imageLng: number;
  bearingToSubject: number; // 0-359, bearing from camera point toward parcel
  alignmentDeg: number;     // 0-180, how off-axis camera was from facing parcel (0 = perfect)
}

// A single street's worth of Mapillary coverage: earliest + latest pano
// captured FROM approximately the same camera location (e.g. "the front
// street view"). For a corner lot we typically get 2 of these — one per
// fronting street.
export interface MapillarySidePair {
  sideLabel: string;                  // "Primary front", "Side 2", etc.
  approxBearingFromCenter: number;    // average bearing the panos approached the parcel from
  then: MapillaryImage | null;
  now: MapillaryImage | null;
}

export interface MapillaryHistoricalResult {
  then: MapillaryImage | null;        // earliest across ALL sides — back-compat
  now: MapillaryImage | null;         // latest across ALL sides — back-compat
  sides: MapillarySidePair[];         // grouped by camera-location cluster (one per street)
  allFrames: MapillaryImage[];        // every qualifying frame, oldest → newest
  source: string;
  failureReason: string | null;
}

// Great-circle bearing from A to B, degrees clockwise from north.
function bearingDeg(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const φ1 = toRad(fromLat);
  const φ2 = toRad(toLat);
  const Δλ = toRad(toLng - fromLng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Smallest absolute angular difference between two compass headings (0-180).
function angularDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// Build a bbox that's roughly `meters` to each side of the parcel center.
function bboxAround(lat: number, lng: number, meters: number): {
  west: number;
  south: number;
  east: number;
  north: number;
} {
  const dLat = meters / 111_320;
  const dLng = meters / (111_320 * Math.cos((lat * Math.PI) / 180));
  return {
    west: lng - dLng,
    south: lat - dLat,
    east: lng + dLng,
    north: lat + dLat,
  };
}

interface MapillaryRawImage {
  id: string;
  captured_at: number;
  thumb_2048_url?: string;
  compass_angle?: number;
  computed_geometry?: { type: string; coordinates: [number, number] }; // [lng, lat]
}

async function searchImages(
  parcelLat: number,
  parcelLng: number,
  token: string,
  searchRadiusMeters: number,
  timeoutMs = 8000,
): Promise<MapillaryRawImage[]> {
  const bbox = bboxAround(parcelLat, parcelLng, searchRadiusMeters);
  const u = new URL(MAPILLARY_GRAPH);
  u.searchParams.set(
    'fields',
    'id,captured_at,thumb_2048_url,compass_angle,computed_geometry',
  );
  u.searchParams.set('bbox', `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`);
  u.searchParams.set('limit', '200');

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(u.toString(), {
      headers: { Authorization: `OAuth ${token}` },
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[mapillary] HTTP ${res.status}: ${body.slice(0, 200)}`);
      return [];
    }
    const data: any = await res.json();
    return Array.isArray(data?.data) ? data.data : [];
  } catch (err: any) {
    console.error(`[mapillary] threw: ${String(err?.message ?? err).slice(0, 200)}`);
    return [];
  } finally {
    clearTimeout(t);
  }
}

export async function fetchMapillaryHistorical(
  parcelLat: number,
  parcelLng: number,
): Promise<MapillaryHistoricalResult> {
  const source = 'Mapillary (Meta) Graph API';
  const token = process.env.MAPILLARY_TOKEN;
  if (!token) {
    return {
      then: null,
      now: null,
      sides: [],
      allFrames: [],
      source,
      failureReason: 'MAPILLARY_TOKEN not set on server — historical Street View skipped.',
    };
  }

  // 50m radius around the parcel center. That captures all images on the
  // street directly fronting the parcel and one neighbor's frontage on each
  // side, without pulling in a whole block of unrelated panos.
  const raw = await searchImages(parcelLat, parcelLng, token, 50);
  if (raw.length === 0) {
    return {
      then: null,
      now: null,
      sides: [],
      allFrames: [],
      source,
      failureReason: 'No Mapillary panos within 50m of this parcel.',
    };
  }

  // Score every image by how well-aligned it was with facing the parcel.
  // Keep only those within 45° of facing the parcel, so we don't include
  // drive-bys where the camera was facing down the street.
  const scored: MapillaryImage[] = raw
    .map((r): MapillaryImage | null => {
      const coords = r.computed_geometry?.coordinates;
      if (!coords || coords.length !== 2) return null;
      const [imgLng, imgLat] = coords;
      if (typeof r.compass_angle !== 'number') return null;
      if (typeof r.captured_at !== 'number') return null;
      if (!r.thumb_2048_url) return null;
      const bearing = bearingDeg(imgLat, imgLng, parcelLat, parcelLng);
      const alignment = angularDelta(bearing, r.compass_angle);
      const captured = new Date(r.captured_at);
      return {
        id: r.id,
        capturedAt: captured.toISOString(),
        capturedYear: captured.getUTCFullYear(),
        imageUrl: r.thumb_2048_url,
        compassAngle: r.compass_angle,
        imageLat: imgLat,
        imageLng: imgLng,
        bearingToSubject: bearing,
        alignmentDeg: alignment,
      };
    })
    .filter((x): x is MapillaryImage => x !== null && x.alignmentDeg <= 45)
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));

  if (scored.length === 0) {
    return {
      then: null,
      now: null,
      sides: [],
      allFrames: [],
      source,
      failureReason:
        'Mapillary has panos near this parcel but none facing the property within 45°.',
    };
  }

  // Group by approximate camera bearing-toward-parcel. Two panos coming
  // from the same direction (within ~50°) are most likely the same street;
  // panos coming from very different directions (e.g. north vs east) are
  // different streets — i.e. a corner lot's two frontages.
  const SIDE_BEARING_TOLERANCE = 50;
  type SideBucket = { centerBearing: number; frames: MapillaryImage[] };
  const sides: SideBucket[] = [];
  for (const f of scored) {
    const existing = sides.find((s) => angularDelta(s.centerBearing, f.bearingToSubject) <= SIDE_BEARING_TOLERANCE);
    if (existing) {
      existing.frames.push(f);
      // Roll the center bearing toward the new frame so the bucket tracks
      // the average direction.
      existing.centerBearing = (existing.centerBearing + f.bearingToSubject) / 2;
    } else {
      sides.push({ centerBearing: f.bearingToSubject, frames: [f] });
    }
  }

  // Build a Then/Now pair per side. Sort sides by frame count (most-covered
  // street first → primary), then label them.
  sides.sort((a, b) => b.frames.length - a.frames.length);

  const sidePairs: MapillarySidePair[] = sides.map((s, i) => {
    s.frames.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
    const earliest = s.frames[0];
    const latest = s.frames[s.frames.length - 1];
    const sameId = earliest.id === latest.id;
    const yearsApart = latest.capturedYear - earliest.capturedYear;
    const then = sameId || yearsApart < 2 ? null : earliest;
    return {
      sideLabel: i === 0 ? 'Primary front' : `Side ${i + 1}`,
      approxBearingFromCenter: s.centerBearing,
      then,
      now: latest,
    };
  });

  // Back-compat fields: pick the side with the best then/now pair (longest
  // span between THEN and NOW), or just the most-covered side if none has
  // a real THEN.
  const sidesWithThen = sidePairs.filter((s) => s.then);
  let primary: MapillarySidePair | null;
  if (sidesWithThen.length > 0) {
    sidesWithThen.sort((a, b) => {
      const yA = (a.now?.capturedYear ?? 0) - (a.then?.capturedYear ?? 0);
      const yB = (b.now?.capturedYear ?? 0) - (b.then?.capturedYear ?? 0);
      return yB - yA;
    });
    primary = sidesWithThen[0];
  } else {
    primary = sidePairs[0] ?? null;
  }

  if (!primary) {
    return {
      then: null,
      now: null,
      sides: sidePairs,
      allFrames: scored,
      source,
      failureReason: 'No usable Mapillary side after grouping.',
    };
  }

  if (!primary.then) {
    return {
      then: null,
      now: primary.now,
      sides: sidePairs,
      allFrames: scored,
      source,
      failureReason: primary.now
        ? `Only one Mapillary capture at this location (${primary.now.capturedYear}) — no THEN frame to compare.`
        : 'No usable Mapillary frames.',
    };
  }

  return {
    then: primary.then,
    now: primary.now,
    sides: sidePairs,
    allFrames: scored,
    source,
    failureReason: null,
  };
}
