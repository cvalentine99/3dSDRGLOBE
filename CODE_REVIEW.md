# Code Review: 3dSDRGLOBE (Valentine RF - SigINT)

**Date:** 2026-02-21
**Reviewers:** 6 parallel agent teams
**Scope:** Full codebase review for working functionality of all features and options

---

## Executive Summary

| Category | Critical | High | Medium | Low | Total |
|----------|----------|------|--------|-----|-------|
| Globe 3D Rendering | 1 | 3 | 6 | 4 | 14 |
| Server-Side Features | 4 | 7 | 9 | 9 | 29 |
| Client UI Components | 2 | 4 | 9 | 10 | 25 |
| SIGINT & Watchlist | 0 | 6 | 7 | 8 | 21 |
| Context/State & Hooks | 2 | 3 | 8 | 8 | 21 |
| **Totals** | **9** | **23** | **39** | **39** | **110** |

**Tests:** 83/83 passing | **TypeScript:** 0 type errors

---

## CRITICAL Issues (9)

### C1. Path Traversal / SSRF in TDoA Result Proxy
**File:** `server/tdoaService.ts:354-373`
Neither `key` nor `filename` is validated. A malicious client could pass `key = "../../etc"` and `filename = "passwd"` to proxy arbitrary files from the remote TDoA server (SSRF).
**Fix:** Validate both parameters with `/^[a-zA-Z0-9._\- ]+$/` and reject values containing `..`, `/`, or `\`.

### C2. Potential Octave Command Injection in TDoA
**File:** `server/tdoaService.ts:162-169`
`knownLocation.name` is embedded into a Matlab/Octave struct literal with only single-quote doubling as sanitization. An attacker could inject arbitrary Octave commands.
**Fix:** Strip all non-alphanumeric/space characters from `knownLocation.name`, add `z.string().max(100).regex(...)` in Zod validation.

### C3. Dead Production Entry Point
**File:** `server/index.ts:1-33`
This file creates an Express server but never mounts the tRPC router, OAuth routes, or any API middleware. If used in production, the app will serve only the SPA shell with zero backend functionality.
**Fix:** Either remove `server/index.ts` or consolidate with `server/_core/index.ts` to include all API middleware.

### C4. DB Write on Every Authenticated Request
**File:** `server/_core/sdk.ts:259-301`
`upsertUser` is called on every single authenticated request to update `lastSignedIn`, adding unnecessary DB writes. When DB is unavailable, the real error cause is invisible to callers.
**Fix:** Update `lastSignedIn` less frequently (e.g., once per session, not per request).

### C5. XSS via `dangerouslySetInnerHTML` on External Data
**File:** `client/src/components/StationPanel.tsx:248`
`receiver.label` comes from scraped external data and is rendered with `dangerouslySetInnerHTML` without sanitization.
**Fix:** Render as plain text or sanitize with DOMPurify.

### C6. `useMemo` Used for Side Effects (State Setter)
**File:** `client/src/components/StationPanel.tsx:77-79`
`useMemo` calls `setWatched()` (a state setter), which violates React rules. Can cause render loops or unpredictable behavior.
**Fix:** Replace with `useEffect`.

### C7. `useMemo` Used for Side Effects (localStorage Write)
**File:** `client/src/_core/hooks/useAuth.ts:44-48`
`useMemo` writes to `localStorage` -- a side effect that React may re-execute unpredictably. Also writes `"undefined"` before auth completes.
**Fix:** Move `localStorage.setItem` to a `useEffect`.

### C8. No WebGL Context Loss Handler
**File:** `client/src/components/Globe.tsx:100-117`
No handler for the `webglcontextlost` event. If the GPU context is lost, the globe goes black with no recovery path.
**Fix:** Add `webglcontextlost` event listener on `renderer.domElement` that sets error state and offers retry.

### C9. Stale Closure in Keyboard Navigation Enter Handler
**File:** `client/src/hooks/useKeyboardNav.ts:79-81`
`highlightedIndex` captured in the `useCallback` closure can be stale if ArrowDown + Enter are pressed in rapid succession.
**Fix:** Use a ref for `highlightedIndex` in the Enter handler.

---

## HIGH Issues (23)

### Globe 3D Rendering (3 High)

**H1. GPU Memory Leaks -- Geometries Not Disposed** (`Globe.tsx:306, 120, 155, 180, 217-228`)
Shared `markerGeo` and all globe/atmosphere/star geometries are never disposed on cleanup. First `dispose()` on shared geometry invalidates it for remaining meshes.
**Fix:** Traverse scene and dispose all geometries/materials in cleanup.

**H2. GPU Memory Leaks -- Textures Never Disposed** (`Globe.tsx:134-152`)
Earth textures loaded via `TextureLoader` are never disposed on unmount.
**Fix:** Store texture refs and call `.dispose()` in cleanup.

**H3. Map Script Load Hangs Forever** (`Map.tsx:96-110`)
`loadMapScript` returns a Promise that never rejects on script load failure.
**Fix:** Add `script.onerror = () => reject(...)`.

### Server-Side (7 High)

**H4. N+1 Query in `updateUptimePercentages`** (`statusPersistence.ts:192-247`)
For 1,500 receivers: 4,501 sequential queries (2 COUNTs + 1 UPDATE per receiver).
**Fix:** Use bulk SQL with subqueries.

**H5. N+1 Query in `persistScanResults`** (`statusPersistence.ts:104-165`)
4,500 queries per scan cycle (upsert + SELECT + INSERT per receiver).
**Fix:** Use batch INSERT and pre-fetch all receiver IDs in one query.

**H6. Fire-and-Forget Async Persistence** (`autoRefresh.ts:163-165`)
`persistCompletedScan` called without `await` in a sync `setInterval` callback.
**Fix:** Properly await the async function or use a flag to prevent re-entry.

**H7. URL Normalization Mismatch** (`autoRefresh.ts:183-198`)
Trailing slash inconsistencies cause silent fallback to wrong defaults (`receiverType: "KiwiSDR"`, `stationLabel: "Unknown"`).
**Fix:** Normalize URLs at point of entry in `registerReceiversForAutoRefresh`.

**H8. Map vs Record Type Inconsistency** (`batchPrecheck.ts:28-29`)
`BatchJobStatus.results` declared as `Map` but returned as `Record`. Misleading types.
**Fix:** Use `Record` consistently or rely on superjson for Map serialization.

**H9. Untrusted Free Proxies** (`receiverStatus.ts:137-179`)
Free public proxies from ProxyScrape can intercept/modify response data (MITM).
**Fix:** Use direct connections or trusted proxy service; validate response data integrity.

**H10. Unbounded In-Memory Job Storage** (`tdoaService.ts:110, 190`)
`activeJobs` Map grows with every `submitTdoaJob` call, jobs never removed.
**Fix:** Add periodic cleanup of jobs older than a configurable TTL.

### Client UI (4 High)

**H11. Infinite Re-render Loop in SignalStrength** (`SignalStrength.tsx:186`)
`snrBands` is computed inline (new array each render) and included in `useEffect` deps.
**Fix:** Memoize `snrBands` with `useMemo` or remove from dependency array.

**H12. Missing React.StrictMode** (`main.tsx:55`)
Development double-render checks disabled, hiding issues like the `useMemo` side-effect bugs.
**Fix:** Wrap with `<StrictMode>`.

**H13. Coordinate Labels Always Show N/E** (`StationPanel.tsx:160-162`)
Hardcoded "N" and "E" regardless of sign. Sydney (-33.87) shows as `-33.8700°N`.
**Fix:** Use `Math.abs(lat)` with conditional N/S and E/W.

**H14. Stale Closure in Keyboard Enter Handler** (`useKeyboardNav.ts:77-82`)
Already covered in C9 above -- duplicate finding from two review teams confirms severity.

### SIGINT & Watchlist (6 High)

**H15. False Offline Alerts for New Stations** (`alertService.ts:214-228`)
On first poll, `lastOnline[stationKey]` is `undefined`. Since `undefined !== false`, a false "gone OFFLINE" alert fires for every newly added station that happens to be offline.
**Fix:** Change guard to `if (wasOnline === true && canAlert("offline"))`.

**H16. Module-Level `init()` Triggers Network Requests on Import** (`watchlistService.ts:498`)
Importing the module immediately starts network polling as a side effect.
**Fix:** Use lazy initialization pattern (`ensureInit()` at start of each public API function).

**H17. `no-cors` Fetch Always Reports Non-KiwiSDR Stations as Online** (`watchlistService.ts:369-397`)
Opaque `no-cors` responses always resolve successfully, even for 4xx/5xx errors.
**Fix:** Use server-side proxy for cross-origin reachability checks.

**H18. VHF/UHF Frequency Ranges Misidentified** (`frequencyCrossRef.ts:36-38`)
`if (low >= 100)` heuristic treats 144 MHz as 144 kHz. Breaks all VHF/UHF cross-references.
**Fix:** Remove the `low >= 100` heuristic; only check for explicit "kHz" text.

**H19. SIGINT Log Entries Never Refresh While Viewer Open** (`SigintLogViewer.tsx:80-88`)
Data memoized once; no polling or subscription for updates.
**Fix:** Add periodic refresh or subscription mechanism.

**H20. Stale `jobStatus` in TDoA useEffect** (`TDoAPanel.tsx:174-218`)
`jobStatus` not in dependency array; effect captures stale closure.
**Fix:** Use `useRef` for `jobStatus` or add to dependency array.

### Context/State (3 High)

**H21. RadioContext Value Recreated Every Render** (`RadioContext.tsx:298-336`)
Inline object literal creates new reference on every state change, causing all consumers to rerender.
**Fix:** Wrap value in `useMemo` and/or split into multiple contexts.

**H22. Ref-Based Query Parameter Doesn't Trigger Re-Query** (`useReceiverStatusMap.ts:47-56`)
`pollSinceRef.current` used as query param but ref mutations don't trigger re-query.
**Fix:** Convert to state, or document reliance on `refetchInterval`.

**H23. Dead Redirect Guard** (`useAuth.ts:68`)
`window.location.pathname` compared to full URL -- guard is always false.
**Fix:** Compare full URL or origins.

---

## MEDIUM Issues (39)

### Globe 3D Rendering (6)
| # | File | Issue |
|---|------|-------|
| M1 | Globe.tsx:390-403 | Opacity override in animation loop destroys status-based colors (all markers forced to 0.85) |
| M2 | Globe.tsx:306 | `markerGeo` created but never disposed on rerun |
| M3 | Globe.tsx:279-284 | `initScene` cleanup doesn't dispose scene resources |
| M4 | Globe.tsx:353-355 | Race condition between `initScene` and `updateMarkers` |
| M5 | Globe.tsx:797-800 | "Retry WebGL" button doesn't re-trigger `initScene` |
| M6 | Globe.tsx:350, 544 | `selectedMeshIdx` stale after marker rebuild |

### Server-Side (9)
| # | File | Issue |
|---|------|-------|
| M7 | receiverStatus.ts:340-372 | Transient network errors cached as "offline" for 15 min |
| M8 | receiverStatus.ts:424, 457 | `proxyUsed` flag inaccurate (checks list length, not actual usage) |
| M9 | autoRefresh.ts:109-252 | `forceRefresh` doesn't reset `setInterval` timer; `nextRefreshAt` wrong |
| M10 | tdoaService.ts:158-160 | Job key wraps every 100 seconds; collision risk |
| M11 | batchPrecheck.ts:103-247 | Cancelled job leaves completion watcher polling forever |
| M12 | routers.ts:84-103 | `checkBatch` returns inconsistent types for fulfilled vs rejected |
| M13 | db.ts:10 | Uses `process.env.DATABASE_URL` instead of `ENV.databaseUrl` |
| M14 | statusPersistence.ts:208 | bigint timestamp comparisons (minor) |
| M15 | drizzle/relations.ts | Empty file; no FK references or Drizzle relations defined |

### Client UI (9)
| # | File | Issue |
|---|------|-------|
| M16 | SignalStrength.tsx:100 | Unused `manualRefreshKey` state |
| M17 | Home.tsx:372-377 | `AnimatePresence` wrapping always-rendered `PropagationOverlay` |
| M18 | AudioPlayer.tsx:143-544 | `AnimatePresence` at top level; exit animations never trigger |
| M19 | DashboardLayoutSkeleton.tsx:22 | `absolute` positioning without `relative` parent |
| M20 | AIChatBox.tsx:135-150 | `minHeight` only calculated once (empty deps) |
| M21 | AIChatBox.tsx | No auto-scroll on new AI messages |
| M22 | index.css:126 | Global `body { overflow: hidden }` breaks scrollable pages |
| M23 | NotFound.tsx:14-15 | Hardcoded light theme colors in dark-themed app |
| M24 | UptimeSparkline.tsx:127-130 | Unused `getHoverColor` function |

### SIGINT & Watchlist (7)
| # | File | Issue |
|---|------|-------|
| M25 | sigintLogger.ts:113-157 | Race condition: concurrent localStorage reads/writes |
| M26 | sigintLogger.ts:228-268 | Duplicated peak detection differs from peakDetection.ts |
| M27 | sigintLogger.ts:376-391 | Inconsistent CSV escaping in summary rows |
| M28 | watchlistService.ts:278-292 | `forcePollAll` silently ignored while background poll running |
| M29 | watchlistService.ts:294-419 | No AbortController cleanup for in-flight poll requests |
| M30 | watchlistService.ts:343-400 | `saveEntries()` called per station causing write contention |
| M31 | peakDetection.ts:80-86, 144-179 | Endpoint peaks always yield 0 prominence (effectively dead code) |

### Context/State (8)
| # | File | Issue |
|---|------|-------|
| M32 | RadioContext.tsx:82-90 | No cascading filter resets (type change doesn't clear band) |
| M33 | RadioContext.tsx:268-295 | No search debouncing; full pipeline on every keystroke |
| M34 | RadioContext.tsx:179-204 | Object-identity Map keys fragile if data refreshed |
| M35 | useReceiverStatusMap.ts:91 | `startMutation` missing from useEffect deps |
| M36 | useReceiverStatusMap.ts:49 | Ref-based `enabled` flag doesn't trigger re-evaluation |
| M37 | useKeyboardNav.ts:50-51 | Missing `contentEditable` check for input exclusion |
| M38 | useKeyboardNav.ts:27-30 | Highlight resets on any `filteredStations` ref change |
| M39 | useAuth.ts:42 | `logout` callback may have unstable identity |

---

## LOW Issues (39)

<details>
<summary>Click to expand all 39 Low severity issues</summary>

### Globe 3D Rendering (4)
- `Globe.tsx:382, 499` -- `targetSpherical.phi` not clamped, causing oscillation at poles
- `Globe.tsx:528-557` -- Minor click/drag detection timing window
- `HoverTooltip.tsx:20-25` -- Global `mousemove` listener always active (perf waste)
- `HoverTooltip.tsx:47-49` -- Tooltip can overflow off-screen

### Server-Side (9)
- `receiverStatus.ts:117` -- No max-size cap on statusCache Map
- `receiverStatus.ts:81-108` -- Concurrent proxy list fetch race
- `routers.ts:123-131` -- Tightly coupled mutation with side-effect registration
- `tdoaService.ts:345-352` -- `cancelJob` is local-only; remote job continues
- `routers.ts:84` -- Side-effect operation uses `.query()` instead of `.mutation()`
- `_core/cookies.ts:27-40` -- Commented-out domain logic
- `_core/env.ts:1-10` -- No startup validation for critical env vars (JWT_SECRET)
- `storage.ts:27-42` -- `buildDownloadUrl` doesn't check `response.ok`
- `receiverStatus.ts:156` -- 4xx responses accepted as success; KiwiSDR false positives

### Client UI (10)
- `Home.tsx:81` -- Space background CDN URL will expire (~2027)
- `ComponentShowcase.tsx:162` -- Chinese locale (`zhCN`) for date formatting
- `App.tsx:9-17` -- `ComponentShowcase` page has no route (unreachable)
- `DashboardLayout.tsx` -- Not used anywhere in the app
- `StationPanel.tsx:235-282` -- Missing `aria-label` on receiver buttons
- `StationList.tsx:341` -- `actualIndex` in key defeats reconciliation optimization
- `SearchFilter.tsx:56-69` -- Double Escape keypress effect (search + keyboard nav)
- `Home.tsx:351-358` -- `WatchlistPanel` receives redundant `isOpen` prop
- `ComponentShowcase.tsx:670-674` -- Trailing slash in date display
- `ComponentShowcase.tsx:557` -- `CalendarIcon` used for combobox trigger

### SIGINT & Watchlist (8)
- `SigintLogViewer.tsx:138-143` -- No confirmation on "Clear Log"
- `WatchlistPanel.tsx:132-135` -- No confirmation on "Clear All"
- `WatchlistPanel.tsx:530-531` -- Stale `noteText` on external update
- `AlertSettings.tsx:42` -- Alert history not auto-refreshed while panel open
- `AlertSettings.tsx:79-83` -- Sound preview plays at volume 0
- `TDoAPanel.tsx:732` -- Elapsed time assumes exactly 2s poll interval
- `propagationService.ts:238, 257` -- Fallback URLs point to session-specific CDN
- `militaryRfData.ts` -- Several band classification inconsistencies (VLF vs LF, VHF vs UHF)

### Context/State (8)
- `RadioContext.tsx:137-139` -- Hardcoded fallback CDN URL
- `RadioContext.tsx:166` -- Station reselection always resets to first receiver
- `ThemeContext.tsx:24-30` -- localStorage accessed without SSR guard
- `ThemeContext.tsx:45-49` -- `toggleTheme` recreated every render (unused)
- `useMobile.tsx:6-8` -- First render falsely reports desktop on mobile
- `useComposition.ts:33-34` -- Timer refs not cleaned up on unmount
- `const.ts:8` -- Predictable OAuth `state` parameter (no CSRF nonce)
- `useAuth.ts:12` -- `getLoginUrl()` evaluated eagerly on every render

</details>

---

## Test & Build Results

| Check | Result |
|-------|--------|
| TypeScript `tsc --noEmit` | **0 errors** |
| Vitest `vitest run` | **83/83 tests passed** (7 test files) |
| Build warnings | Proxy pool unavailable in test env; DB persistence tests skipped (graceful degradation) |

---

## Top Priority Fixes (Recommended Order)

### Security (Fix Immediately)
1. **C1** -- Path traversal/SSRF in TDoA result proxy
2. **C2** -- Octave command injection in TDoA
3. **C5** -- XSS via `dangerouslySetInnerHTML`

### Correctness (Fix Before Next Release)
4. **C6, C7** -- `useMemo` side effects (StationPanel, useAuth)
5. **H15** -- False offline alerts for new stations
6. **H18** -- VHF/UHF frequency cross-reference misidentification
7. **H17** -- `no-cors` always reports stations as online
8. **H13** -- Coordinate labels always show N/E
9. **M1** -- Opacity override destroys status-based marker colors

### Performance (Fix Soon)
10. **H4, H5** -- N+1 queries (9,000+ queries per scan cycle)
11. **H21** -- RadioContext causes full tree rerenders
12. **H1, H2** -- GPU memory leaks (geometries + textures)

### Reliability
13. **C8** -- No WebGL context loss handler
14. **H3** -- Map script load hangs forever
15. **H10** -- Unbounded in-memory TDoA job storage
16. **H16** -- Module-level init triggers network requests on import
