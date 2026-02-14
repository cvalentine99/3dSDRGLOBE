export interface Receiver {
  label: string;
  version?: string;
  url: string;
  type: "OpenWebRX" | "WebSDR" | "KiwiSDR";
}

export interface Station {
  label: string;
  location: {
    coordinates: [number, number]; // [longitude, latitude]
    type: "Point";
  };
  receivers: Receiver[];
}

export type ReceiverType = "OpenWebRX" | "WebSDR" | "KiwiSDR" | "all";

export type BandType =
  | "all"
  | "HF"
  | "VHF"
  | "UHF"
  | "LF/MF"
  | "Airband"
  | "CB";

export type ContinentType =
  | "all"
  | "Europe"
  | "North America"
  | "South America"
  | "Asia"
  | "Africa"
  | "Oceania";

export type RegionType =
  | "all"
  // Europe
  | "Western Europe"
  | "British Isles"
  | "Scandinavia"
  | "Central Europe"
  | "Mediterranean"
  | "Eastern Europe"
  // North America
  | "USA & Canada"
  | "Central America & Caribbean"
  // Asia
  | "East Asia"
  | "Southeast Asia"
  | "South Asia"
  | "Middle East"
  // Oceania
  | "Australia & NZ"
  // South America
  | "South America"
  // Africa
  | "Africa";

export interface FilterState {
  search: string;
  receiverType: ReceiverType;
  band: BandType;
  continent: ContinentType;
  region: RegionType;
}

/** Band detection from station/receiver labels */
export const BAND_DEFINITIONS: { id: BandType; label: string; keywords: string[]; description: string }[] = [
  {
    id: "HF",
    label: "HF",
    keywords: ["hf", "0-30", "0-32", "0.5-30", "shortwave", "sw ", "0-30 mhz", "100khz-30mhz", "100 khz - 30 mhz"],
    description: "0–30 MHz",
  },
  {
    id: "VHF",
    label: "VHF",
    keywords: ["vhf", "144", "145", "146", "2m ", "2 m ", "fm broadcast", "dab+", "dab "],
    description: "30–300 MHz",
  },
  {
    id: "UHF",
    label: "UHF",
    keywords: ["uhf", "430", "433", "435", "438", "70cm", "70 cm", "pmr", "23cm", "23 cm", "1296"],
    description: "300+ MHz",
  },
  {
    id: "LF/MF",
    label: "LF/MF",
    keywords: ["lf", "mf", "longwave", "mediumwave", "medium wave", "ndb", "am broadcast"],
    description: "< 3 MHz",
  },
  {
    id: "Airband",
    label: "Airband",
    keywords: ["airband", "air band", "aviation", "ads-b", "adsb"],
    description: "108–137 MHz",
  },
  {
    id: "CB",
    label: "CB",
    keywords: ["cb ", "cb/", "citizen", "27 mhz", "27mhz", "11m ", "11 m "],
    description: "27 MHz",
  },
];

/** Continent definitions with sub-regions */
export interface RegionDef {
  id: RegionType;
  label: string;
}

export interface ContinentDef {
  id: ContinentType;
  label: string;
  emoji: string;
  center: { lat: number; lng: number }; // Geographic center for globe rotation
  zoom: number; // Camera distance multiplier (1 = default)
  regions: RegionDef[];
}

export const CONTINENT_DEFINITIONS: ContinentDef[] = [
  {
    id: "Europe",
    label: "Europe",
    emoji: "EU",
    center: { lat: 50, lng: 10 },
    zoom: 0.85,
    regions: [
      { id: "Western Europe", label: "Western Europe" },
      { id: "British Isles", label: "British Isles" },
      { id: "Scandinavia", label: "Scandinavia" },
      { id: "Central Europe", label: "Central Europe" },
      { id: "Mediterranean", label: "Mediterranean" },
      { id: "Eastern Europe", label: "Eastern Europe" },
    ],
  },
  {
    id: "North America",
    label: "N. America",
    emoji: "NA",
    center: { lat: 40, lng: -100 },
    zoom: 0.85,
    regions: [
      { id: "USA & Canada", label: "USA & Canada" },
      { id: "Central America & Caribbean", label: "Central Am. & Caribbean" },
    ],
  },
  {
    id: "Asia",
    label: "Asia",
    emoji: "AS",
    center: { lat: 35, lng: 90 },
    zoom: 0.8,
    regions: [
      { id: "East Asia", label: "East Asia" },
      { id: "Southeast Asia", label: "SE Asia" },
      { id: "South Asia", label: "South Asia" },
      { id: "Middle East", label: "Middle East" },
    ],
  },
  {
    id: "Oceania",
    label: "Oceania",
    emoji: "OC",
    center: { lat: -28, lng: 140 },
    zoom: 0.85,
    regions: [
      { id: "Australia & NZ", label: "Australia & NZ" },
    ],
  },
  {
    id: "South America",
    label: "S. America",
    emoji: "SA",
    center: { lat: -15, lng: -55 },
    zoom: 0.8,
    regions: [
      { id: "South America", label: "South America" },
    ],
  },
  {
    id: "Africa",
    label: "Africa",
    emoji: "AF",
    center: { lat: 5, lng: 20 },
    zoom: 0.8,
    regions: [
      { id: "Africa", label: "Africa" },
    ],
  },
];

/** Detect which bands a station covers based on label text */
export function detectBands(station: Station): BandType[] {
  const bands: BandType[] = [];
  const combined = (
    station.label +
    " " +
    station.receivers.map((r) => r.label).join(" ")
  ).toLowerCase();

  for (const band of BAND_DEFINITIONS) {
    if (band.keywords.some((kw) => combined.includes(kw))) {
      bands.push(band.id);
    }
  }

  // KiwiSDR receivers are almost always HF (0-30 MHz)
  if (bands.length === 0 && station.receivers.some((r) => r.type === "KiwiSDR")) {
    bands.push("HF");
  }

  return bands;
}

/** Detect continent from coordinates */
export function detectContinent(lat: number, lng: number): ContinentType {
  // Europe (check first — densest region)
  if (lat >= 35 && lat <= 72 && lng >= -25 && lng <= 60) return "Europe";
  // Iceland
  if (lat >= 63 && lat <= 67 && lng >= -25 && lng <= -13) return "Europe";
  // North America
  if (lat >= 24 && lat <= 72 && lng >= -170 && lng <= -50) return "North America";
  if (lat >= 7 && lat <= 33 && lng >= -120 && lng <= -59) return "North America";
  // Hawaii
  if (lat >= 18 && lat <= 23 && lng >= -161 && lng <= -154) return "North America";
  // South America
  if (lat >= -60 && lat <= 15 && lng >= -82 && lng <= -34) return "South America";
  // Asia
  if (lat >= 12 && lat <= 55 && lng >= 25 && lng <= 150) return "Asia";
  if (lat >= -11 && lat <= 25 && lng >= 95 && lng <= 140) return "Asia";
  if (lat >= 5 && lat <= 38 && lng >= 60 && lng <= 98) return "Asia";
  if (lat >= 50 && lat <= 75 && lng >= 60 && lng <= 180) return "Asia";
  // Africa
  if (lat >= -35 && lat <= 38 && lng >= -18 && lng <= 55) return "Africa";
  // Oceania
  if (lat >= -48 && lat <= -10 && lng >= 110 && lng <= 180) return "Oceania";
  if (lat >= -48 && lat <= 0 && lng >= 165 && lng <= 180) return "Oceania";
  // Azores (Portugal)
  if (lat >= 36 && lat <= 40 && lng >= -32 && lng <= -24) return "Europe";
  return "Europe"; // Default fallback
}

/** Detect region from coordinates */
export function detectRegion(lat: number, lng: number): RegionType {
  const continent = detectContinent(lat, lng);

  if (continent === "Europe") {
    if (lat >= 49 && lat <= 61 && lng >= -11 && lng <= 2) return "British Isles";
    if (lat >= 55 && lat <= 72 && lng >= 4 && lng <= 32) return "Scandinavia";
    if (lat >= 34 && lat <= 46 && lng >= -6 && lng <= 36) return "Mediterranean";
    if (lat >= 45 && lat <= 58 && lng >= 5 && lng <= 25) return "Central Europe";
    if (lat >= 40 && lat <= 72 && lng >= 20 && lng <= 60) return "Eastern Europe";
    return "Western Europe";
  }

  if (continent === "North America") {
    if (lat >= 7 && lat <= 27 && lng >= -120 && lng <= -59) return "Central America & Caribbean";
    return "USA & Canada";
  }

  if (continent === "Asia") {
    if (lat >= 12 && lat <= 42 && lng >= 25 && lng <= 63) return "Middle East";
    if (lat >= 20 && lat <= 55 && lng >= 100 && lng <= 150) return "East Asia";
    if (lat >= -11 && lat <= 25 && lng >= 95 && lng <= 140) return "Southeast Asia";
    if (lat >= 5 && lat <= 38 && lng >= 60 && lng <= 98) return "South Asia";
    return "East Asia"; // fallback for Siberia etc.
  }

  if (continent === "Oceania") return "Australia & NZ";
  if (continent === "South America") return "South America";
  if (continent === "Africa") return "Africa";

  return "Western Europe";
}
