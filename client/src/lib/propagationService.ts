/**
 * Propagation Data Service
 * Design: "Ether" dark atmospheric — data overlays use warm-to-cool color gradients
 * Fetches real-time ionospheric data from KC2G, NOAA SWPC, and HamQSL
 */

export interface IonosondeStation {
  id: number;
  name: string;
  code: string;
  lat: number;
  lon: number;
  time: string;
  mufd: number | null;    // MUF(3000km) in MHz
  fof2: number | null;    // Critical frequency foF2 in MHz
  hmf2: number | null;    // Height of F2 layer in km
  tec: number | null;     // Total Electron Content
  foe: number | null;     // E-layer critical frequency
  md: number | null;      // M(D) factor
  confidence: number;
  ageMinutes: number;     // How old is this reading
}

export interface SolarConditions {
  solarFlux: number;
  aIndex: number;
  kIndex: number;
  sunspots: number;
  xray: string;
  solarWind: number;
  magneticField: number;
  geomagField: string;
  signalNoise: string;
  updated: string;
  bandConditions: BandCondition[];
  vhfConditions: VhfCondition[];
}

export interface BandCondition {
  band: string;
  day: string;
  night: string;
}

export interface VhfCondition {
  name: string;
  location: string;
  status: string;
}

export interface PropagationData {
  ionosondes: IonosondeStation[];
  solar: SolarConditions | null;
  lastFetch: number;
  error: string | null;
}

// Color scale for MUF values (MHz) — warm = high MUF = better propagation
export const MUF_COLOR_SCALE: { value: number; color: string; label: string }[] = [
  { value: 5,  color: '#3b82f6', label: '≤5 MHz' },    // blue — very low
  { value: 10, color: '#06b6d4', label: '10 MHz' },     // cyan
  { value: 15, color: '#10b981', label: '15 MHz' },     // green
  { value: 20, color: '#84cc16', label: '20 MHz' },     // lime
  { value: 25, color: '#eab308', label: '25 MHz' },     // yellow
  { value: 30, color: '#f97316', label: '30 MHz' },     // orange
  { value: 35, color: '#ef4444', label: '35 MHz' },     // red
  { value: 40, color: '#ec4899', label: '≥40 MHz' },    // pink — excellent
];

// Color scale for foF2 values (MHz)
export const FOF2_COLOR_SCALE: { value: number; color: string; label: string }[] = [
  { value: 2,  color: '#3b82f6', label: '≤2 MHz' },
  { value: 4,  color: '#06b6d4', label: '4 MHz' },
  { value: 6,  color: '#10b981', label: '6 MHz' },
  { value: 8,  color: '#84cc16', label: '8 MHz' },
  { value: 10, color: '#eab308', label: '10 MHz' },
  { value: 12, color: '#f97316', label: '12 MHz' },
  { value: 14, color: '#ef4444', label: '≥14 MHz' },
];

export function getMufColor(muf: number): string {
  for (let i = MUF_COLOR_SCALE.length - 1; i >= 0; i--) {
    if (muf >= MUF_COLOR_SCALE[i].value) return MUF_COLOR_SCALE[i].color;
  }
  return MUF_COLOR_SCALE[0].color;
}

export function getFof2Color(fof2: number): string {
  for (let i = FOF2_COLOR_SCALE.length - 1; i >= 0; i--) {
    if (fof2 >= FOF2_COLOR_SCALE[i].value) return FOF2_COLOR_SCALE[i].color;
  }
  return FOF2_COLOR_SCALE[0].color;
}

export function getBandConditionColor(condition: string): string {
  switch (condition.toLowerCase()) {
    case 'good': return '#10b981';
    case 'fair': return '#eab308';
    case 'poor': return '#ef4444';
    default: return '#6b7280';
  }
}

// Parse KC2G ionosonde data
function parseIonosondes(data: any[]): IonosondeStation[] {
  const now = Date.now();
  return data
    .filter((d: any) => d.station && d.mufd != null)
    .map((d: any) => {
      let lon = parseFloat(d.station.longitude);
      // KC2G uses 0-360 longitude, convert to -180 to 180
      if (lon > 180) lon -= 360;
      const time = d.time || '';
      const ageMs = time ? now - new Date(time + 'Z').getTime() : Infinity;
      return {
        id: d.station.id,
        name: d.station.name,
        code: d.station.code || '',
        lat: parseFloat(d.station.latitude),
        lon,
        time,
        mufd: d.mufd != null ? parseFloat(d.mufd) : null,
        fof2: d.fof2 != null ? parseFloat(d.fof2) : null,
        hmf2: d.hmf2 != null ? parseFloat(d.hmf2) : null,
        tec: d.tec != null ? parseFloat(d.tec) : null,
        foe: d.foe != null ? parseFloat(d.foe) : null,
        md: d.md != null ? parseFloat(d.md) : null,
        confidence: d.cs != null ? parseFloat(d.cs) : 0,
        ageMinutes: Math.round(ageMs / 60000),
      };
    })
    .filter((s: IonosondeStation) => s.ageMinutes < 1440); // Only show data < 24h old
}

// Parse HamQSL solar XML
function parseSolarXml(xml: string): SolarConditions | null {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    const get = (tag: string) => doc.querySelector(tag)?.textContent?.trim() || '';

    const bandConditions: BandCondition[] = [];
    const bands = doc.querySelectorAll('calculatedconditions band');
    const bandMap: Record<string, BandCondition> = {};
    bands.forEach((b) => {
      const name = b.getAttribute('name') || '';
      const time = b.getAttribute('time') || '';
      const status = b.textContent?.trim() || '';
      if (!bandMap[name]) {
        bandMap[name] = { band: name, day: '', night: '' };
      }
      if (time === 'day') bandMap[name].day = status;
      if (time === 'night') bandMap[name].night = status;
    });
    Object.values(bandMap).forEach((b) => bandConditions.push(b));

    const vhfConditions: VhfCondition[] = [];
    const vhfs = doc.querySelectorAll('calculatedvhfconditions phenomenon');
    vhfs.forEach((v) => {
      vhfConditions.push({
        name: v.getAttribute('name') || '',
        location: (v.getAttribute('location') || '').replace(/_/g, ' '),
        status: v.textContent?.trim() || '',
      });
    });

    return {
      solarFlux: parseFloat(get('solarflux')) || 0,
      aIndex: parseFloat(get('aindex')) || 0,
      kIndex: parseFloat(get('kindex')) || 0,
      sunspots: parseFloat(get('sunspots')) || 0,
      xray: get('xray'),
      solarWind: parseFloat(get('solarwind')) || 0,
      magneticField: parseFloat(get('magneticfield')) || 0,
      geomagField: get('geomagfield'),
      signalNoise: get('signalnoise'),
      updated: get('updated'),
      bandConditions,
      vhfConditions,
    };
  } catch {
    return null;
  }
}

let cachedData: PropagationData | null = null;
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

// CORS proxy URLs to try (in order)
const CORS_PROXIES = [
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];

async function fetchWithCorsRetry(url: string, timeout = 10000): Promise<Response> {
  // Try direct fetch first
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    if (resp.ok) return resp;
  } catch {
    // CORS or network error, try proxies
  }

  // Try each CORS proxy
  for (const proxy of CORS_PROXIES) {
    try {
      const proxyUrl = proxy(url);
      const resp = await fetch(proxyUrl, { signal: AbortSignal.timeout(timeout) });
      if (resp.ok) return resp;
    } catch {
      continue;
    }
  }

  throw new Error(`All fetch attempts failed for ${url}`);
}

export async function fetchPropagationData(forceRefresh = false): Promise<PropagationData> {
  if (cachedData && !forceRefresh && Date.now() - cachedData.lastFetch < CACHE_DURATION) {
    return cachedData;
  }

  const result: PropagationData = {
    ionosondes: [],
    solar: null,
    lastFetch: Date.now(),
    error: null,
  };

  // Fetch KC2G ionosonde data
  try {
    const resp = await fetchWithCorsRetry('https://prop.kc2g.com/api/stations.json');
    const data = await resp.json();
    result.ionosondes = parseIonosondes(data);
  } catch (e: any) {
    // Fall back to local static copy
    try {
      const fallback = await fetch('https://files.manuscdn.com/user_upload_by_module/session_file/310519663252172531/IRTBcgaSjgvuVyZk.json');
      if (fallback.ok) {
        const data = await fallback.json();
        result.ionosondes = parseIonosondes(data);
        result.error = 'Using cached ionosonde data (live fetch failed)';
      }
    } catch {
      result.error = `Ionosonde fetch failed: ${e.message}`;
    }
  }

  // Fetch HamQSL solar data
  try {
    const resp = await fetchWithCorsRetry('https://www.hamqsl.com/solarxml.php');
    const xml = await resp.text();
    result.solar = parseSolarXml(xml);
  } catch {
    // Fall back to local static copy
    try {
      const fallback = await fetch('https://files.manuscdn.com/user_upload_by_module/session_file/310519663252172531/EupYDUmYJQTVsvJq.xml');
      if (fallback.ok) {
        const xml = await fallback.text();
        result.solar = parseSolarXml(xml);
      }
    } catch {
      // Solar data is supplementary, don't fail on error
    }
  }

  cachedData = result;
  return result;
}

// Get propagation assessment for a given frequency
export function getPropagationAssessment(
  muf: number,
  frequencyMhz: number
): { status: string; color: string; description: string } {
  const ratio = frequencyMhz / muf;
  if (ratio > 1.0) {
    return {
      status: 'Closed',
      color: '#ef4444',
      description: `Frequency ${frequencyMhz} MHz exceeds MUF ${muf.toFixed(1)} MHz — signals will pass through ionosphere`,
    };
  }
  if (ratio > 0.85) {
    return {
      status: 'Marginal',
      color: '#eab308',
      description: `Frequency ${frequencyMhz} MHz is near MUF ${muf.toFixed(1)} MHz — weak/fading signals likely`,
    };
  }
  if (ratio > 0.5) {
    return {
      status: 'Open',
      color: '#10b981',
      description: `Frequency ${frequencyMhz} MHz is well below MUF ${muf.toFixed(1)} MHz — good propagation expected`,
    };
  }
  return {
    status: 'Strong',
    color: '#06b6d4',
    description: `Frequency ${frequencyMhz} MHz is far below MUF ${muf.toFixed(1)} MHz — strong signals, possible absorption`,
  };
}
