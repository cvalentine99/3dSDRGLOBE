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

    // Draw polygon outlines (probability zones)
    for (let i = 0; i < contour.polygons.length; i++) {
      const polygon = contour.polygons[i];
      const colorStr = contour.polygon_colors[i] || "#c084fc";
      const color = new THREE.Color(colorStr);

      if (polygon.length < 3) continue;

      const points3D = polygon.map((p) =>
        latLngToVector3(p.lat, p.lng, GLOBE_RADIUS + MARKER_HEIGHT + 0.003)
      );

      const linePoints = [...points3D, points3D[0]]; // Close the loop
      const lineGeometry = new THREE.BufferGeometry().setFromPoints(linePoints);
      const lineMaterial = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.5,
        depthTest: false,
      });
      group.add(new THREE.Line(lineGeometry, lineMaterial));
    }
  }

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
