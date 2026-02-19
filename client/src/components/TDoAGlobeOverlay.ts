/**
 * TDoAGlobeOverlay.ts — Three.js rendering helpers for TDoA visualization
 *
 * Provides functions to create and manage:
 * - GPS host markers (yellow = selected, blue = available TDoA hosts)
 * - Bearing lines from hosts to estimated position (great circles)
 * - Contour polygons from TDoA results
 * - "Most likely position" marker with pulsing animation
 */
import * as THREE from "three";

const GLOBE_RADIUS = 5;
const MARKER_HEIGHT = 0.02;

/* ── Coordinate Conversion ────────────────────────── */

export function latLngToVector3(
  lat: number,
  lng: number,
  radius: number = GLOBE_RADIUS
): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -(radius * Math.sin(phi) * Math.cos(theta)),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

/* ── TDoA Host Markers ───────────────────────────── */

export interface TdoaHostMarkerData {
  lat: number;
  lon: number;
  hostname: string;
  selected: boolean;
  status?: "idle" | "sampling" | "ok" | "failed" | "busy" | "no_gps";
}

const TDOA_SELECTED_COLOR = 0xfbbf24; // amber-400
const TDOA_AVAILABLE_COLOR = 0x60a5fa; // blue-400
const TDOA_SAMPLING_COLOR = 0xfbbf24; // yellow
const TDOA_OK_COLOR = 0x4ade80; // green
const TDOA_FAILED_COLOR = 0xef4444; // red

function getHostMarkerColor(marker: TdoaHostMarkerData): number {
  if (!marker.selected) return TDOA_AVAILABLE_COLOR;
  switch (marker.status) {
    case "ok":
      return TDOA_OK_COLOR;
    case "failed":
    case "busy":
    case "no_gps":
      return TDOA_FAILED_COLOR;
    case "sampling":
      return TDOA_SAMPLING_COLOR;
    default:
      return TDOA_SELECTED_COLOR;
  }
}

export function createTdoaHostMarkers(hosts: TdoaHostMarkerData[]): THREE.Group {
  const group = new THREE.Group();
  group.name = "tdoa-host-markers";

  for (const host of hosts) {
    const color = getHostMarkerColor(host);
    const size = host.selected ? 0.08 : 0.05;

    // Diamond-shaped marker (rotated square)
    const geometry = new THREE.CircleGeometry(size, 4);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: host.selected ? 0.95 : 0.6,
      side: THREE.DoubleSide,
      depthTest: false,
    });

    const mesh = new THREE.Mesh(geometry, material);
    const pos = latLngToVector3(host.lat, host.lon, GLOBE_RADIUS + MARKER_HEIGHT);
    mesh.position.copy(pos);
    mesh.lookAt(new THREE.Vector3(0, 0, 0));
    mesh.rotateZ(Math.PI / 4);
    mesh.userData = { hostname: host.hostname, type: "tdoa-host" };
    group.add(mesh);

    // Ring around selected hosts
    if (host.selected) {
      const ringGeometry = new THREE.RingGeometry(size * 1.3, size * 1.6, 16);
      const ringMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
        depthTest: false,
      });
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.position.copy(pos);
      ring.lookAt(new THREE.Vector3(0, 0, 0));
      ring.userData = { type: "tdoa-host-ring" };
      group.add(ring);
    }
  }

  return group;
}

/* ── Great Circle Bearing Lines ──────────────────── */

export function createBearingLines(
  hosts: { lat: number; lon: number }[],
  targetLat: number,
  targetLon: number,
  color: number = 0xc084fc
): THREE.Group {
  const group = new THREE.Group();
  group.name = "tdoa-bearing-lines";

  for (const host of hosts) {
    const line = createGreatCircleLine(
      host.lat,
      host.lon,
      targetLat,
      targetLon,
      color,
      0.6
    );
    group.add(line);
  }

  return group;
}

function createGreatCircleLine(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  color: number,
  opacity: number,
  segments: number = 64
): THREE.Line {
  const points: THREE.Vector3[] = [];
  const arcRadius = GLOBE_RADIUS + MARKER_HEIGHT;

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const { lat, lon } = interpolateGreatCircle(lat1, lon1, lat2, lon2, t);
    points.push(latLngToVector3(lat, lon, arcRadius));
  }

  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest: false,
  });

  return new THREE.Line(geometry, material);
}

function interpolateGreatCircle(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  t: number
): { lat: number; lon: number } {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;

  const phi1 = lat1 * toRad;
  const lam1 = lon1 * toRad;
  const phi2 = lat2 * toRad;
  const lam2 = lon2 * toRad;

  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((phi2 - phi1) / 2) ** 2 +
          Math.cos(phi1) * Math.cos(phi2) * Math.sin((lam2 - lam1) / 2) ** 2
      )
    );

  if (d < 1e-10) return { lat: lat1, lon: lon1 };

  const a = Math.sin((1 - t) * d) / Math.sin(d);
  const b = Math.sin(t * d) / Math.sin(d);

  const x = a * Math.cos(phi1) * Math.cos(lam1) + b * Math.cos(phi2) * Math.cos(lam2);
  const y = a * Math.cos(phi1) * Math.sin(lam1) + b * Math.cos(phi2) * Math.sin(lam2);
  const z = a * Math.sin(phi1) + b * Math.sin(phi2);

  return {
    lat: Math.atan2(z, Math.sqrt(x * x + y * y)) * toDeg,
    lon: Math.atan2(y, x) * toDeg,
  };
}

/* ── Target Position Marker ──────────────────────── */

export function createTargetMarker(lat: number, lon: number): THREE.Group {
  const group = new THREE.Group();
  group.name = "tdoa-target-marker";

  const pos = latLngToVector3(lat, lon, GLOBE_RADIUS + MARKER_HEIGHT);

  // Crosshair center
  const centerGeo = new THREE.CircleGeometry(0.04, 16);
  const centerMat = new THREE.MeshBasicMaterial({
    color: 0xf43f5e,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
    depthTest: false,
  });
  const center = new THREE.Mesh(centerGeo, centerMat);
  center.position.copy(pos);
  center.lookAt(new THREE.Vector3(0, 0, 0));
  group.add(center);

  // Outer ring
  const ringGeo = new THREE.RingGeometry(0.08, 0.1, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xf43f5e,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
    depthTest: false,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.copy(pos);
  ring.lookAt(new THREE.Vector3(0, 0, 0));
  ring.userData = { type: "tdoa-target-ring", baseOpacity: 0.7 };
  group.add(ring);

  // Pulse ring (animated externally)
  const pulseGeo = new THREE.RingGeometry(0.1, 0.12, 32);
  const pulseMat = new THREE.MeshBasicMaterial({
    color: 0xf43f5e,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
    depthTest: false,
  });
  const pulse = new THREE.Mesh(pulseGeo, pulseMat);
  pulse.position.copy(pos);
  pulse.lookAt(new THREE.Vector3(0, 0, 0));
  pulse.userData = { type: "tdoa-target-pulse", baseScale: 1 };
  group.add(pulse);

  return group;
}

/* ── Contour Polygons ────────────────────────────── */

export interface ContourData {
  imgBounds: { north: number; south: number; east: number; west: number };
  polygons: { lat: number; lng: number }[][];
  polygon_colors: string[];
  polylines: { lat: number; lng: number }[][];
  polyline_colors: string[];
}

export function createContourOverlay(contours: ContourData[]): THREE.Group {
  const group = new THREE.Group();
  group.name = "tdoa-contours";

  for (const contour of contours) {
    // Draw polylines (contour lines)
    for (let i = 0; i < contour.polylines.length; i++) {
      const polyline = contour.polylines[i];
      const colorStr = contour.polyline_colors[i] || "#c084fc";
      const color = new THREE.Color(colorStr);

      if (polyline.length < 2) continue;

      const points = polyline.map((p) =>
        latLngToVector3(p.lat, p.lng, GLOBE_RADIUS + MARKER_HEIGHT + 0.005)
      );

      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.7,
        depthTest: false,
      });

      group.add(new THREE.Line(geometry, material));
    }

    // Draw filled polygon regions (confidence/accuracy zones)
    // Outer polygons are more transparent, inner ones more opaque
    const totalPolygons = contour.polygons.length;
    for (let i = 0; i < totalPolygons; i++) {
      const polygon = contour.polygons[i];
      const colorStr = contour.polygon_colors[i] || "#c084fc";
      const color = new THREE.Color(colorStr);

      if (polygon.length < 3) continue;

      const r = GLOBE_RADIUS + MARKER_HEIGHT + 0.002 + i * 0.001;
      const points3D = polygon.map((p) =>
        latLngToVector3(p.lat, p.lng, r)
      );

      // --- Filled translucent polygon (accuracy region) ---
      // Use fan triangulation from centroid for convex-ish polygons on the sphere
      const centroid = new THREE.Vector3();
      points3D.forEach((p) => centroid.add(p));
      centroid.divideScalar(points3D.length);
      // Push centroid to the correct radius
      centroid.normalize().multiplyScalar(r);

      const positions: number[] = [];
      for (let j = 0; j < points3D.length; j++) {
        const a = points3D[j];
        const b = points3D[(j + 1) % points3D.length];
        positions.push(centroid.x, centroid.y, centroid.z);
        positions.push(a.x, a.y, a.z);
        positions.push(b.x, b.y, b.z);
      }

      const fillGeometry = new THREE.BufferGeometry();
      fillGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3)
      );
      fillGeometry.computeVertexNormals();

      // Opacity decreases for outer contours (index 0 = outermost)
      const fillOpacity = 0.08 + (i / Math.max(totalPolygons - 1, 1)) * 0.15;
      const fillMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: fillOpacity,
        side: THREE.DoubleSide,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      });

      const fillMesh = new THREE.Mesh(fillGeometry, fillMaterial);
      fillMesh.userData = { type: "tdoa-accuracy-region", contourIndex: i };
      group.add(fillMesh);

      // --- Polygon outline ---
      const linePoints = [...points3D, points3D[0]];
      const lineGeometry = new THREE.BufferGeometry().setFromPoints(linePoints);
      const lineOpacity = 0.3 + (i / Math.max(totalPolygons - 1, 1)) * 0.4;
      const lineMaterial = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: lineOpacity,
        depthTest: false,
      });
      group.add(new THREE.Line(lineGeometry, lineMaterial));
    }
  }

  return group;
}

/* ── Heatmap Texture Overlay ─────────────────────── */

/**
 * Creates a heatmap overlay on the globe surface from a TDoA result image.
 * The image is projected onto a spherical segment matching the imgBounds.
 */
export function createHeatmapOverlay(
  imageUrl: string,
  bounds: { north: number; south: number; east: number; west: number }
): THREE.Group {
  const group = new THREE.Group();
  group.name = "tdoa-heatmap";

  const loader = new THREE.TextureLoader();
  loader.load(
    imageUrl,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;

      // Create a spherical patch geometry matching the bounds
      const latRange = bounds.north - bounds.south;
      const lonRange = bounds.east - bounds.west;

      // Number of segments proportional to area
      const latSegs = Math.max(16, Math.round(latRange * 2));
      const lonSegs = Math.max(16, Math.round(lonRange * 2));

      const positions: number[] = [];
      const uvs: number[] = [];
      const indices: number[] = [];
      const r = GLOBE_RADIUS + MARKER_HEIGHT + 0.008;

      for (let j = 0; j <= latSegs; j++) {
        for (let i = 0; i <= lonSegs; i++) {
          const u = i / lonSegs;
          const v = j / latSegs;

          const lat = bounds.north - v * latRange;
          const lon = bounds.west + u * lonRange;

          const pos = latLngToVector3(lat, lon, r);
          positions.push(pos.x, pos.y, pos.z);
          uvs.push(u, v);
        }
      }

      for (let j = 0; j < latSegs; j++) {
        for (let i = 0; i < lonSegs; i++) {
          const a = j * (lonSegs + 1) + i;
          const b = a + 1;
          const c = (j + 1) * (lonSegs + 1) + i;
          const d = c + 1;
          indices.push(a, b, c);
          indices.push(b, d, c);
        }
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();

      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData = { type: "tdoa-heatmap-mesh" };
      group.add(mesh);
    },
    undefined,
    (err) => {
      console.warn("[TDoA] Failed to load heatmap texture:", err);
    }
  );

  return group;
}

/* ── Animation Update ────────────────────────────── */

export function updateTdoaAnimations(group: THREE.Group, elapsedTime: number): void {
  group.traverse((child) => {
    if (child.userData.type === "tdoa-target-pulse") {
      const scale = 1 + Math.sin(elapsedTime * 3) * 0.3;
      child.scale.set(scale, scale, 1);
      if (child instanceof THREE.Mesh) {
        (child.material as THREE.MeshBasicMaterial).opacity =
          0.5 - Math.sin(elapsedTime * 3) * 0.3;
      }
    }
    if (child.userData.type === "tdoa-target-ring") {
      if (child instanceof THREE.Mesh) {
        (child.material as THREE.MeshBasicMaterial).opacity =
          0.5 + Math.sin(elapsedTime * 2) * 0.2;
      }
    }
    if (child.userData.type === "tdoa-host-ring") {
      if (child instanceof THREE.Mesh) {
        (child.material as THREE.MeshBasicMaterial).opacity =
          0.3 + Math.sin(elapsedTime * 4) * 0.15;
      }
    }
  });
}

/* ── Cleanup ─────────────────────────────────────── */

export function disposeTdoaGroup(group: THREE.Group): void {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      if (child.material instanceof THREE.Material) {
        child.material.dispose();
      }
    }
    if (child instanceof THREE.Line) {
      child.geometry.dispose();
      if (child.material instanceof THREE.Material) {
        child.material.dispose();
      }
    }
  });
  group.clear();
}


/* ── Saved Target Markers (Multi-Target Tracking) ── */

export interface SavedTargetData {
  id: number;
  label: string;
  lat: number;
  lon: number;
  color: string;
  frequencyKhz?: number | null;
}

/**
 * Creates markers for all saved/visible TDoA targets on the globe.
 * Each target gets:
 * - A colored circle marker
 * - A pulsing outer ring
 * - A label sprite (text rendered via canvas)
 */
export function createSavedTargetMarkers(targets: SavedTargetData[]): THREE.Group {
  const group = new THREE.Group();
  group.name = "tdoa-saved-targets";

  for (const target of targets) {
    const color = new THREE.Color(target.color);
    const pos = latLngToVector3(target.lat, target.lon, GLOBE_RADIUS + MARKER_HEIGHT + 0.001);

    // Center dot
    const dotGeo = new THREE.CircleGeometry(0.045, 16);
    const dotMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthTest: false,
    });
    const dot = new THREE.Mesh(dotGeo, dotMat);
    dot.position.copy(pos);
    dot.lookAt(new THREE.Vector3(0, 0, 0));
    dot.userData = { type: "saved-target-dot", targetId: target.id };
    group.add(dot);

    // Outer ring
    const ringGeo = new THREE.RingGeometry(0.065, 0.08, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthTest: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.copy(pos);
    ring.lookAt(new THREE.Vector3(0, 0, 0));
    ring.userData = { type: "saved-target-ring", targetId: target.id, baseOpacity: 0.5 };
    group.add(ring);

    // Pulse ring (animated)
    const pulseGeo = new THREE.RingGeometry(0.09, 0.1, 24);
    const pulseMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      depthTest: false,
    });
    const pulse = new THREE.Mesh(pulseGeo, pulseMat);
    pulse.position.copy(pos);
    pulse.lookAt(new THREE.Vector3(0, 0, 0));
    pulse.userData = { type: "saved-target-pulse", targetId: target.id, baseScale: 1 };
    group.add(pulse);

    // Label sprite (canvas-rendered text)
    const labelSprite = createLabelSprite(
      target.label,
      target.color,
      target.frequencyKhz
    );
    // Position label slightly above and to the right of the marker
    const labelPos = latLngToVector3(
      target.lat,
      target.lon,
      GLOBE_RADIUS + MARKER_HEIGHT + 0.12
    );
    labelSprite.position.copy(labelPos);
    labelSprite.userData = { type: "saved-target-label", targetId: target.id };
    group.add(labelSprite);
  }

  return group;
}

/**
 * Creates a text label sprite using a canvas texture.
 * Renders the target name and optional frequency.
 */
function createLabelSprite(
  label: string,
  color: string,
  frequencyKhz?: number | null
): THREE.Sprite {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;

  canvas.width = 256;
  canvas.height = 64;

  // Background
  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  const radius = 6;
  const w = canvas.width;
  const h = canvas.height;
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(w - radius, 0);
  ctx.quadraticCurveTo(w, 0, w, radius);
  ctx.lineTo(w, h - radius);
  ctx.quadraticCurveTo(w, h, w - radius, h);
  ctx.lineTo(radius, h);
  ctx.quadraticCurveTo(0, h, 0, h - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.closePath();
  ctx.fill();

  // Border
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Label text
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 20px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const displayText = frequencyKhz
    ? `${label} · ${frequencyKhz} kHz`
    : label;

  // Truncate if too long
  const maxChars = 24;
  const truncated =
    displayText.length > maxChars
      ? displayText.slice(0, maxChars - 1) + "…"
      : displayText;

  ctx.fillText(truncated, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
    sizeAttenuation: true,
  });

  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.6, 0.15, 1);

  return sprite;
}

/**
 * Update animations for saved target markers (pulse effect).
 * Called from the main animation loop alongside other TDoA animations.
 */
export function updateSavedTargetAnimations(group: THREE.Group, elapsedTime: number): void {
  group.traverse((child) => {
    if (child.userData.type === "saved-target-pulse") {
      const scale = 1 + Math.sin(elapsedTime * 2.5 + (child.userData.targetId || 0) * 0.7) * 0.25;
      child.scale.set(scale, scale, 1);
      if (child instanceof THREE.Mesh) {
        (child.material as THREE.MeshBasicMaterial).opacity =
          0.3 - Math.sin(elapsedTime * 2.5 + (child.userData.targetId || 0) * 0.7) * 0.2;
      }
    }
    if (child.userData.type === "saved-target-ring") {
      if (child instanceof THREE.Mesh) {
        (child.material as THREE.MeshBasicMaterial).opacity =
          0.4 + Math.sin(elapsedTime * 1.8 + (child.userData.targetId || 0) * 0.5) * 0.15;
      }
    }
  });
}


/* ── Drift Trail Visualization ───────────────────── */

export interface DriftTrailEntry {
  targetId: number;
  lat: number;
  lon: number;
  observedAt: number;
}

/**
 * Creates drift trail lines on the globe for targets that have position history.
 * Each trail is a series of connected line segments following the great-circle path
 * between consecutive observations, colored by the target's color.
 *
 * @param historyByTarget Map of targetId -> sorted history entries
 * @param targetColors Map of targetId -> hex color string
 */
/**
 * Helper: generate multiple intermediate points along a great circle.
 * Uses the existing single-point interpolateGreatCircle internally.
 */
function interpolateGreatCircleMulti(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
  numPoints: number
): Array<{ lat: number; lon: number }> {
  const points: Array<{ lat: number; lon: number }> = [];
  for (let i = 1; i <= numPoints; i++) {
    const t = i / (numPoints + 1);
    points.push(interpolateGreatCircle(lat1, lon1, lat2, lon2, t));
  }
  return points;
}

export function createDriftTrails(
  historyByTarget: Map<number, DriftTrailEntry[]>,
  targetColors: Map<number, string>
): THREE.Group {
  const group = new THREE.Group();
  group.name = "tdoa-drift-trails";

  const targetIds = Array.from(historyByTarget.keys());
  for (const targetId of targetIds) {
    const entries = historyByTarget.get(targetId)!;
    if (entries.length < 2) continue;

    const hexColor = targetColors.get(targetId) || "#a78bfa";
    const color = new THREE.Color(hexColor);

    // Create the trail line connecting all history points
    const trailPoints: THREE.Vector3[] = [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const pos = latLngToVector3(entry.lat, entry.lon, GLOBE_RADIUS + MARKER_HEIGHT + 0.003);
      trailPoints.push(pos);

      // Add interpolated points between consecutive entries for smooth great-circle arcs
      if (i < entries.length - 1) {
        const next = entries[i + 1];
        const midPoints = interpolateGreatCircleMulti(
          entry.lat, entry.lon,
          next.lat, next.lon,
          8
        );
        for (let j = 0; j < midPoints.length; j++) {
          trailPoints.push(latLngToVector3(midPoints[j].lat, midPoints[j].lon, GLOBE_RADIUS + MARKER_HEIGHT + 0.003));
        }
      }
    }

    // Create the trail line with gradient opacity (older = more transparent)
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(trailPoints);
    const lineMaterial = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.6,
      depthTest: false,
      linewidth: 1,
    });
    const line = new THREE.Line(lineGeometry, lineMaterial);
    line.userData = { type: "drift-trail-line", targetId };
    group.add(line);

    // Add small dots at each observation point
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const pos = latLngToVector3(entry.lat, entry.lon, GLOBE_RADIUS + MARKER_HEIGHT + 0.004);

      // Older points are smaller and more transparent
      const age = i / (entries.length - 1); // 0 = oldest, 1 = newest
      const dotSize = 0.012 + age * 0.018;
      const dotOpacity = 0.3 + age * 0.5;

      const dotGeo = new THREE.CircleGeometry(dotSize, 12);
      const dotMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: dotOpacity,
        side: THREE.DoubleSide,
        depthTest: false,
      });
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.copy(pos);
      dot.lookAt(new THREE.Vector3(0, 0, 0));
      dot.userData = {
        type: "drift-trail-dot",
        targetId,
        entryIndex: i,
        isNewest: i === entries.length - 1,
      };
      group.add(dot);

      // Add a timestamp label for the newest point
      if (i === entries.length - 1 && entries.length > 1) {
        const arrowGeo = new THREE.ConeGeometry(0.015, 0.04, 6);
        const arrowMat = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.7,
          depthTest: false,
        });
        const arrow = new THREE.Mesh(arrowGeo, arrowMat);
        arrow.position.copy(pos);
        // Orient arrow to point outward from globe
        arrow.lookAt(new THREE.Vector3(0, 0, 0));
        arrow.rotateX(Math.PI);
        arrow.userData = { type: "drift-trail-arrow", targetId };
        group.add(arrow);
      }
    }

    // Add a dashed line from first to last point (direct path)
    if (entries.length >= 3) {
      const firstPos = latLngToVector3(
        entries[0].lat, entries[0].lon,
        GLOBE_RADIUS + MARKER_HEIGHT + 0.002
      );
      const lastPos = latLngToVector3(
        entries[entries.length - 1].lat, entries[entries.length - 1].lon,
        GLOBE_RADIUS + MARKER_HEIGHT + 0.002
      );

      const directMidPoints = interpolateGreatCircleMulti(
        entries[0].lat, entries[0].lon,
        entries[entries.length - 1].lat, entries[entries.length - 1].lon,
        12
      );
      const directPoints = [firstPos];
      for (let j = 0; j < directMidPoints.length; j++) {
        directPoints.push(latLngToVector3(directMidPoints[j].lat, directMidPoints[j].lon, GLOBE_RADIUS + MARKER_HEIGHT + 0.002));
      }
      directPoints.push(lastPos);

      const dashedGeo = new THREE.BufferGeometry().setFromPoints(directPoints);
      const dashedMat = new THREE.LineDashedMaterial({
        color,
        transparent: true,
        opacity: 0.25,
        dashSize: 0.03,
        gapSize: 0.02,
        depthTest: false,
      });
      const dashedLine = new THREE.Line(dashedGeo, dashedMat);
      dashedLine.computeLineDistances();
      dashedLine.userData = { type: "drift-trail-direct", targetId };
      group.add(dashedLine);
    }
  }

  return group;
}

/**
 * Animate drift trail elements (pulse the newest dot, fade trail lines).
 */
export function updateDriftTrailAnimations(group: THREE.Group, elapsedTime: number): void {
  group.traverse((child) => {
    if (child.userData.type === "drift-trail-dot" && child.userData.isNewest) {
      if (child instanceof THREE.Mesh) {
        const scale = 1 + Math.sin(elapsedTime * 3) * 0.3;
        child.scale.set(scale, scale, 1);
      }
    }
    if (child.userData.type === "drift-trail-arrow") {
      if (child instanceof THREE.Mesh) {
        (child.material as THREE.MeshBasicMaterial).opacity =
          0.5 + Math.sin(elapsedTime * 2) * 0.2;
      }
    }
  });
}


/* ── Prediction Ellipse Rendering ──────────────────── */

export interface PredictionData {
  targetId: number;
  predictedLat: number;
  predictedLon: number;
  ellipseMajor: number; // degrees
  ellipseMinor: number; // degrees
  ellipseRotation: number; // degrees
  color: string;
  label: string;
  rSquaredLat: number;
  rSquaredLon: number;
  bearingDeg: number;
  velocityKmh: number;
}

/**
 * Create prediction zone markers on the globe:
 * - A crosshair marker at the predicted position
 * - A confidence ellipse rendered as a ring of points on the globe surface
 * - A bearing arrow showing predicted direction of movement
 */
export function createPredictionMarkers(
  group: THREE.Group,
  predictions: PredictionData[]
): void {
  // Clear existing prediction markers
  const toRemove: THREE.Object3D[] = [];
  group.traverse((child) => {
    if (child.userData.type?.startsWith("prediction-")) {
      toRemove.push(child);
    }
  });
  toRemove.forEach((obj) => {
    if (obj.parent) obj.parent.remove(obj);
    if ((obj as any).geometry) (obj as any).geometry.dispose();
    if ((obj as any).material) (obj as any).material.dispose();
  });

  for (const pred of predictions) {
    const color = new THREE.Color(pred.color);
    const avgR2 = (pred.rSquaredLat + pred.rSquaredLon) / 2;

    // 1. Predicted position marker (diamond shape)
    const diamondGeo = new THREE.CircleGeometry(0.04, 4);
    const diamondMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthTest: false,
    });
    const diamond = new THREE.Mesh(diamondGeo, diamondMat);
    const pos = latLngToVector3(pred.predictedLat, pred.predictedLon, GLOBE_RADIUS + 0.015);
    diamond.position.copy(pos);
    diamond.lookAt(pos.clone().multiplyScalar(2));
    diamond.rotation.z = Math.PI / 4; // Rotate to diamond shape
    diamond.userData = { type: "prediction-diamond", targetId: pred.targetId };
    diamond.renderOrder = 15;
    group.add(diamond);

    // 2. Outer ring for diamond
    const ringGeo = new THREE.RingGeometry(0.035, 0.05, 4);
    const ringMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthTest: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.copy(pos);
    ring.lookAt(pos.clone().multiplyScalar(2));
    ring.rotation.z = Math.PI / 4;
    ring.userData = { type: "prediction-ring", targetId: pred.targetId };
    ring.renderOrder = 14;
    group.add(ring);

    // 3. Confidence ellipse — rendered as a closed curve on the globe surface
    const ellipseSegments = 64;
    const ellipsePoints: THREE.Vector3[] = [];
    const rotRad = (pred.ellipseRotation * Math.PI) / 180;

    for (let i = 0; i <= ellipseSegments; i++) {
      const angle = (i / ellipseSegments) * Math.PI * 2;

      // Ellipse in local lat/lon space
      const localLat = pred.ellipseMajor * Math.cos(angle);
      const localLon = pred.ellipseMinor * Math.sin(angle);

      // Apply rotation
      const rotLat = localLat * Math.cos(rotRad) - localLon * Math.sin(rotRad);
      const rotLon = localLat * Math.sin(rotRad) + localLon * Math.cos(rotRad);

      // Convert to globe coordinates
      const eLat = pred.predictedLat + rotLat;
      const eLon = pred.predictedLon + rotLon;

      // Clamp
      const clampedLat = Math.max(-89.9, Math.min(89.9, eLat));
      const clampedLon = ((eLon + 180) % 360) - 180;

      ellipsePoints.push(
        latLngToVector3(clampedLat, clampedLon, GLOBE_RADIUS + 0.008)
      );
    }

    // Ellipse outline
    const ellipseGeo = new THREE.BufferGeometry().setFromPoints(ellipsePoints);
    const ellipseMat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.6,
      depthTest: false,
    });
    const ellipseLine = new THREE.Line(ellipseGeo, ellipseMat);
    ellipseLine.userData = { type: "prediction-ellipse", targetId: pred.targetId };
    ellipseLine.renderOrder = 12;
    group.add(ellipseLine);

    // Dashed fill lines (cross-hatch inside ellipse for visual weight)
    const dashCount = 8;
    for (let d = 0; d < dashCount; d++) {
      const t = (d + 1) / (dashCount + 1);
      const scale = t;
      const innerPoints: THREE.Vector3[] = [];

      for (let i = 0; i <= 32; i++) {
        const angle = (i / 32) * Math.PI * 2;
        const localLat = pred.ellipseMajor * scale * Math.cos(angle);
        const localLon = pred.ellipseMinor * scale * Math.sin(angle);
        const rotLat = localLat * Math.cos(rotRad) - localLon * Math.sin(rotRad);
        const rotLon = localLat * Math.sin(rotRad) + localLon * Math.cos(rotRad);
        const eLat = Math.max(-89.9, Math.min(89.9, pred.predictedLat + rotLat));
        const eLon = ((pred.predictedLon + rotLon + 180) % 360) - 180;
        innerPoints.push(latLngToVector3(eLat, eLon, GLOBE_RADIUS + 0.006));
      }

      const innerGeo = new THREE.BufferGeometry().setFromPoints(innerPoints);
      const innerMat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.08 + (1 - t) * 0.12,
        depthTest: false,
      });
      const innerLine = new THREE.Line(innerGeo, innerMat);
      innerLine.userData = { type: "prediction-inner-ring", targetId: pred.targetId };
      innerLine.renderOrder = 11;
      group.add(innerLine);
    }

    // 4. Bearing arrow (direction of predicted movement)
    if (pred.velocityKmh > 0.1) {
      // Arrow extends from predicted position in the bearing direction
      const arrowLength = Math.min(pred.ellipseMajor * 1.5, 5); // degrees
      const bearingRad = (pred.bearingDeg * Math.PI) / 180;

      const arrowEndLat = pred.predictedLat + arrowLength * Math.cos(bearingRad);
      const arrowEndLon =
        pred.predictedLon +
        (arrowLength * Math.sin(bearingRad)) /
          Math.cos((pred.predictedLat * Math.PI) / 180);

      const arrowSegments = 16;
      const arrowVecs: THREE.Vector3[] = [];
      const clampedArrowEndLat = Math.max(-89.9, Math.min(89.9, arrowEndLat));
      const clampedArrowEndLon = ((arrowEndLon + 180) % 360) - 180;
      for (let s = 0; s <= arrowSegments; s++) {
        const t = s / arrowSegments;
        const pt = interpolateGreatCircle(
          pred.predictedLat,
          pred.predictedLon,
          clampedArrowEndLat,
          clampedArrowEndLon,
          t
        );
        arrowVecs.push(latLngToVector3(pt.lat, pt.lon, GLOBE_RADIUS + 0.01));
      }

      const arrowGeo = new THREE.BufferGeometry().setFromPoints(arrowVecs);
      const arrowMat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.5,
        depthTest: false,
      });
      const arrowLine = new THREE.Line(arrowGeo, arrowMat);
      arrowLine.userData = { type: "prediction-arrow", targetId: pred.targetId };
      arrowLine.renderOrder = 13;
      group.add(arrowLine);

      // Arrowhead
      if (arrowVecs.length >= 2) {
        const tip = arrowVecs[arrowVecs.length - 1];
        const headGeo = new THREE.CircleGeometry(0.025, 3);
        const headMat = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.6,
          side: THREE.DoubleSide,
          depthTest: false,
        });
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.copy(tip);
        head.lookAt(tip.clone().multiplyScalar(2));
        head.userData = { type: "prediction-arrowhead", targetId: pred.targetId };
        head.renderOrder = 13;
        group.add(head);
      }
    }
  }
}

/**
 * Animate prediction markers (pulse diamond, rotate ring).
 */
export function updatePredictionAnimations(group: THREE.Group, elapsedTime: number): void {
  group.traverse((child) => {
    if (child.userData.type === "prediction-diamond") {
      if (child instanceof THREE.Mesh) {
        const scale = 1 + Math.sin(elapsedTime * 2.5) * 0.25;
        child.scale.set(scale, scale, 1);
      }
    }
    if (child.userData.type === "prediction-ring") {
      if (child instanceof THREE.Mesh) {
        const scale = 1 + Math.sin(elapsedTime * 2.5 + Math.PI) * 0.2;
        child.scale.set(scale, scale, 1);
        (child.material as THREE.MeshBasicMaterial).opacity =
          0.3 + Math.sin(elapsedTime * 2) * 0.15;
      }
    }
    if (child.userData.type === "prediction-ellipse") {
      if (child instanceof THREE.Line) {
        (child.material as THREE.LineBasicMaterial).opacity =
          0.4 + Math.sin(elapsedTime * 1.5) * 0.2;
      }
    }
  });
}
