# Globe Visual Bug Review — PR BLOCKING

**Reviewer:** Claude Code Review Team
**Date:** 2026-03-10
**Scope:** Globe rendering, overlays, interaction, lifecycle, performance, CSS integration
**Files reviewed:** Globe.tsx, TDoAGlobeOverlay.ts, Map.tsx, FallbackMap.tsx, Home.tsx + supporting libs

---

## A. Executive Verdict

The 3D globe is architecturally reasonable — single scene, manual orbit, properly separated overlay groups. However, there are **several confirmed bugs and multiple high-risk landmines** that will cause visible regressions under real use. The worst problems are:

1. **`useImperativeHandle` called after early return** — React hook ordering violation that will crash the component on re-render after WebGL recovery
2. **Shared geometry disposed multiple times** — ionosonde and conflict markers share `BufferGeometry` instances across meshes, but cleanup disposes the geometry once per child, corrupting it for sibling meshes and causing WebGL errors
3. **Marker opacity reset hardcoded to 0.85** — animation loop resets all non-selected/non-hovered markers to `opacity: 0.85`, overriding the status-based opacity (offline=0.6, unknown=0.45) set during marker creation

### Top 3 Highest-Risk Defects

| Rank | Defect | Impact |
|------|--------|--------|
| 1 | **Hook after early return** (Globe.tsx:1595) | React crash on any re-render after WebGL error+retry |
| 2 | **Shared geometry multi-dispose** (Globe.tsx:1159-1206, 1398-1447) | WebGL errors, blank markers, console spam |
| 3 | **Animation loop opacity override** (Globe.tsx:764) | Online/offline/unknown status colors invisible during normal use |

---

## B. Findings Table

### FINDING 1: useImperativeHandle after conditional early return
- **Severity:** Critical
- **Area:** Lifecycle
- **File:** `Globe.tsx:1572-1603`
- **Bug:** `useImperativeHandle` is called at line 1595, but there is an early return at line 1572 (`if (webglError)` renders fallback UI). React requires hooks to be called in the same order every render. When `webglError` is set and then cleared (user clicks "Retry WebGL"), the hook ordering changes.
- **Why it breaks:** Violates Rules of Hooks. React will either crash with an error or silently corrupt hook state.
- **User-visible symptom:** Clicking "Retry WebGL" crashes the entire component tree (caught by GlobeErrorBoundary, showing "3D Globe Crashed").
- **Evidence:**
  ```tsx
  // Line 1572: early return before hooks
  if (webglError) {
    return ( /* fallback UI */ );
  }
  // Line 1595: hook after the early return
  useImperativeHandle(ref, () => ({ ... }), []);
  ```
- **Fix:** Move `useImperativeHandle` above the `if (webglError)` early return, alongside all other hooks.

---

### FINDING 2: Shared geometry disposed N times (ionosondes)
- **Severity:** High
- **Area:** Lifecycle / Rendering
- **File:** `Globe.tsx:1159-1206`
- **Bug:** `diamondGeo` and `haloGeo` are created once and shared across all ionosonde meshes. The cleanup loop at line 1200-1208 calls `child.geometry.dispose()` on every child, but they all reference the same geometry object. After the first disposal, subsequent calls dispose an already-disposed geometry.
- **Why it breaks:** Disposing a shared geometry invalidates it for all meshes that reference it. If any rendering pass tries to draw before full cleanup, WebGL throws errors. Also causes console warnings.
- **User-visible symptom:** Brief frame of corrupted/missing ionosonde markers when toggling propagation overlay. Possible console errors.
- **Evidence:**
  ```tsx
  const diamondGeo = new THREE.CircleGeometry(0.06, 4); // shared
  const haloGeo = new THREE.RingGeometry(0.08, 0.12, 16); // shared
  ionosondes.forEach((iono) => {
    const marker = new THREE.Mesh(diamondGeo, markerMat); // shares geometry
    // ...
  });
  // Cleanup:
  while (ionoGroup.children.length > 0) {
    child.geometry.dispose(); // disposes diamondGeo or haloGeo EACH TIME
  }
  ```
- **Fix:** Either (a) clone the geometry per mesh, (b) dispose shared geometries only once after the loop, or (c) track which geometries have been disposed.

---

### FINDING 3: Same shared geometry bug in conflict markers
- **Severity:** High
- **Area:** Lifecycle / Rendering
- **File:** `Globe.tsx:1398-1451`
- **Bug:** Identical to Finding 2. `markerGeo` and `haloGeo` for conflict events are shared across all conflict event meshes, then disposed once per child in cleanup.
- **Evidence:**
  ```tsx
  const markerGeo = new THREE.CircleGeometry(1, 6); // shared
  const haloGeo = new THREE.RingGeometry(0.8, 1.2, 12); // shared
  ```
- **Fix:** Same as Finding 2.

---

### FINDING 4: Animation loop overrides status-based marker opacity
- **Severity:** High
- **Area:** Rendering
- **File:** `Globe.tsx:762-765`
- **Bug:** The animation loop's `else` branch unconditionally sets marker opacity to 0.85:
  ```tsx
  } else {
    mesh.scale.set(baseScale, baseScale, baseScale);
    (mesh.material as THREE.MeshBasicMaterial).opacity = 0.85;
  }
  ```
  But `updateMarkers` carefully sets different opacities: online=0.95, offline=0.6, unknown=0.45. The animation loop immediately overwrites these to 0.85 every frame.
- **Why it breaks:** Status differentiation via opacity is destroyed. Offline and unknown stations appear at 0.85 opacity instead of 0.6/0.45.
- **User-visible symptom:** Online/offline/unknown stations all look the same brightness. The subtle visual cues from the status check are invisible.
- **Fix:** Store the base opacity alongside `baseScale` in `markerMeshes` and restore it in the `else` branch instead of hardcoding 0.85.

---

### FINDING 5: Shared station marker geometry never disposed
- **Severity:** Medium
- **Area:** Lifecycle / Performance
- **File:** `Globe.tsx:526`
- **Bug:** `const markerGeo = new THREE.SphereGeometry(1, 8, 8)` is created inside `updateMarkers` and shared across all station meshes. When `updateMarkers` is called again, old meshes are removed and their `.geometry.dispose()` is called — but since they all share the same geometry, it's disposed N times (same pattern as Findings 2-3). Also, the `markerGeo` itself is not explicitly disposed after the loop and leaks if no children were created.
- **Fix:** Dispose the shared geometry once separately, or use per-mesh geometry.

---

### FINDING 6: Geofence click-to-globe coordinate conversion potentially off
- **Severity:** Medium
- **Area:** Interaction
- **File:** `Globe.tsx:967-972`
- **Bug:** The inverse coordinate conversion from 3D point back to lat/lon uses:
  ```tsx
  const lon = -(Math.atan2(-point.x, point.z) * (180 / Math.PI)) - 180;
  const normalizedLon = ((lon + 540) % 360) - 180;
  ```
  The forward `latLngToVector3` uses:
  ```tsx
  x = -(radius * sin(phi) * cos(theta))  where theta = (lng + 180) * PI/180
  z =  radius * sin(phi) * sin(theta)
  ```
  The inverse formula should invert this exactly. The double-negation and `- 180` offset is fragile. For points near the antimeridian (lng near ±180), the normalization `((lon + 540) % 360) - 180` can produce incorrect results due to floating-point modulo on negative numbers.
- **Why it breaks:** Geofence vertices placed by clicking the globe may land at slightly wrong longitudes, especially near the Pacific antimeridian.
- **User-visible symptom:** Geofence polygon vertices don't match where user clicked, particularly near ±180° longitude.
- **Fix:** Use a cleaner inverse: `lon = Math.atan2(-point.x, point.z) * (180 / Math.PI) - 180`, then normalize properly handling negative modulo.

---

### FINDING 7: preserveDrawingBuffer always enabled
- **Severity:** Medium
- **Area:** Performance
- **File:** `Globe.tsx:193`
- **Bug:** `preserveDrawingBuffer: true` is always enabled because it's needed for screenshot export. This prevents the GPU from using an optimization where it discards the back buffer after presenting. On lower-end GPUs, this can cause measurable FPS loss (10-20%).
- **Why it breaks:** Permanent GPU overhead even when screenshots are never used.
- **User-visible symptom:** Lower FPS on weak hardware. The FPS Governor may downggrade quality sooner than necessary.
- **Fix:** Only enable `preserveDrawingBuffer` when a screenshot is actually requested. Alternatively, use `renderer.domElement.toDataURL()` after a forced render with a temporary renderer that has it enabled.

---

### FINDING 8: Conflict marker geometry not reused efficiently — massive allocation
- **Severity:** Medium
- **Area:** Performance
- **File:** `Globe.tsx:1389-1439`
- **Bug:** Each conflict event creates its own `MeshBasicMaterial`. For hundreds or thousands of UCDP events, this means thousands of material allocations and drawcalls. Each material is a separate WebGL state, preventing batching.
- **Why it breaks:** With >500 conflict events, the scene becomes extremely expensive to render. Each material is a separate draw call.
- **User-visible symptom:** FPS drops significantly when conflict overlay is active with many events.
- **Fix:** Group events by type/color and use a single material per color. Or use InstancedMesh for same-geometry same-material groups.

---

### FINDING 9: Event handler useEffect has unstable dependencies
- **Severity:** Medium
- **Area:** Lifecycle
- **File:** `Globe.tsx:1106`
- **Bug:** The mouse/touch event handler `useEffect` depends on `[selectStation, setHoveredStation, createRingPulse]`. `selectStation` and `setHoveredStation` come from context and are likely stable, but if RadioContext re-creates them, this entire useEffect re-runs — detaching and reattaching all DOM event listeners. During the teardown/setup gap, clicks can be lost.
- **Why it breaks:** If context functions are recreated (e.g., during station list refresh), event listeners are briefly detached.
- **User-visible symptom:** Occasional missed clicks or briefly unresponsive drag right after data refreshes.
- **Fix:** Use refs to hold `selectStation`/`setHoveredStation` so the effect dependency is stable.

---

### FINDING 10: Home.tsx useEffect without dependency array runs every render
- **Severity:** Low
- **Area:** Lifecycle
- **File:** `Home.tsx:176-189`
- **Bug:** `useEffect(() => { overlayToggles.current = { ... }; })` has no dependency array, so it runs on every single render. While assigning to a ref is cheap, this is unnecessary work.
- **Fix:** Add `[]` dependency array since these are all state setters which are stable.

---

### FINDING 11: heatmapOverlay returns group before texture loads (async race)
- **Severity:** Medium
- **Area:** Overlay
- **File:** `TDoAGlobeOverlay.ts:374-451`
- **Bug:** `createHeatmapOverlay` returns an empty group immediately, then adds the mesh inside the `TextureLoader.load` callback. If `disposeTdoaGroup` is called before the texture finishes loading, the mesh will be added to an already-cleared group. The mesh then becomes an orphan still referencing the group.
- **Why it breaks:** If TDoA overlay is toggled rapidly, the heatmap mesh may appear in a stale group or cause a flicker when it finally loads into a cleaned-up parent.
- **User-visible symptom:** Heatmap texture briefly flashes when switching between TDoA results rapidly.
- **Fix:** Store an `aborted` flag in a closure and check it in the load callback before adding to the group.

---

### FINDING 12: Prediction marker cleanup uses traverse during mutation
- **Severity:** Medium
- **Area:** Overlay / Lifecycle
- **File:** `TDoAGlobeOverlay.ts:910-921`
- **Bug:** `createPredictionMarkers` mutates the `group` it receives — it traverses the group to find existing prediction markers, collects them, then removes them. But `traverse` iterates the live scene graph. Calling `parent.remove(obj)` during or after `traverse` is safe because removal is deferred, but the `toRemove` pattern here is correct. **However**, the function both clears AND adds to the same group, meaning it's a side-effect mutator, not a pure creator. This breaks the cleanup pattern used in Globe.tsx where `disposeTdoaGroup(group)` is called in the useEffect cleanup.
- **Evidence:** Globe.tsx line 1339 calls `disposeTdoaGroup(group)` in cleanup, which clears everything. But `createPredictionMarkers` at line 1343 also does its own partial cleanup. This double-cleanup can cause dispose-on-already-disposed errors.
- **Fix:** Make `createPredictionMarkers` a pure factory (return a new group), consistent with all other `create*` functions.

---

### FINDING 13: Highlight effect doesn't restore original opacity — only color
- **Severity:** Low
- **Area:** Rendering
- **File:** `Globe.tsx:643-654`
- **Bug:** The "restore original colors" loop restores the hex color but does NOT restore opacity. If the highlighted marker had its opacity modified by the animation loop, the restoration only fixes the color.
- **Fix:** Also restore the base opacity alongside the color.

---

### FINDING 14: Camera smooth interpolation uses fixed lerp factor, not delta-time-adjusted
- **Severity:** Low
- **Area:** Interaction
- **File:** `Globe.tsx:725-727`
- **Bug:** The smooth camera interpolation uses:
  ```tsx
  s.spherical.theta += (s.targetSpherical.theta - s.spherical.theta) * 0.06;
  ```
  The factor 0.06 is frame-rate dependent. At 60fps this feels smooth, but at 30fps the interpolation is half as responsive (takes twice as long to reach target). At 120fps it's too fast.
- **User-visible symptom:** Camera rotation feels inconsistent between devices with different FPS.
- **Fix:** Use `1 - Math.pow(1 - 0.06, delta * 60)` or similar frame-rate-independent exponential decay.

---

### FINDING 15: Ionosonde and conflict marker shared geometries not disposed on component unmount
- **Severity:** Low
- **Area:** Performance / Lifecycle
- **File:** `Globe.tsx:1159, 1162, 1398, 1399`
- **Bug:** The shared `diamondGeo`, `haloGeo`, `markerGeo` are local variables. If the useEffect cleanup doesn't dispose them explicitly (it only disposes via child iteration), and if there are zero children (e.g., empty ionosonde list), the geometry is leaked.
- **Fix:** Dispose the shared geometry explicitly in the cleanup, not just via child traversal.

---

## C. Ranked Bug List — Most Likely Causes

### 1. Flicker
- **Finding 11:** Heatmap texture load race condition — mesh added to cleaned-up group
- **Finding 2/3:** Shared geometry disposed while still referenced by sibling meshes
- **Finding 4:** Opacity snapping to 0.85 every frame overriding status values

### 2. Missing markers
- **Finding 2/3:** Shared geometry corrupted after partial disposal
- **Finding 1:** useImperativeHandle crash after WebGL retry kills the entire globe component
- **Finding 5:** Station marker geometry disposed N times

### 3. Wrong marker positions
- **Finding 6:** Geofence inverse coordinate conversion fragile near antimeridian
- Lat/lon conversion itself (Globe.tsx:54-62 and TDoAGlobeOverlay.ts:17-29) is **correct** — verified the math

### 4. Overlay desync
- **Finding 12:** createPredictionMarkers mutates group in place, conflicting with disposeTdoaGroup cleanup
- **Finding 11:** Heatmap texture arriving into stale group
- **Finding 4:** Animation loop overriding visual state set by marker creation

### 5. Janky rotation
- **Finding 14:** Frame-rate-dependent interpolation factor
- **Finding 9:** Event listener re-registration gap during context updates

### 6. Blurry or washed-out globe
- **Finding 7:** preserveDrawingBuffer causing GPU overhead, FPS Governor may downgrade pixel ratio
- FPS Governor reducing `maxPixelRatio` under load (by design, but could trigger on weaker GPUs)

### 7. Memory leaks after prolonged use
- **Finding 2/3/5:** Shared geometries leaked or multi-disposed
- **Finding 8:** Thousands of materials created for conflict events
- **Finding 15:** Shared geometries not explicitly disposed in cleanup
- **Finding 10:** useEffect running every render (minor)

---

## D. Patch Plan

### Phase 1: Minimal Safe Fixes (do first, ship immediately)

1. **Move `useImperativeHandle` above early return** — Fixes React crash. Zero risk.
2. **Fix shared geometry disposal** — For ionosonde, conflict, and station markers: dispose shared geometry once explicitly, not per-child. Or clone per mesh.
3. **Fix animation loop opacity override** — Store `baseOpacity` alongside `baseScale` in `markerMeshes`, restore it in the else branch.
4. **Add abort flag to heatmap texture loader** — Prevent stale load callbacks from adding to cleaned groups.

### Phase 2: Structural Refactors

5. **Make `createPredictionMarkers` a pure factory** — Return a new group, don't mutate the passed-in group. Align with all other `create*` functions.
6. **Use refs for event handler dependencies** — Stabilize the mouse/touch useEffect so it doesn't re-register on every context change.
7. **Fix frame-rate-dependent camera interpolation** — Use delta-time-adjusted exponential decay.
8. **Fix geofence inverse coordinate conversion** — Simplify the lon calculation and handle antimeridian correctly.

### Phase 3: Performance Hardening

9. **Batch conflict event materials by color** — Group by type, single material per color.
10. **Conditionally enable `preserveDrawingBuffer`** — Only when screenshot is needed, or use a secondary render.
11. **Add `[]` to Home.tsx overlayToggles useEffect**.

---

## E. Patch Snippets (Highest-Confidence Issues)

### Fix 1: Move useImperativeHandle above early return

```tsx
// Globe.tsx — Move this BEFORE the `if (webglError)` block

useImperativeHandle(ref, () => ({
  captureScreenshot: () => {
    const s = sceneRef.current;
    if (!s) return null;
    s.renderer.render(s.scene, s.camera);
    return s.renderer.domElement.toDataURL("image/png");
  },
}), []);

// Then the webglError early return is safe
if (webglError) {
  return ( /* ... */ );
}
```

### Fix 2: Shared geometry disposal (ionosonde example)

```tsx
// Globe.tsx ionosonde useEffect cleanup — dispose shared geos separately
return () => {
  diamondGeo.dispose();
  haloGeo.dispose();
  while (ionoGroup.children.length > 0) {
    const child = ionoGroup.children[0];
    ionoGroup.remove(child);
    if (child instanceof THREE.Mesh) {
      // Only dispose material, NOT geometry (already disposed above)
      if (child.material instanceof THREE.Material) child.material.dispose();
    }
  }
};
```

### Fix 3: Animation loop opacity fix

```tsx
// In updateMarkers, change meshes array to include baseOpacity:
const meshes: { mesh: THREE.Mesh; station: Station; baseScale: number; baseOpacity: number }[] = [];
// ... in forEach:
meshes.push({ mesh, station, baseScale: scale, baseOpacity: opacity });

// In animation loop else branch:
} else {
  mesh.scale.set(baseScale, baseScale, baseScale);
  (mesh.material as THREE.MeshBasicMaterial).opacity = baseOpacity; // was hardcoded 0.85
}
```

### Fix 4: Heatmap abort flag

```tsx
export function createHeatmapOverlay(
  imageUrl: string,
  bounds: { ... }
): { group: THREE.Group; abort: () => void } {
  const group = new THREE.Group();
  let aborted = false;

  const loader = new THREE.TextureLoader();
  loader.load(imageUrl, (texture) => {
    if (aborted) { texture.dispose(); return; }
    // ... existing mesh creation ...
    group.add(mesh);
  });

  return { group, abort: () => { aborted = true; } };
}
```

---

## Review Decision

**CHANGES REQUESTED** — The hook-ordering violation (Finding 1) alone is a blocking issue. Findings 2-4 will cause visible rendering bugs in production. Fix Phase 1 items before merging.
