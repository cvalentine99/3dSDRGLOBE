/**
 * anomalyDetector.ts — Anomaly detection for TDoA target position tracking
 *
 * Compares new position observations against the prediction model.
 * If the observed position falls outside the confidence ellipse,
 * an anomaly alert is generated with severity based on deviation sigma.
 *
 * Severity levels:
 * - low:    1.5σ – 2σ deviation (unusual but possible)
 * - medium: 2σ – 3σ deviation (unexpected movement)
 * - high:   >3σ deviation (significant anomaly)
 */

import { predictPosition, type HistoryPoint, type PredictionResult } from "./positionPredictor";
import { haversineKm } from "@shared/geo";
import { notifyOwner } from "./_core/notification";
import { getDb } from "./db";
import {
  anomalyAlerts,
  tdoaTargets,
  tdoaTargetHistory,
} from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";

export interface AnomalyCheckResult {
  isAnomaly: boolean;
  severity: "low" | "medium" | "high" | null;
  deviationKm: number;
  deviationSigma: number;
  prediction: PredictionResult | null;
  alertId: number | null;
}

/**
 * Check if a point is inside a rotated ellipse.
 * Returns the normalized distance (1.0 = on the ellipse boundary).
 */
export function ellipseDistance(
  pointLat: number,
  pointLon: number,
  centerLat: number,
  centerLon: number,
  semiMajorDeg: number,
  semiMinorDeg: number,
  rotationDeg: number
): number {
  const dLat = pointLat - centerLat;
  const dLon = pointLon - centerLon;
  const rotRad = (rotationDeg * Math.PI) / 180;

  // Rotate point into ellipse coordinate system
  const cosR = Math.cos(rotRad);
  const sinR = Math.sin(rotRad);
  const rotatedLat = dLat * cosR + dLon * sinR;
  const rotatedLon = -dLat * sinR + dLon * cosR;

  // Normalized distance: <1 inside, =1 on boundary, >1 outside
  if (semiMajorDeg <= 0 || semiMinorDeg <= 0) return Infinity;
  return Math.sqrt(
    (rotatedLat / semiMajorDeg) ** 2 + (rotatedLon / semiMinorDeg) ** 2
  );
}

/**
 * Convert ellipse normalized distance to approximate sigma value.
 * The ellipse is drawn at 2σ, so normalized distance of 1.0 = 2σ.
 */
export function normalizedDistToSigma(normalizedDist: number): number {
  return normalizedDist * 2; // Ellipse is 2-sigma
}

/**
 * Determine severity from sigma deviation.
 */
export function getSeverity(sigma: number): "low" | "medium" | "high" | null {
  if (sigma >= 3) return "high";
  if (sigma >= 2) return "medium";
  if (sigma >= 1.5) return "low";
  return null; // Not anomalous
}

/**
 * Check a new position observation against the prediction model for a target.
 * If anomalous, creates an alert in the database and optionally notifies the owner.
 *
 * @param targetId - The target to check
 * @param observedLat - New observed latitude
 * @param observedLon - New observed longitude
 * @param historyEntryId - The history entry ID that triggered this check
 * @param sendNotification - Whether to send owner notification (default: true)
 */
export async function checkForAnomaly(
  targetId: number,
  observedLat: number,
  observedLon: number,
  historyEntryId: number,
  sendNotification: boolean = true
): Promise<AnomalyCheckResult> {
  const db = await getDb();
  if (!db) {
    return {
      isAnomaly: false,
      severity: null,
      deviationKm: 0,
      deviationSigma: 0,
      prediction: null,
      alertId: null,
    };
  }

  // Get the target info
  const target = await db
    .select()
    .from(tdoaTargets)
    .where(eq(tdoaTargets.id, targetId))
    .limit(1);

  if (!target.length) {
    return {
      isAnomaly: false,
      severity: null,
      deviationKm: 0,
      deviationSigma: 0,
      prediction: null,
      alertId: null,
    };
  }

  // Get position history for prediction (need at least 2 points)
  const history = await db
    .select()
    .from(tdoaTargetHistory)
    .where(eq(tdoaTargetHistory.targetId, targetId))
    .orderBy(tdoaTargetHistory.observedAt);

  // Need at least 2 prior points to make a prediction
  // Exclude the current observation from the prediction input
  const priorHistory = history.filter((h) => h.id !== historyEntryId);
  if (priorHistory.length < 2) {
    return {
      isAnomaly: false,
      severity: null,
      deviationKm: 0,
      deviationSigma: 0,
      prediction: null,
      alertId: null,
    };
  }

  const points: HistoryPoint[] = priorHistory.map((h) => ({
    lat: parseFloat(h.lat),
    lon: parseFloat(h.lon),
    time: h.observedAt,
  }));

  const prediction = predictPosition(points);
  if (!prediction) {
    return {
      isAnomaly: false,
      severity: null,
      deviationKm: 0,
      deviationSigma: 0,
      prediction: null,
      alertId: null,
    };
  }

  // Calculate deviation from predicted position
  const deviationKm = haversineKm(
    prediction.predictedLat,
    prediction.predictedLon,
    observedLat,
    observedLon
  );

  // Check if point is outside the confidence ellipse
  const normalizedDist = ellipseDistance(
    observedLat,
    observedLon,
    prediction.predictedLat,
    prediction.predictedLon,
    prediction.ellipseMajor,
    prediction.ellipseMinor,
    prediction.ellipseRotation
  );

  const deviationSigma = normalizedDistToSigma(normalizedDist);
  const severity = getSeverity(deviationSigma);

  if (!severity) {
    return {
      isAnomaly: false,
      severity: null,
      deviationKm,
      deviationSigma,
      prediction,
      alertId: null,
    };
  }

  // Create the anomaly alert
  const description = buildAlertDescription(
    target[0],
    prediction,
    observedLat,
    observedLon,
    deviationKm,
    deviationSigma,
    severity
  );

  const [inserted] = await db.insert(anomalyAlerts).values({
    targetId,
    historyEntryId,
    severity,
    deviationKm,
    deviationSigma,
    predictedLat: prediction.predictedLat.toFixed(6),
    predictedLon: prediction.predictedLon.toFixed(6),
    actualLat: observedLat.toFixed(6),
    actualLon: observedLon.toFixed(6),
    description,
    acknowledged: false,
    notificationSent: false,
    createdAt: Date.now(),
  });

  const alertId = inserted.insertId;

  // Send owner notification for medium and high severity
  if (sendNotification && (severity === "medium" || severity === "high")) {
    try {
      const sent = await notifyOwner({
        title: `⚠️ Anomaly Alert: ${target[0].label} (${severity.toUpperCase()})`,
        content: description,
      });
      if (sent && alertId) {
        await db
          .update(anomalyAlerts)
          .set({ notificationSent: true })
          .where(eq(anomalyAlerts.id, alertId));
      }
    } catch (err) {
      console.warn("[AnomalyDetector] Failed to send notification:", err);
    }
  }

  return {
    isAnomaly: true,
    severity,
    deviationKm,
    deviationSigma,
    prediction,
    alertId,
  };
}

function buildAlertDescription(
  target: { label: string; category: string },
  prediction: PredictionResult,
  actualLat: number,
  actualLon: number,
  deviationKm: number,
  deviationSigma: number,
  severity: string
): string {
  return [
    `Target "${target.label}" (${target.category}) has moved unexpectedly.`,
    `Predicted position: ${prediction.predictedLat.toFixed(4)}°, ${prediction.predictedLon.toFixed(4)}°`,
    `Observed position: ${actualLat.toFixed(4)}°, ${actualLon.toFixed(4)}°`,
    `Deviation: ${deviationKm.toFixed(1)} km (${deviationSigma.toFixed(1)}σ)`,
    `Severity: ${severity}`,
    `Model: ${prediction.modelType} (R² lat=${prediction.rSquaredLat.toFixed(2)}, lon=${prediction.rSquaredLon.toFixed(2)})`,
    `Based on ${prediction.historyCount} prior observations.`,
  ].join("\n");
}
