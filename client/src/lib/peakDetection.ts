/**
 * peakDetection.ts — SNR Peak & Trough Detection
 * 
 * Identifies significant local maxima (peaks) and minima (troughs)
 * in SNR time-series data. Uses a prominence-based algorithm that
 * adapts to the data's dynamic range.
 */

export interface DataPoint {
  ts: number;   // timestamp ms
  val: number;  // SNR dB
  idx: number;  // original index in the entries array
}

export interface Extremum {
  type: "peak" | "trough";
  point: DataPoint;
  prominence: number;    // how significant this extremum is (dB)
  deltaFromMean: number; // deviation from the running mean
  label: string;         // human-readable label
  severity: "major" | "minor"; // visual weight
}

/**
 * Detect significant peaks and troughs in an SNR time series.
 * 
 * Algorithm:
 * 1. Compute a rolling average to establish baseline
 * 2. Find all local maxima and minima
 * 3. Calculate prominence for each extremum
 * 4. Filter by significance threshold (adaptive to data range)
 * 5. Limit total annotations to avoid clutter
 */
export function detectExtrema(
  dataPoints: DataPoint[],
  options?: {
    /** Max number of annotations to show (default: 8) */
    maxAnnotations?: number;
    /** Minimum prominence as fraction of data range (default: 0.15) */
    minProminenceFraction?: number;
    /** Rolling window size for baseline (default: 5) */
    windowSize?: number;
  }
): Extremum[] {
  const {
    maxAnnotations = 8,
    minProminenceFraction = 0.12,
    windowSize = 5,
  } = options || {};

  if (dataPoints.length < 3) return [];

  const values = dataPoints.map((d) => d.val);
  const globalMax = Math.max(...values);
  const globalMin = Math.min(...values);
  const dataRange = globalMax - globalMin;

  // If the data is essentially flat, no significant peaks/troughs
  if (dataRange < 2) return [];

  const minProminence = dataRange * minProminenceFraction;

  // Compute rolling average for baseline
  const rollingAvg = computeRollingAverage(values, windowSize);

  // Find all local maxima and minima
  const localMaxima: number[] = [];
  const localMinima: number[] = [];

  for (let i = 1; i < values.length - 1; i++) {
    if (values[i] > values[i - 1] && values[i] >= values[i + 1]) {
      localMaxima.push(i);
    }
    if (values[i] < values[i - 1] && values[i] <= values[i + 1]) {
      localMinima.push(i);
    }
  }

  // Also check endpoints for global extrema
  if (values.length > 1) {
    if (values[0] >= values[1]) localMaxima.unshift(0);
    if (values[0] <= values[1]) localMinima.unshift(0);
    const last = values.length - 1;
    if (values[last] >= values[last - 1]) localMaxima.push(last);
    if (values[last] <= values[last - 1]) localMinima.push(last);
  }

  // Calculate prominence for each peak
  const peaks: Extremum[] = localMaxima.map((i) => {
    const prominence = calculateProminence(values, i, "peak");
    const deltaFromMean = values[i] - rollingAvg[i];
    return {
      type: "peak" as const,
      point: dataPoints[i],
      prominence,
      deltaFromMean,
      label: `${values[i].toFixed(0)} dB`,
      severity: prominence >= dataRange * 0.3 ? "major" as const : "minor" as const,
    };
  }).filter((e) => e.prominence >= minProminence);

  // Calculate prominence for each trough
  const troughs: Extremum[] = localMinima.map((i) => {
    const prominence = calculateProminence(values, i, "trough");
    const deltaFromMean = rollingAvg[i] - values[i];
    return {
      type: "trough" as const,
      point: dataPoints[i],
      prominence,
      deltaFromMean,
      label: `${values[i].toFixed(0)} dB`,
      severity: prominence >= dataRange * 0.3 ? "major" as const : "minor" as const,
    };
  }).filter((e) => e.prominence >= minProminence);

  // Combine, sort by prominence, and limit
  const all = [...peaks, ...troughs]
    .sort((a, b) => b.prominence - a.prominence)
    .slice(0, maxAnnotations);

  // Ensure we don't have annotations too close together (min 10% of timeline apart)
  const minTsGap = dataPoints.length > 1
    ? (dataPoints[dataPoints.length - 1].ts - dataPoints[0].ts) * 0.06
    : 0;

  const filtered: Extremum[] = [];
  for (const ext of all) {
    const tooClose = filtered.some(
      (existing) => Math.abs(existing.point.ts - ext.point.ts) < minTsGap
    );
    if (!tooClose) {
      filtered.push(ext);
    }
  }

  return filtered.sort((a, b) => a.point.ts - b.point.ts);
}

/**
 * Calculate prominence of a peak or trough.
 * Prominence = the minimum vertical distance the signal must descend/ascend
 * from the extremum before reaching a higher peak / lower trough.
 */
function calculateProminence(values: number[], idx: number, type: "peak" | "trough"): number {
  const val = values[idx];

  if (type === "peak") {
    // Look left for the lowest point before a higher peak
    let leftMin = val;
    for (let i = idx - 1; i >= 0; i--) {
      leftMin = Math.min(leftMin, values[i]);
      if (values[i] > val) break;
    }

    // Look right for the lowest point before a higher peak
    let rightMin = val;
    for (let i = idx + 1; i < values.length; i++) {
      rightMin = Math.min(rightMin, values[i]);
      if (values[i] > val) break;
    }

    return val - Math.max(leftMin, rightMin);
  } else {
    // Look left for the highest point before a lower trough
    let leftMax = val;
    for (let i = idx - 1; i >= 0; i--) {
      leftMax = Math.max(leftMax, values[i]);
      if (values[i] < val) break;
    }

    // Look right for the highest point before a lower trough
    let rightMax = val;
    for (let i = idx + 1; i < values.length; i++) {
      rightMax = Math.max(rightMax, values[i]);
      if (values[i] < val) break;
    }

    return Math.min(leftMax, rightMax) - val;
  }
}

/**
 * Compute a rolling average over the given window size.
 */
function computeRollingAverage(values: number[], windowSize: number): number[] {
  const result: number[] = [];
  const half = Math.floor(windowSize / 2);

  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - half);
    const end = Math.min(values.length - 1, i + half);
    let sum = 0;
    let count = 0;
    for (let j = start; j <= end; j++) {
      sum += values[j];
      count++;
    }
    result.push(sum / count);
  }

  return result;
}

/**
 * Compute the rolling average as a polyline for chart overlay.
 * Returns array of { ts, val } for the smoothed baseline.
 */
export function computeBaseline(
  dataPoints: DataPoint[],
  windowSize = 5
): { ts: number; val: number }[] {
  const values = dataPoints.map((d) => d.val);
  const avg = computeRollingAverage(values, windowSize);
  return dataPoints.map((d, i) => ({ ts: d.ts, val: avg[i] }));
}
