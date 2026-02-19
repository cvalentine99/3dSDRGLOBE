/**
 * positionPredictor.ts — Position prediction using regression on drift history
 *
 * Fits linear and polynomial (quadratic) models to position history data
 * and projects the next likely position with a confidence ellipse.
 *
 * The prediction includes:
 * - Predicted lat/lon at a future time
 * - Confidence ellipse (semi-major/minor axes and rotation)
 * - Model fit quality (R²)
 * - Velocity estimate (km/h)
 */

import { haversineKm } from "@shared/geo";

export interface HistoryPoint {
  lat: number;
  lon: number;
  time: number; // Unix ms
}

export interface PredictionResult {
  /** Predicted latitude */
  predictedLat: number;
  /** Predicted longitude */
  predictedLon: number;
  /** Prediction time (Unix ms) — typically next observation window */
  predictedAt: number;
  /** Semi-major axis of confidence ellipse in degrees */
  ellipseMajor: number;
  /** Semi-minor axis of confidence ellipse in degrees */
  ellipseMinor: number;
  /** Rotation of ellipse in degrees (0 = aligned to lat axis) */
  ellipseRotation: number;
  /** R² goodness of fit for latitude model (0-1) */
  rSquaredLat: number;
  /** R² goodness of fit for longitude model (0-1) */
  rSquaredLon: number;
  /** Estimated velocity in km/h */
  velocityKmh: number;
  /** Bearing of movement in degrees (0 = north, 90 = east) */
  bearingDeg: number;
  /** Model type used: "linear" or "quadratic" */
  modelType: string;
  /** History points used for the prediction */
  historyCount: number;
  /** Average time between observations in hours */
  avgIntervalHours: number;
}

/**
 * Predict the next position based on historical observations.
 *
 * Strategy:
 * - 2 points: linear extrapolation
 * - 3+ points: try quadratic fit, fall back to linear if poor R²
 * - Prediction time: average interval ahead of last observation
 */
export function predictPosition(points: HistoryPoint[]): PredictionResult | null {
  if (points.length < 2) return null;

  // Sort by time
  const sorted = [...points].sort((a, b) => a.time - b.time);

  // Normalize time to hours from first observation
  const t0 = sorted[0].time;
  const tNorm = sorted.map((p) => (p.time - t0) / 3600000); // hours
  const lats = sorted.map((p) => p.lat);
  const lons = sorted.map((p) => p.lon);

  // Calculate average interval
  let totalInterval = 0;
  for (let i = 1; i < sorted.length; i++) {
    totalInterval += sorted[i].time - sorted[i - 1].time;
  }
  const avgIntervalMs = totalInterval / (sorted.length - 1);
  const avgIntervalHours = avgIntervalMs / 3600000;

  // Prediction time: one average interval ahead
  const lastTime = sorted[sorted.length - 1].time;
  const predictTime = lastTime + avgIntervalMs;
  const tPredict = (predictTime - t0) / 3600000;

  let modelType = "linear";
  let latCoeffs: number[];
  let lonCoeffs: number[];
  let rSquaredLat: number;
  let rSquaredLon: number;

  if (sorted.length >= 4) {
    // Try quadratic fit
    const qLatCoeffs = polyFit(tNorm, lats, 2);
    const qLonCoeffs = polyFit(tNorm, lons, 2);
    const qRsqLat = rSquared(tNorm, lats, qLatCoeffs);
    const qRsqLon = rSquared(tNorm, lons, qLonCoeffs);

    // Also try linear
    const lLatCoeffs = polyFit(tNorm, lats, 1);
    const lLonCoeffs = polyFit(tNorm, lons, 1);
    const lRsqLat = rSquared(tNorm, lats, lLatCoeffs);
    const lRsqLon = rSquared(tNorm, lons, lLonCoeffs);

    // Use quadratic if it's meaningfully better
    const qAvgRsq = (qRsqLat + qRsqLon) / 2;
    const lAvgRsq = (lRsqLat + lRsqLon) / 2;

    if (qAvgRsq > lAvgRsq + 0.05 && qAvgRsq > 0.5) {
      modelType = "quadratic";
      latCoeffs = qLatCoeffs;
      lonCoeffs = qLonCoeffs;
      rSquaredLat = qRsqLat;
      rSquaredLon = qRsqLon;
    } else {
      latCoeffs = lLatCoeffs;
      lonCoeffs = lLonCoeffs;
      rSquaredLat = lRsqLat;
      rSquaredLon = lRsqLon;
    }
  } else {
    // Linear fit
    latCoeffs = polyFit(tNorm, lats, 1);
    lonCoeffs = polyFit(tNorm, lons, 1);
    rSquaredLat = rSquared(tNorm, lats, latCoeffs);
    rSquaredLon = rSquared(tNorm, lons, lonCoeffs);
  }

  // Predict
  const predictedLat = polyEval(latCoeffs, tPredict);
  const predictedLon = polyEval(lonCoeffs, tPredict);

  // Clamp to valid range
  const clampedLat = Math.max(-90, Math.min(90, predictedLat));
  const clampedLon = Math.max(-180, Math.min(180, predictedLon));

  // Calculate residuals for confidence ellipse
  const latResiduals = tNorm.map((t, i) => lats[i] - polyEval(latCoeffs, t));
  const lonResiduals = tNorm.map((t, i) => lons[i] - polyEval(lonCoeffs, t));

  const latStd = stdDev(latResiduals);
  const lonStd = stdDev(lonResiduals);

  // Confidence ellipse (2-sigma ~ 95% confidence)
  // Scale by extrapolation factor
  const lastTNorm = tNorm[tNorm.length - 1];
  const extrapolationFactor = lastTNorm > 0 ? Math.max(1, tPredict / lastTNorm) : 2;
  const ellipseMajor = Math.max(latStd, lonStd) * 2 * extrapolationFactor;
  const ellipseMinor = Math.min(latStd, lonStd) * 2 * extrapolationFactor;

  // Minimum ellipse size (0.1 degrees ~ 11 km)
  const minEllipse = 0.1;
  const finalMajor = Math.max(ellipseMajor, minEllipse);
  const finalMinor = Math.max(ellipseMinor, minEllipse);

  // Ellipse rotation from covariance
  const cov = covariance(latResiduals, lonResiduals);
  const ellipseRotation =
    latStd === lonStd
      ? 0
      : (0.5 * Math.atan2(2 * cov, latStd * latStd - lonStd * lonStd) * 180) / Math.PI;

  // Velocity estimate
  const lastLat = sorted[sorted.length - 1].lat;
  const lastLon = sorted[sorted.length - 1].lon;
  const distKm = haversineKm(lastLat, lastLon, clampedLat, clampedLon);
  const velocityKmh = avgIntervalHours > 0 ? distKm / avgIntervalHours : 0;

  // Bearing
  const bearingDeg = bearing(lastLat, lastLon, clampedLat, clampedLon);

  return {
    predictedLat: clampedLat,
    predictedLon: clampedLon,
    predictedAt: predictTime,
    ellipseMajor: finalMajor,
    ellipseMinor: finalMinor,
    ellipseRotation,
    rSquaredLat: Math.max(0, rSquaredLat),
    rSquaredLon: Math.max(0, rSquaredLon),
    velocityKmh,
    bearingDeg,
    modelType,
    historyCount: sorted.length,
    avgIntervalHours,
  };
}

/* ── Math utilities ── */

/**
 * Polynomial least-squares fit using normal equations.
 * Returns coefficients [a0, a1, a2, ...] where y = a0 + a1*x + a2*x² + ...
 */
function polyFit(x: number[], y: number[], degree: number): number[] {
  const n = x.length;
  const m = degree + 1;

  // Build Vandermonde-like matrix (X^T X) and (X^T y)
  const XtX: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
  const Xty: number[] = new Array(m).fill(0);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const xj = Math.pow(x[i], j);
      Xty[j] += xj * y[i];
      for (let k = 0; k < m; k++) {
        XtX[j][k] += xj * Math.pow(x[i], k);
      }
    }
  }

  // Solve via Gaussian elimination
  return gaussianElimination(XtX, Xty);
}

function gaussianElimination(A: number[][], b: number[]): number[] {
  const n = A.length;
  const aug: number[][] = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivoting
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) {
        maxRow = row;
      }
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    if (Math.abs(aug[col][col]) < 1e-12) {
      // Singular — return zeros
      return new Array(n).fill(0);
    }

    // Eliminate below
    for (let row = col + 1; row < n; row++) {
      const factor = aug[row][col] / aug[col][col];
      for (let j = col; j <= n; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  // Back substitution
  const x = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = aug[row][n];
    for (let j = row + 1; j < n; j++) {
      sum -= aug[row][j] * x[j];
    }
    x[row] = sum / aug[row][row];
  }

  return x;
}

function polyEval(coeffs: number[], x: number): number {
  let result = 0;
  for (let i = 0; i < coeffs.length; i++) {
    result += coeffs[i] * Math.pow(x, i);
  }
  return result;
}

function rSquared(x: number[], y: number[], coeffs: number[]): number {
  const n = y.length;
  const yMean = y.reduce((a, b) => a + b, 0) / n;
  let ssTot = 0;
  let ssRes = 0;

  for (let i = 0; i < n; i++) {
    const yPred = polyEval(coeffs, x[i]);
    ssTot += (y[i] - yMean) ** 2;
    ssRes += (y[i] - yPred) ** 2;
  }

  if (ssTot === 0) return 1; // All values identical
  return 1 - ssRes / ssTot;
}

function stdDev(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0.1; // Minimum std dev
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance) || 0.1;
}

function covariance(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 2) return 0;
  const aMean = a.reduce((s, v) => s + v, 0) / n;
  const bMean = b.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i] - aMean) * (b[i] - bMean);
  }
  return cov / (n - 1);
}

// haversineKm imported from shared/geo.ts

function bearing(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const toRad = Math.PI / 180;
  const dLon = (lon2 - lon1) * toRad;
  const y = Math.sin(dLon) * Math.cos(lat2 * toRad);
  const x =
    Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) -
    Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos(dLon);
  const brng = (Math.atan2(y, x) * 180) / Math.PI;
  return (brng + 360) % 360;
}
