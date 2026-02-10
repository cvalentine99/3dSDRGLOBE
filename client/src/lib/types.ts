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

export interface FilterState {
  search: string;
  receiverType: ReceiverType;
  band: BandType;
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
