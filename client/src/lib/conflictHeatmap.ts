/**
 * conflictHeatmap.ts — Heatmap rendering utilities for conflict events on the globe
 *
 * Uses Three.js Points with additive blending and custom shader material
 * to render a density heatmap of conflict events on the globe surface.
 */
import * as THREE from "three";
import type { SlimConflictEvent } from "@/components/ConflictOverlay";
import { VIOLENCE_TYPE_COLORS } from "@/components/ConflictOverlay";

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

// Fragment shader for heatmap points — soft radial gradient
const heatmapFragmentShader = `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;

    // Soft gaussian falloff
    float intensity = exp(-8.0 * dist * dist);
    gl_FragColor = vec4(vColor, vAlpha * intensity);
  }
`;

/**
 * Create a heatmap Points object from conflict events.
 * Each event becomes a point with size proportional to fatalities
 * and color based on violence type.
 */
export function createConflictHeatmap(
  events: SlimConflictEvent[]
): THREE.Points | null {
  if (events.length === 0) return null;

  // Aggregate events into grid cells for density calculation
  const CELL_SIZE = 1.0; // 1 degree cells
  const densityGrid = new Map<string, { lat: number; lng: number; count: number; fatalities: number; dominantType: number; typeCounts: Record<number, number> }>();

  for (const evt of events) {
    const cellKey = `${Math.round(evt.lat / CELL_SIZE)},${Math.round(evt.lng / CELL_SIZE)}`;
    const existing = densityGrid.get(cellKey);
    if (existing) {
      existing.count++;
      existing.fatalities += evt.best;
      existing.typeCounts[evt.type] = (existing.typeCounts[evt.type] ?? 0) + 1;
      // Update dominant type
      let maxCount = 0;
      for (const [type, count] of Object.entries(existing.typeCounts)) {
        if (count > maxCount) {
          maxCount = count;
          existing.dominantType = Number(type);
        }
      }
    } else {
      densityGrid.set(cellKey, {
        lat: Math.round(evt.lat / CELL_SIZE) * CELL_SIZE,
        lng: Math.round(evt.lng / CELL_SIZE) * CELL_SIZE,
        count: 1,
        fatalities: evt.best,
        dominantType: evt.type,
        typeCounts: { [evt.type]: 1 },
      });
    }
  }

  const cells = Array.from(densityGrid.values());
  const maxCount = Math.max(...cells.map((c) => c.count), 1);

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

    // Color based on dominant violence type
    const colorHex = VIOLENCE_TYPE_COLORS[cell.dominantType] ?? "#ef4444";
    const color = new THREE.Color(colorHex);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;

    // Size based on event density (normalized)
    const densityNorm = cell.count / maxCount;
    sizes[i] = 8 + densityNorm * 40; // 8-48 point size

    // Alpha based on density
    alphas[i] = 0.2 + densityNorm * 0.6; // 0.2-0.8
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
