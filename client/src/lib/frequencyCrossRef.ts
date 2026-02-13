/**
 * frequencyCrossRef.ts — Cross-reference receiver tuning ranges with military frequencies
 * 
 * Parses frequency ranges from station/receiver labels and finds matching
 * military frequencies that fall within those ranges.
 */
import { MILITARY_FREQUENCIES, type MilitaryFrequency } from "./militaryRfData";
import type { Station } from "./types";

export interface FrequencyRange {
  minKhz: number;
  maxKhz: number;
  label: string;
}

/**
 * Parse frequency ranges from station and receiver labels.
 * Handles patterns like:
 *   "0-30 MHz", "0.5-30MHz", "100kHz-30MHz", "144-146 MHz",
 *   "0-30 mhz", "HF (0-30MHz)", "VHF 144-148", etc.
 */
export function parseFrequencyRanges(station: Station): FrequencyRange[] {
  const ranges: FrequencyRange[] = [];
  const combined = station.label + " " + station.receivers.map((r) => r.label).join(" ");

  // Pattern: number-number MHz/kHz (e.g., "0-30 MHz", "100kHz-30MHz", "0.5-30 mhz")
  const mhzPattern = /(\d+\.?\d*)\s*(?:mhz|khz)?\s*[-–—to]+\s*(\d+\.?\d*)\s*(mhz|MHz)/gi;
  let match;
  while ((match = mhzPattern.exec(combined)) !== null) {
    const low = parseFloat(match[1]);
    const high = parseFloat(match[2]);
    if (high > low && high <= 10000) {
      // Check if the low value is in kHz (e.g., "100kHz-30MHz")
      const beforeLow = combined.substring(Math.max(0, match.index - 5), match.index + match[1].length + 5).toLowerCase();
      let minKhz: number;
      if (beforeLow.includes("khz") || low >= 100) {
        // Low value is likely in kHz
        minKhz = low;
      } else {
        minKhz = low * 1000;
      }
      const maxKhz = high * 1000;
      if (maxKhz > minKhz) {
        ranges.push({
          minKhz,
          maxKhz,
          label: `${match[1]}–${match[2]} MHz`,
        });
      }
    }
  }

  // Pattern for kHz ranges: "100-500 kHz"
  const khzPattern = /(\d+\.?\d*)\s*[-–—to]+\s*(\d+\.?\d*)\s*(khz|kHz)/gi;
  while ((match = khzPattern.exec(combined)) !== null) {
    const low = parseFloat(match[1]);
    const high = parseFloat(match[2]);
    if (high > low) {
      ranges.push({
        minKhz: low,
        maxKhz: high,
        label: `${match[1]}–${match[2]} kHz`,
      });
    }
  }

  // KiwiSDR default range: 0-30 MHz if no explicit range found
  if (ranges.length === 0 && station.receivers.some((r) => r.type === "KiwiSDR")) {
    ranges.push({ minKhz: 0, maxKhz: 30000, label: "0–30 MHz" });
  }

  // WebSDR/OpenWebRX with HF keyword but no explicit range
  if (ranges.length === 0) {
    const lowerCombined = combined.toLowerCase();
    if (lowerCombined.includes("hf") || lowerCombined.includes("shortwave")) {
      ranges.push({ minKhz: 0, maxKhz: 30000, label: "0–30 MHz (HF)" });
    }
    if (lowerCombined.includes("vhf")) {
      ranges.push({ minKhz: 30000, maxKhz: 300000, label: "30–300 MHz (VHF)" });
    }
    if (lowerCombined.includes("uhf")) {
      ranges.push({ minKhz: 300000, maxKhz: 3000000, label: "300+ MHz (UHF)" });
    }
  }

  // Deduplicate overlapping ranges
  return deduplicateRanges(ranges);
}

function deduplicateRanges(ranges: FrequencyRange[]): FrequencyRange[] {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a.minKhz - b.minKhz);
  const result: FrequencyRange[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = result[result.length - 1];
    if (sorted[i].minKhz <= prev.maxKhz && sorted[i].maxKhz <= prev.maxKhz) {
      // Fully contained, skip
      continue;
    }
    if (sorted[i].minKhz <= prev.maxKhz) {
      // Overlapping, merge
      prev.maxKhz = sorted[i].maxKhz;
      prev.label = `${prev.label} + ${sorted[i].label}`;
    } else {
      result.push(sorted[i]);
    }
  }
  return result;
}

/**
 * Find all military frequencies that fall within the station's receiver tuning ranges.
 */
export function crossReferenceFrequencies(station: Station): MilitaryFrequency[] {
  const ranges = parseFrequencyRanges(station);
  if (ranges.length === 0) return [];

  return MILITARY_FREQUENCIES.filter((freq) => {
    return ranges.some(
      (range) => freq.frequencyKhz >= range.minKhz && freq.frequencyKhz <= range.maxKhz
    );
  }).sort((a, b) => a.frequencyKhz - b.frequencyKhz);
}

/**
 * Get the parsed tuning ranges for display.
 */
export function getStationTuningRanges(station: Station): FrequencyRange[] {
  return parseFrequencyRanges(station);
}

/**
 * Signal type display labels and colors for the cross-reference UI.
 */
export const SIGNAL_TYPE_DISPLAY: Record<string, { label: string; color: string; icon: string }> = {
  voice: { label: "Voice", color: "#22c55e", icon: "🎙" },
  digital: { label: "Digital", color: "#3b82f6", icon: "📡" },
  beacon: { label: "Beacon", color: "#f59e0b", icon: "📍" },
  navigation: { label: "Nav", color: "#06b6d4", icon: "🧭" },
  radar: { label: "Radar", color: "#ef4444", icon: "📡" },
  marker: { label: "Marker", color: "#a855f7", icon: "📌" },
  numbers: { label: "Numbers", color: "#ec4899", icon: "🔢" },
  broadcast: { label: "Broadcast", color: "#10b981", icon: "📻" },
  scrambler: { label: "Scrambler", color: "#f97316", icon: "🔒" },
  datalink: { label: "Datalink", color: "#6366f1", icon: "🔗" },
};
