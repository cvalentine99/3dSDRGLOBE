/**
 * FPSGovernor.ts — FPS monitor with automatic quality reduction
 *
 * Tracks rolling average FPS and adjusts Three.js quality levels to prevent
 * GPU overload and preempt WebGL context loss. Exposes a PerformanceHUD
 * overlay activated via ?debug=perf or localStorage flag.
 */
import * as THREE from "three";
import { setRenderMode } from "./RenderMode";

/** Quality levels in ascending order of fidelity */
export type QualityLevel = "QUALITY_LOW" | "QUALITY_MED" | "QUALITY_HIGH";

/** Quality configuration per level */
export interface QualityConfig {
  globeSegments: number;
  atmosphereEnabled: boolean;
  usePointMarkers: boolean;
  shadowsEnabled: boolean;
  maxPixelRatio: number;
  markerSegments: number;
}

const QUALITY_CONFIGS: Record<QualityLevel, QualityConfig> = {
  QUALITY_HIGH: {
    globeSegments: 64,
    atmosphereEnabled: true,
    usePointMarkers: false,
    shadowsEnabled: true,
    maxPixelRatio: 2,
    markerSegments: 8,
  },
  QUALITY_MED: {
    globeSegments: 32,
    atmosphereEnabled: false,
    usePointMarkers: true,
    shadowsEnabled: false,
    maxPixelRatio: 2,
    markerSegments: 4,
  },
  QUALITY_LOW: {
    globeSegments: 16,
    atmosphereEnabled: false,
    usePointMarkers: true,
    shadowsEnabled: false,
    maxPixelRatio: 1,
    markerSegments: 4,
  },
};

/** FPS thresholds */
const FPS_EMERGENCY = 20;
const FPS_DEGRADED = 35;
const FPS_RESTORED = 50;
const FPS_CRITICAL = 10;

/** Timing constants */
const SAMPLE_WINDOW = 60;
const UPGRADE_STABLE_SECONDS = 5;
const UPGRADE_COOLDOWN_MS = 30_000;
const CRITICAL_DURATION_MS = 3_000;

/** Level ordering for comparison */
const LEVEL_ORDER: QualityLevel[] = [
  "QUALITY_LOW",
  "QUALITY_MED",
  "QUALITY_HIGH",
];

/**
 * Callbacks for applying quality changes to the Three.js scene.
 * The consumer is responsible for the actual geometry/material swaps.
 */
export interface FPSGovernorCallbacks {
  /** Called when quality level changes — apply the new config to the scene */
  onQualityChange: (level: QualityLevel, config: QualityConfig) => void;
}

/**
 * Monitors FPS and automatically adjusts rendering quality.
 *
 * Call `tick()` at the start of each animation frame. The governor tracks
 * frame deltas, computes rolling average FPS, and triggers quality changes
 * when thresholds are crossed.
 */
export class FPSGovernor {
  private frameTimes: number[] = [];
  private lastFrameTime = 0;
  private currentLevel: QualityLevel = "QUALITY_HIGH";
  private callbacks: FPSGovernorCallbacks;
  private aboveRestoredSince = 0;
  private lastUpgradeTime = 0;
  private belowCriticalSince = 0;
  private criticalFallbackFired = false;
  private hudElement: HTMLDivElement | null = null;
  private hudEnabled = false;
  private renderer: THREE.WebGLRenderer | null = null;

  constructor(callbacks: FPSGovernorCallbacks) {
    this.callbacks = callbacks;
    this.lastFrameTime = performance.now();

    // Check for debug HUD activation via ?debug=perf or localStorage
    const params = new URLSearchParams(window.location.search);
    this.hudEnabled =
      params.get("debug") === "perf" ||
      localStorage.getItem("sdr-perf-hud") === "true";
  }

  /** Set the renderer reference for HUD draw call info */
  setRenderer(renderer: THREE.WebGLRenderer): void {
    this.renderer = renderer;
  }

  /** Get the current quality level */
  get level(): QualityLevel {
    return this.currentLevel;
  }

  /** Get the config for the current quality level */
  get config(): QualityConfig {
    return QUALITY_CONFIGS[this.currentLevel];
  }

  /** Get the config for a specific quality level */
  static getConfig(level: QualityLevel): QualityConfig {
    return QUALITY_CONFIGS[level];
  }

  /**
   * Call this at the start of every animation frame.
   * Computes FPS, evaluates thresholds, and triggers quality changes.
   */
  tick(): void {
    const now = performance.now();
    const delta = now - this.lastFrameTime;
    this.lastFrameTime = now;

    // Skip unreasonable deltas (e.g., tab was hidden)
    if (delta > 500) return;

    this.frameTimes.push(delta);
    if (this.frameTimes.length > SAMPLE_WINDOW) {
      this.frameTimes.shift();
    }

    if (this.frameTimes.length < 10) return; // Need minimum samples

    const avgDelta =
      this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    const fps = 1000 / avgDelta;

    this.evaluateThresholds(fps, now);
    this.updateHUD(fps, delta);
  }

  private evaluateThresholds(fps: number, now: number): void {
    const levelIdx = LEVEL_ORDER.indexOf(this.currentLevel);

    // Critical: FPS < 10 for > 3 seconds → proactive fallback
    if (fps < FPS_CRITICAL) {
      if (this.belowCriticalSince === 0) {
        this.belowCriticalSince = now;
      } else if (
        now - this.belowCriticalSince > CRITICAL_DURATION_MS &&
        !this.criticalFallbackFired
      ) {
        console.warn(
          "[FPSGovernor] FPS critically low (<10) for >3s — triggering fallback"
        );
        this.criticalFallbackFired = true;
        setRenderMode("fallback", "GPU performance critically low");
      }
    } else {
      this.belowCriticalSince = 0;
      this.criticalFallbackFired = false;
    }

    // Emergency: FPS < 20 → drop to LOW
    if (fps < FPS_EMERGENCY && this.currentLevel !== "QUALITY_LOW") {
      this.setLevel("QUALITY_LOW");
      console.warn(
        `[FPSGovernor] FPS ${fps.toFixed(1)} < ${FPS_EMERGENCY} — dropping to QUALITY_LOW`
      );
      return;
    }

    // Degraded: FPS < 35 → drop to MED (if currently HIGH)
    if (
      fps < FPS_DEGRADED &&
      this.currentLevel === "QUALITY_HIGH"
    ) {
      this.setLevel("QUALITY_MED");
      console.log(
        `[FPSGovernor] FPS ${fps.toFixed(1)} < ${FPS_DEGRADED} — dropping to QUALITY_MED`
      );
      return;
    }

    // Restore: FPS >= 50 for 10 consecutive seconds → upgrade one level
    if (fps >= FPS_RESTORED) {
      if (this.aboveRestoredSince === 0) {
        this.aboveRestoredSince = now;
      }

      const stableMs = now - this.aboveRestoredSince;
      const cooldownOk = now - this.lastUpgradeTime > UPGRADE_COOLDOWN_MS;

      if (
        stableMs > UPGRADE_STABLE_SECONDS * 1000 &&
        cooldownOk &&
        levelIdx < LEVEL_ORDER.length - 1
      ) {
        const nextLevel = LEVEL_ORDER[levelIdx + 1];
        this.setLevel(nextLevel);
        this.lastUpgradeTime = now;
        this.aboveRestoredSince = 0; // Reset stability timer
        console.log(
          `[FPSGovernor] FPS stable at ${fps.toFixed(1)} — upgrading to ${nextLevel}`
        );
      }
    } else {
      this.aboveRestoredSince = 0;
    }
  }

  private setLevel(level: QualityLevel): void {
    if (level === this.currentLevel) return;
    this.currentLevel = level;
    this.callbacks.onQualityChange(level, QUALITY_CONFIGS[level]);
  }

  /**
   * Create and attach the performance HUD overlay.
   * @param container - The DOM element to attach the HUD to
   */
  attachHUD(container: HTMLElement): void {
    if (!this.hudEnabled) return;

    this.hudElement = document.createElement("div");
    this.hudElement.id = "sdr-perf-hud";
    Object.assign(this.hudElement.style, {
      position: "absolute",
      top: "60px",
      left: "8px",
      zIndex: "9999",
      padding: "8px 12px",
      background: "rgba(0,0,0,0.85)",
      color: "#0ff",
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: "11px",
      lineHeight: "1.6",
      borderRadius: "6px",
      border: "1px solid rgba(0,255,255,0.2)",
      pointerEvents: "none",
      whiteSpace: "pre",
    });
    container.appendChild(this.hudElement);
  }

  private updateHUD(fps: number, frameDelta: number): void {
    if (!this.hudElement) return;

    const drawCalls = this.renderer?.info?.render?.calls ?? "?";
    const triangles = this.renderer?.info?.render?.triangles ?? "?";
    const geometries = this.renderer?.info?.memory?.geometries ?? "?";
    const textures = this.renderer?.info?.memory?.textures ?? "?";

    let fpsColor = "#4ade80"; // green
    if (fps < FPS_EMERGENCY) fpsColor = "#ef4444"; // red
    else if (fps < FPS_DEGRADED) fpsColor = "#f59e0b"; // amber

    this.hudElement.innerHTML = [
      `<span style="color:${fpsColor}">FPS: ${fps.toFixed(1)}</span>`,
      `Delta: ${frameDelta.toFixed(1)}ms`,
      `Quality: ${this.currentLevel.replace("QUALITY_", "")}`,
      `Draw calls: ${drawCalls}`,
      `Triangles: ${triangles}`,
      `Geometries: ${geometries} | Textures: ${textures}`,
    ].join("\n");
  }

  /**
   * Remove the HUD element and clean up state.
   * Call this on component unmount.
   */
  dispose(): void {
    if (this.hudElement && this.hudElement.parentNode) {
      this.hudElement.parentNode.removeChild(this.hudElement);
    }
    this.hudElement = null;
    this.frameTimes = [];
    this.renderer = null;
  }

  /**
   * Reset the governor state after a context loss/restore cycle.
   * Clears frame history, critical flags, and stability timers.
   */
  reset(): void {
    this.frameTimes = [];
    this.lastFrameTime = performance.now();
    this.criticalFallbackFired = false;
    this.belowCriticalSince = 0;
    this.aboveRestoredSince = 0;
  }
}
