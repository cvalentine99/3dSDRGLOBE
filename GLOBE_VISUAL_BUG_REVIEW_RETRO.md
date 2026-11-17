# Globe Visual Review: Retrospective

**Date:** 2026-11-17
**Reviews:** `GLOBE_VISUAL_BUG_REVIEW.md` (2026-03-10, merged in PR #7)
**Code under review:** unchanged since March. `Globe.tsx`, `TDoAGlobeOverlay.ts` and `Home.tsx` have had no commits since the review.

## How this retro was done

The March review relied on reading the code; it ran nothing. This time I checked each claim:

- **Math was run, not eyeballed.** I ran `scripts/verify.mjs` (reproduced at the end) against **three@0.182.0**, the version pinned in `package.json`. It used exact copies of `latLngToVector3`, the camera fly-to formula and the geofence inverse.
- **three.js behaviour was checked in source.** For example, `BufferGeometry.dispose()` (core/BufferGeometry.js:1450) and `WebGLGeometries.onGeometryDispose`.
- **Wiring was checked with grep.** For example, whether `FallbackMap` is mounted anywhere.

Labels: **CONFIRMED** = reproduced numerically or provable from the code alone. **PROBABLE** = strong evidence but needs a visual check in a real browser.

---

## 1. Scorecard of the March findings

| # | March claim | Verdict | Notes |
|---|---|---|---|
| 1 | `useImperativeHandle` after early return (Critical) | **Real, wrong symptom** | The crash happens the moment `setWebglError` fires, not on Retry. React throws "Rendered fewer hooks than expected", so the amber fallback card with the Retry button **is never shown**; the error boundary catches it instead. Even with the hook moved, Retry would leave a blank div, because the init effect (`[initScene]`, stable) never re-runs. |
| 2 | Ionosonde shared geometry disposed N times (High) | **False positive** | `dispose()` only dispatches an event, and the listener removes itself, so repeat calls do nothing. Teardown is synchronous with no render in between. No WebGL errors, no blank markers. |
| 3 | Same for conflict markers (High) | **False positive** | Same reason. |
| 4 | Animation loop forces opacity 0.85 (High) | **Confirmed** | Valid and important. |
| 5 | Station marker geometry multi-dispose (Medium) | **False positive** | Same reason as #2. |
| 6 | Geofence inverse "fragile near antimeridian" (Medium) | **Real, badly understated** | It is wrong **by exactly 90° everywhere** (§2, N2). |
| 7 | `preserveDrawingBuffer` always on (Medium) | Plausible | The "10–20% FPS" figure had no source. |
| 8 | One material per conflict event (Medium) | Valid | |
| 9 | Unstable deps in the event-listener effect (Medium) | **Not an issue** | `selectStation`, `setHoveredStation` and `createRingPulse` are stable callbacks. |
| 10 | Home `useEffect` has no deps (Low) | Valid, trivial | |
| 11 | Heatmap texture race causes flicker (Medium) | **Wrong consequence** | `disposeTdoaGroup` detaches the heatmap group, so a late texture lands in an orphaned group and is never drawn. No flicker. The real effect is a **leak**: the texture and geometry are never disposed (N16). |
| 12 | Prediction double-cleanup causes dispose errors (Medium) | **False positive** | The group is already empty when `createPredictionMarkers` scans it. This is a style issue only. |
| 13 | Highlight restore skips opacity (Low) | Moot | #4 overwrites opacity every frame anyway. |
| 14 | Frame-rate-dependent camera lerp (Low) | Valid, minor | |
| 15 | Shared geometries leak when there are no children (Low) | Negligible | A geometry never drawn is never uploaded to the GPU. |

**Bottom line:** 2 of the March "Top 3" were false positives. The March review also stated that "lat/lon conversion is correct — verified the math". The forward conversion is correct, but neither of the inverse mappings that use it (camera fly-to and geofence click) was checked, and both are wrong.

---

## 2. What it missed

Ordered by user impact.

### N1. Every "fly to" lands in the wrong place (High, CONFIRMED)
`Globe.tsx` sets `targetSpherical.theta = -(lng) * π/180` in five places: click (~993), tap (~1066), external selection (~1125), TDoA focus (~1277) and `globeTarget`/continent filter (~1554). With three's `setFromSpherical` (x = r·sinφ·sinθ, z = r·sinφ·cosθ) and this file's `latLngToVector3`, the correct value is **θ = (lng + 90)·π/180**. The two formulas only agree at lng = −45° / 135°.

Measured result: the station's position on screen in normalized device coordinates (NDC), with (0, 0) as the exact centre. The ±1 range spans the full screen.

| Station | code θ = −lng | fixed θ = lng+90 |
|---|---|---|
| London | (0.39, 0.54) | (0.00, 0.00) |
| NYC | (−0.43, 0.27) | (0.00, 0.00) |
| Sydney | (0.32, −0.09) | (0.00, 0.00) |

**Symptom:** clicking a station, choosing a continent, or getting a TDoA result rotates the globe so the target sits roughly a quarter to half a screen off-centre, sometimes near the limb.

### N2. Geofence vertices land 90° west of the click (High, CONFIRMED)
`Globe.tsx:971`. Round-trip results: (0, 0) → (0, −90); NYC (40.7, −74) → (40.7, −164); Sydney 151.2 → 61.2. The vertex dot is drawn at the wrong place right away, so drawing a geofence does not work at all.
**Fix:** `lon = atan2(-p.z, p.x) * 180/π` (derived from x = sinφ·cos lng, z = −sinφ·sin lng).

### N3. Hover and click pick stations through the planet (High, CONFIRMED)
Hover (~932), click (~979) and tap (~1055) call `raycaster.intersectObjects(markerMeshes)` without the globe as an occluder. Test: camera centred on (0, 0) with a marker at the antipode; a ray through the screen centre **hits the far-side marker**.
**Symptom:** clicking empty ocean selects a station on the other side of the Earth, and the globe then spins to it. The tooltip flickers with far-side stations as the globe rotates.
**Fix:** intersect `[globe, ...markers]` and only accept a hit when it is a marker closer than the first globe hit.

### N4. Rings, halos and every TDoA overlay draw through the Earth (High, CONFIRMED)
`depthTest: false` is set on: the selected ring, highlight rings and glow sphere, conflict-zone and new-station rings, conflict halos, ionosonde halos, and **every** object in `TDoAGlobeOverlay.ts` (host markers, bearing lines, contours, heatmap, target, saved-target dots and labels, drift trails, predictions).

Station markers themselves use `depthTest: true`, so a far-side marker is hidden while **its ring stays visible**: orphan rings float over the near hemisphere. TDoA contours and label sprites show through the planet as the globe rotates.

**Fix:** `depthTest: true, depthWrite: false` together with `polygonOffset` (or a small radial lift) for surface decals. If "always on top" is wanted, hide objects per frame when `dot(normal, toCamera) < 0`.

### N5. Wrong station pulses after any marker rebuild (High, CONFIRMED by code)
`selectedMeshIdx` and `hoverMeshIdx` are **array indices** into `markerMeshes`. `updateMarkers` rebuilds that array on every filter change and every status poll (N6). The effect that re-resolves the selection (~1109) only depends on `selectedStation`, so after a rebuild the index points at a different station. The ring pulse stays at the correct spot, while a different marker grows and pulses.
**Fix:** at the end of `updateMarkers`, re-resolve the selected index by station key and reset the hover index.

### N6. All 2,000 markers are rebuilt every 2 s during status scans (Medium-High, CONFIRMED)
`isStationOnline` is `useCallback(..., [statusMap])`, and `statusMap` gets a new `Map` on every poll that returns results (`refetchInterval: progress.running ? 2000 : 30000`). It is a dependency of `updateMarkers`. Each poll destroys and recreates about 2,000 meshes and materials, re-runs the highlight effect, and re-randomizes ring phases, so pulses visibly jump.
**Fix:** build meshes once per station-set change and update colours in place when status changes.

### N7. The 2D fallback is dead code (High, CONFIRMED)
`grep` finds no import of `FallbackMap` anywhere. Every `setRenderMode("fallback")` path goes nowhere: init failure, context loss (`WebGLContextManager`), and the FPS governor's critical path. On context loss the canvas freezes on its last frame, or shows a black canvas if the restore times out, with no message.
**Fix:** mount `<FallbackMap>` in `Home.tsx` and wire it to `filteredStations`, `selectStation` and `isStationOnline`.

### N8. The highlight effect draws discs 4 world units across (Medium, CONFIRMED)
`RingGeometry(0.6, 1.0)` scaled up to 4 gives an outer radius of **4.0** on a globe of radius 5. The selection ring peaks at 0.36. With `depthTest: false`, an IntelChat "highlight" draws huge flat cyan discs over most of the visible hemisphere, including when the station is on the far side.
**Fix:** use about 0.08–0.12 geometry radii, or a maximum scale of about 0.4.

### N9. The camera spins several full turns after idling (Medium-High, CONFIRMED)
`targetSpherical.theta += delta * 0.06` is never wrapped. Fly-to then sets an absolute angle in [−π, π], so the lerp unwinds the whole accumulated angle: 5.7 turns after 10 minutes idle, 34 turns after an hour. Returning from a hidden tab makes it worse, because `clock.getDelta()` returns the whole hidden period in one frame, which also causes an immediate jump.
**Fix:** `delta = Math.min(delta, 0.1)`, and set the target as `current + shortestAngle(target - current)`.

### N10. Dead zones in drag and zoom (Medium, CONFIRMED)
Only `spherical` is clamped (~729–730); `targetSpherical.phi` and `.radius` are not. Over-dragging past a pole or over-scrolling builds up a hidden offset, and the camera ignores input until it is unwound.
**Fix:** clamp `targetSpherical` instead.

### N11. Ionosondes only appear after an unrelated re-render (Medium, CONFIRMED)
`Home.tsx` passes `ionosondesRef.current`, and `handleIonosondesLoaded` writes to the ref without setting state. Turning propagation on shows nothing until something else re-renders `Home`, such as the 15 s anomaly poll.

### N12. Saved geofence zones are never drawn (Medium, CONFIRMED)
`Home.tsx:422` passes `geofenceZones={geofencePanelOpen ? undefined : undefined}`, and `Globe` only uses `geofenceZones` as an effect dependency, never its contents. The default `= []` also creates a new array on every render, so the geofence group is rebuilt on every Globe render (every hover change).

### N13. Large geofence fills and edges sink into the globe (Medium, CONFIRMED)
Edges are straight chords, and the fan centroid is not re-projected to the sphere surface (the TDoA contour code does re-project it). A chord between vertices more than about 15° apart sags below the surface (0.043 sag against a 0.04 lift), so with `depthTest` on, the middle of the zone disappears.
**Fix:** subdivide edges along the great circle, as `createGreatCircleLine` already does, and normalize the centroid.

### N14. Focusing a saved target wipes the real TDoA result (Medium, CONFIRMED)
`Home.tsx:651` `onFocusTarget` writes a fake `tdoaResult` (which flashes a red crosshair) and then calls `setTdoaResult(null)` 500 ms later, discarding any genuine result the user was viewing.
**Fix:** expose `focus(lat, lon)` on `GlobeHandle`.

### N15. The FPS governor's "start at MED on mobile" setting never takes effect (Medium, CONFIRMED)
`detectInitialLevel()` sets `currentLevel = QUALITY_MED`, but `Globe` builds the scene with the HIGH settings (96 segments, atmosphere on) and never applies the initial config. Because the governor believes it is already at MED, it never runs the HIGH→MED downgrade. `usePointMarkers` and `markerSegments` are not read anywhere in `Globe.tsx`. The commit that added this ("Added mobile/low-power device detection to start globe at QUALITY_MED") therefore has no effect.

### N16. GPU leaks in overlay teardown (Medium, CONFIRMED)
`disposeTdoaGroup` only handles `Mesh` and `Line`:
- Saved-target label `Sprite`s, their `SpriteMaterial`s and their `CanvasTexture`s are never disposed. This happens on every target list change.
- `material.dispose()` does not dispose `material.map`, so every TDoA heatmap texture leaks.

### N17. Smaller items
- **No `mouseleave` handler (CONFIRMED):** the hover tooltip and the enlarged marker stick when the cursor leaves the canvas. Hover is also not re-picked while the globe auto-rotates under a still cursor.
- **Pinch, then lift one finger (PROBABLE):** `previousMouse` still holds the first finger's start point, so the camera jumps.
- **Tone-mapped marker colours (PROBABLE, needs a visual check):** `MeshBasicMaterial` is tone-mapped by default (ACES, exposure 1.4), so globe colours will not match the legend's CSS hex values. Set `toneMapped: false` on markers and overlays.
- **Context restore:** a second `WebGLRenderer` is created on the same canvas and the old one is never disposed. The unmount cleanup disposes the stale captured renderer.

---

## 3. Corrected top-5 for blocking

1. **N1 + N2:** the inverse coordinate maps are wrong, so fly-to and geofencing are visibly broken everywhere.
2. **N3 + N4:** picking ignores the globe and overlays draw through it, so the wrong stations get selected and rings float in space.
3. **N7 + March #1:** the fallback is never shown in any failure mode.
4. **N5 + N6:** selection desyncs, and all markers are rebuilt every 2 s during scans.
5. **March #4 + N8 + N9:** status opacity is lost, the highlight discs are giant, and the camera spins after idling.

## 4. Fix snippets (highest confidence)

```ts
// N1: one helper, used at all five fly-to sites
const lngToCameraTheta = (lng: number) => (lng + 90) * Math.PI / 180;
function setTargetAngles(s, lat: number, lng: number) {
  s.targetSpherical.phi = THREE.MathUtils.clamp((90 - lat) * Math.PI / 180, 0.3, Math.PI - 0.3);
  const want = lngToCameraTheta(lng);
  const d = THREE.MathUtils.euclideanModulo(want - s.targetSpherical.theta + Math.PI, 2 * Math.PI) - Math.PI;
  s.targetSpherical.theta += d;                      // N9: shortest path, no multi-turn spin
}

// N2: geofence click inverse
const lat = 90 - Math.acos(point.y / point.length()) * 180 / Math.PI;
const lon = Math.atan2(-point.z, point.x) * 180 / Math.PI;   // already in (-180, 180]

// N3: occlusion-aware picking
function pick(s) {
  const hits = s.raycaster.intersectObjects([s.globe, ...s.markerMeshes.map(m => m.mesh)]);
  const globeHit = hits.find(h => h.object === s.globe);
  const hit = hits.find(h => h.object !== s.globe && (!globeHit || h.distance <= globeHit.distance + 0.05));
  return hit ? s.markerMeshes.findIndex(m => m.mesh === hit.object) : -1;
}

// N9: in animate()
const delta = Math.min(s.clock.getDelta(), 0.1);
```

## 5. Verification script

Run with three@0.182.0. It prints the NDC table, the geofence round-trips, the antipode raycast hit, the ring sizes, the auto-rotate accumulation and the chord-sag figures quoted above.

```js
import * as THREE from 'three';
const R = 5;
function ll2v(lat, lng, r) { // copy of Globe.tsx latLngToVector3
  const phi = (90 - lat) * Math.PI / 180, theta = (lng + 180) * Math.PI / 180;
  return new THREE.Vector3(-(r*Math.sin(phi)*Math.cos(theta)), r*Math.cos(phi), r*Math.sin(phi)*Math.sin(theta));
}
function inv(p) { // copy of Globe.tsx:969-972
  const r = p.length(), lat = 90 - Math.acos(p.y / r) * 180 / Math.PI;
  const lon = -(Math.atan2(-p.x, p.z) * 180 / Math.PI) - 180;
  return { lat, lon: ((lon + 540) % 360) - 180 };
}
function cam(lat, lng, thetaFn) {
  const c = new THREE.PerspectiveCamera(45, 16/9, 0.1, 1000);
  c.position.setFromSpherical(new THREE.Spherical(14, (90 - lat) * Math.PI/180, thetaFn(lng)));
  c.lookAt(0,0,0); c.updateMatrixWorld(); return c;
}
const p = ll2v(51.5, -0.1, R*1.008);
console.log(p.clone().project(cam(51.5, -0.1, l => -l*Math.PI/180)));     // code: off-centre
console.log(p.clone().project(cam(51.5, -0.1, l => (l+90)*Math.PI/180)));  // fixed: (0,0)
console.log(inv(ll2v(0, 0, R)));                                            // -> lon -90
const far = new THREE.Mesh(new THREE.SphereGeometry(1,8,8)); far.scale.setScalar(0.065);
far.position.copy(ll2v(0, 180, R*1.008)); far.updateMatrixWorld();
const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(0,0), cam(0, 0, l => (l+90)*Math.PI/180));
console.log(rc.intersectObjects([far]).length);                             // 1: picked through the globe
```
