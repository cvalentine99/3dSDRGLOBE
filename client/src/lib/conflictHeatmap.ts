/**
 * conflictHeatmap.ts — Heatmap rendering utilities for conflict events on the globe
 *
 * Uses Three.js Points with additive blending and custom shader material
 * to render a density heatmap of conflict events on the globe surface.
 *
 * Enhanced for HDX HAPI centroid-clustered data:
 * - Multi-scale grid cells (0.5° inner + 2° outer) for smooth density gradients
 * - Fatality-weighted intensity with logarithmic scaling
 * - Heat diffusion: each cell also contributes to neighboring cells
 * - Improved color ramp: yellow → orange → red → magenta for high density
 */
import * as THREE from "three";
import type { SlimConflictEvent } from "@/components/ConflictOverlay";

const GLOBE_RADIUS = 5;

function latLngToVector3(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -(radius * Math.sin(phi) * Math.cos(theta)),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

// Vertex shader for heatmap points
const heatmapVertexShader = `
  attribute float size;
  attribute vec3 customColor;
  attribute float alpha;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vColor = customColor;
    vAlpha = alpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

// Fragment shader for heatmap points — soft radial gradient with smoother falloff
const heatmapFragmentShader = `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;

    // Smoother cubic falloff for more natural heat diffusion look
    float t = dist * 2.0; // normalize to 0-1
    float intensity = 1.0 - t * t * (3.0 - 2.0 * t); // smoothstep
    gl_FragColor = vec4(vColor, vAlpha * intensity);
  }
`;

// Color ramp for density: low → high
// yellow(0.0) → orange(0.3) → red(0.6) → magenta(0.9) → white-hot(1.0)
function densityColor(t: number): THREE.Color {
  t = Math.max(0, Math.min(1, t));
  if (t < 0.3) {
    // Yellow → Orange
    const s = t / 0.3;
    return new THREE.Color().setRGB(1.0, 1.0 - s * 0.35, 0.2 - s * 0.2);
  } else if (t < 0.6) {
    // Orange → Red
    const s = (t - 0.3) / 0.3;
    return new THREE.Color().setRGB(1.0, 0.65 - s * 0.45, s * 0.05);
  } else if (t < 0.9) {
    // Red → Magenta
    const s = (t - 0.6) / 0.3;
    return new THREE.Color().setRGB(1.0, 0.2 * s, 0.05 + s * 0.45);
  } else {
    // Magenta → White-hot
    const s = (t - 0.9) / 0.1;
    return new THREE.Color().setRGB(1.0, 0.2 + s * 0.6, 0.5 + s * 0.5);
  }
}

interface GridCell {
  lat: number;
  lng: number;
  count: number;
  fatalities: number;
  intensity: number; // combined weight
}

/**
 * Create a heatmap Points object from conflict events.
 * Uses multi-scale grid aggregation with heat diffusion for smooth density visualization.
 */
export function createConflictHeatmap(
  events: SlimConflictEvent[]
): THREE.Points | null {
  if (events.length === 0) return null;

  // ── Phase 1: Fine-grid aggregation (0.5° cells) ─────────────────
  const FINE_CELL = 0.5;
  const fineGrid = new Map<string, GridCell>();

  for (const evt of events) {
    const cellLat = Math.round(evt.lat / FINE_CELL) * FINE_CELL;
    const cellLng = Math.round(evt.lng / FINE_CELL) * FINE_CELL;
    const key = `${cellLat},${cellLng}`;
    const existing = fineGrid.get(key);
    if (existing) {
      existing.count++;
      existing.fatalities += evt.best;
    } else {
      fineGrid.set(key, {
        lat: cellLat,
        lng: cellLng,
        count: 1,
        fatalities: evt.best,
        intensity: 0,
      });
    }
  }

  // ── Phase 2: Compute intensity with logarithmic fatality weighting ──
  // Intensity = log2(count + 1) + log2(fatalities + 1) * 0.5
  for (const cell of Array.from(fineGrid.values())) {
    cell.intensity =
      Math.log2(cell.count + 1) + Math.log2(cell.fatalities + 1) * 0.5;
  }

  // ── Phase 3: Heat diffusion — spread intensity to neighbors ──────
  // Each cell contributes 25% of its intensity to its 8 neighbors
  const DIFFUSION_FACTOR = 0.25;
  const diffused = new Map<string, GridCell>();

  // Copy originals
  for (const [key, cell] of Array.from(fineGrid.entries())) {
    diffused.set(key, { ...cell });
  }

  // Add diffused contributions
  for (const cell of Array.from(fineGrid.values())) {
    const contribution = cell.intensity * DIFFUSION_FACTOR / 8;
    for (let dlat = -1; dlat <= 1; dlat++) {
      for (let dlng = -1; dlng <= 1; dlng++) {
        if (dlat === 0 && dlng === 0) continue;
        const nLat = cell.lat + dlat * FINE_CELL;
        const nLng = cell.lng + dlng * FINE_CELL;
        const nKey = `${nLat},${nLng}`;
        const existing = diffused.get(nKey);
        if (existing) {
          existing.intensity += contribution;
        } else {
          diffused.set(nKey, {
            lat: nLat,
            lng: nLng,
            count: 0,
            fatalities: 0,
            intensity: contribution,
          });
        }
      }
    }
  }

  // ── Phase 4: Build point cloud ───────────────────────────────────
  const cells = Array.from(diffused.values()).filter((c) => c.intensity > 0.01);
  if (cells.length === 0) return null;

  const maxIntensity = Math.max(...cells.map((c) => c.intensity), 1);

  const positions = new Float32Array(cells.length * 3);
  const colors = new Float32Array(cells.length * 3);
  const sizes = new Float32Array(cells.length);
  const alphas = new Float32Array(cells.length);

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const pos = latLngToVector3(cell.lat, cell.lng, GLOBE_RADIUS * 1.012);
    positions[i * 3] = pos.x;
    positions[i * 3 + 1] = pos.y;
    positions[i * 3 + 2] = pos.z;

    // Normalized intensity for color ramp
    const norm = cell.intensity / maxIntensity;

    // Color from density ramp
    const color = densityColor(norm);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;

    // Size: larger for higher density, with minimum for diffused cells
    const isOriginal = cell.count > 0;
    const baseSize = isOriginal ? 12 : 8;
    sizes[i] = baseSize + norm * 45; // 8-57 point size

    // Alpha: stronger for actual data cells, softer for diffused
    const baseAlpha = isOriginal ? 0.25 : 0.1;
    alphas[i] = baseAlpha + norm * 0.55; // up to 0.8
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("customColor", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("alpha", new THREE.BufferAttribute(alphas, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: heatmapVertexShader,
    fragmentShader: heatmapFragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: true,
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, material);
  points.name = "conflictHeatmap";

  return points;
}

/**
 * Dispose of a heatmap Points object and its resources.
 */
export function disposeConflictHeatmap(points: THREE.Points): void {
  points.geometry.dispose();
  if (points.material instanceof THREE.Material) {
    points.material.dispose();
  }
}
