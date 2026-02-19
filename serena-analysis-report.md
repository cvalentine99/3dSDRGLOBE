# Serena Code Analysis Report — Radio Globe

**Date:** February 19, 2026  
**Project:** radio-globe  
**Codebase size:** ~39,235 lines of TypeScript/TSX (excluding node_modules, ui components, and framework core)  
**Test suite:** 374 passing vitest tests  
**TypeScript:** Zero errors (strict mode, noEmit)

---

## 1. Project Architecture Summary

Radio Globe is a full-stack SDR intelligence platform built on React 19 + tRPC 11 + Drizzle ORM + Three.js. The codebase is organized into four layers:

| Layer | Path | Purpose |
|-------|------|---------|
| **Frontend** | `client/src/` | React pages, Three.js globe, UI components |
| **Backend** | `server/` | tRPC routers, service modules, business logic |
| **Schema** | `drizzle/` | 13 database tables with typed Drizzle ORM |
| **Shared** | `shared/` | Constants and types used by both layers |

The application exposes **11 tRPC router namespaces** (analytics, anomalies, auth, fingerprints, receiver, recordings, sharing, system, targets, tdoa, uptime) with **73 query/mutation procedures**, all validated with Zod schemas.

---

## 2. Code Quality Findings

### 2.1 Strengths

- **Type safety is excellent.** Zero TypeScript errors across the entire codebase. All tRPC procedures use Zod input validation (168 Zod usages across 73 procedures). Drizzle ORM provides compile-time schema checking.

- **Test coverage is substantial.** 374 vitest tests across 8 test files covering receiver status, batch prechecking, TDoA service, auto-refresh, uptime sparklines, status persistence, fallback maps, and targets/fingerprints/anomalies.

- **Error boundaries are properly layered.** A global `ErrorBoundary` wraps the entire app, and a specialized `GlobeErrorBoundary` catches WebGL/Three.js crashes independently, preventing 3D rendering failures from taking down the entire UI.

- **Service module separation is clean.** Domain logic is extracted into focused modules (`anomalyDetector.ts`, `positionPredictor.ts`, `signalClassifier.ts`, `kiwiRecorder.ts`) rather than being inlined in the router.

- **SQL injection risk is minimal.** All database access goes through Drizzle ORM's parameterized queries. The 3 raw `sql` template usages in `statusPersistence.ts` are safe counter increments, not user-input interpolation.

### 2.2 Issues Found

#### Critical

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 1 | **Hardcoded TDoA auth key** | `server/tdoaService.ts:17` | The KiwiSDR TDoA auth key `4cd0d4f2af04b308bb258011e051919c` is hardcoded in source. While this is a publicly known key from the KiwiSDR open-source extension, it should be moved to an environment variable for configurability and to follow security best practices. |

#### High

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 2 | **`routers.ts` is 1,879 lines** | `server/routers.ts` | Far exceeds the recommended 150-line-per-router guideline. Contains 11 router namespaces, 4 helper functions, and inline business logic. Should be split into `server/routers/*.ts` files. |
| 3 | **Duplicate `haversineKm` implementations** | 5 locations (see below) | The same Haversine distance function is copy-pasted in `positionPredictor.ts`, `anomalyDetector.ts`, `TDoACompare.tsx`, `TargetManager.tsx`, and `tdoaService.ts` (as `haversineDistance`). Should be extracted to `shared/geo.ts`. |
| 4 | **Three.js memory leak risk** | `client/src/components/Globe.tsx` | 150 Three.js object allocations (`new THREE.*`) vs only 25 `.dispose()` calls. Several `useEffect` hooks (lines 526, 531, 897, 957, 1035, 1049, 1066, 1079) lack cleanup return functions, meaning geometries, materials, and textures may not be disposed when the component unmounts or dependencies change. |

#### Medium

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 5 | **Duplicate `latLngToVector3`** | `Globe.tsx:51` and `TDoAGlobeOverlay.ts:17` | Same coordinate conversion function defined in two files. Globe.tsx should import from TDoAGlobeOverlay.ts (which already exports it). |
| 6 | **Non-null assertion on database** | `server/kiwiRecorder.ts:127` | `(await getDb())!` uses a non-null assertion. If the database connection fails, this will throw a cryptic error instead of a descriptive one. Should use a guard clause with a meaningful error message. |
| 7 | **`as any` type assertions** | `server/routers.ts:719`, `server/storage.ts:60` | Two `as any` casts bypass type checking. The router cast (`cat as any`) could be replaced with a proper type guard; the storage cast could use a typed overload. |
| 8 | **Missing test files for 6 modules** | `server/` | `anomalyDetector.ts`, `kiwiRecorder.ts`, `positionPredictor.ts`, `routers.ts`, `sdrRelay.ts`, and `signalClassifier.ts` lack dedicated test files. Their logic is partially covered by `targets.test.ts`, but dedicated test files would improve maintainability. |
| 9 | **Low accessibility coverage** | `client/src/` | Only 8 `aria-*` attributes across 243 interactive elements (`<button>`, `<input>`, `<select>`). Many icon-only buttons in the globe nav bar lack `aria-label` attributes, making them inaccessible to screen readers. |

#### Low

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 10 | **Event listener cleanup gap** | `client/src/` | 27 `addEventListener` calls vs 19 `removeEventListener` calls. 8 listeners may not be properly cleaned up, though some may be in useEffect cleanup functions that use different patterns. |
| 11 | **Module-level mutable state** | `server/autoRefresh.ts`, `server/batchPrecheck.ts` | Module-level `let` variables (`currentJob`, `abortController`, `currentCycleStartedAt`) create implicit singleton state. This works for single-instance servers but would cause issues if the server were ever clustered. |
| 12 | **`shared/types.ts` is empty** | `shared/types.ts` | The shared types file exists but contains no exports. Shared interfaces like `PredictionResult`, `ClassificationResult`, and `AnomalyCheckResult` could be moved here for cross-layer reuse. |

---

## 3. Duplicate Code Analysis

The `haversineKm` / `haversineDistance` function appears in 5 separate locations:

| File | Function Name | Lines |
|------|--------------|-------|
| `server/positionPredictor.ts:298-310` | `haversineKm` | 13 |
| `server/anomalyDetector.ts:36-48` | `haversineKm` | 13 |
| `server/tdoaService.ts:455-468` | `haversineDistance` | 14 |
| `client/src/components/TDoACompare.tsx:54-68` | `haversineKm` | 15 |
| `client/src/components/TargetManager.tsx:1261-1275` | `haversineDistance` | 15 |

**Recommendation:** Extract to `shared/geo.ts` as a single exported function, importable by both server and client code.

---

## 4. File Size Analysis

Files exceeding 500 lines (excluding tests and data files):

| File | Lines | Recommendation |
|------|-------|----------------|
| `server/routers.ts` | 1,879 | Split into `server/routers/*.ts` by namespace |
| `client/src/components/TargetManager.tsx` | 1,281 | Extract sub-components (TagFilter, HistoryTimeline, PredictionCard) |
| `client/src/components/TDoAPanel.tsx` | 1,241 | Extract tab content into separate components |
| `client/src/components/Globe.tsx` | 1,146 | Extract marker creation into helper modules |
| `client/src/components/TDoAGlobeOverlay.ts` | 1,123 | Already well-organized with exported functions |
| `client/src/components/SigintLogViewer.tsx` | 932 | Consider splitting log filters and display |
| `client/src/components/FallbackMap.tsx` | 835 | Acceptable for a self-contained fallback |
| `client/src/pages/Dashboard.tsx` | 815 | Extract chart sections into sub-components |
| `client/src/components/WatchlistPanel.tsx` | 814 | Extract list items and filters |
| `client/src/components/AudioPlayer.tsx` | 766 | Acceptable for a complex audio player |
| `client/src/pages/Home.tsx` | 739 | Extract panel orchestration logic |

---

## 5. Security Assessment

| Area | Status | Notes |
|------|--------|-------|
| SQL Injection | **Safe** | All queries via Drizzle ORM parameterized queries |
| Auth/AuthZ | **Good** | `protectedProcedure` enforces auth; role-based checks present |
| Input Validation | **Good** | Zod schemas on all tRPC inputs |
| Secrets Management | **Needs improvement** | TDoA auth key hardcoded (line 17 of tdoaService.ts) |
| XSS | **Good** | React's JSX escaping prevents XSS; no `dangerouslySetInnerHTML` found |
| CORS | **Good** | Handled by framework core |

---

## 6. Performance Considerations

- **Three.js object lifecycle:** The Globe component creates ~150 Three.js objects but only disposes ~25. Long-running sessions with frequent TDoA overlay updates could accumulate GPU memory. Adding cleanup to the 8 useEffect hooks without return functions would mitigate this.

- **Router file size:** The 1,879-line `routers.ts` is loaded as a single module. While this doesn't affect runtime performance (tree-shaking handles it), it impacts developer experience and hot-reload times.

- **Database query patterns:** The analytics router performs multiple sequential queries (targets by category, anomaly trends, job activity, etc.). These could be parallelized with `Promise.all()` for faster dashboard loads.

---

## 7. Serena Memory Files Created

| Memory File | Purpose |
|-------------|---------|
| `project_overview` | Project purpose, tech stack, key modules, database tables |
| `suggested_commands` | Development, testing, database, and formatting commands |
| `style_conventions` | TypeScript, naming, architecture patterns, file organization |
| `task_completion` | Checklist for completing development tasks |

---

## 8. Recommended Priority Actions

1. **Extract `haversineKm` to `shared/geo.ts`** — Eliminates 5 duplicate implementations, reduces maintenance burden.
2. **Split `server/routers.ts`** — Move each router namespace to `server/routers/<name>.ts` and re-export from an index file.
3. **Add Three.js cleanup** — Audit all `useEffect` hooks in Globe.tsx and add `.dispose()` calls in cleanup functions.
4. **Move TDoA auth key to env** — Use `webdev_request_secrets` to add `TDOA_AUTH_KEY` as an environment variable.
5. **Add `aria-label` to icon buttons** — Quick accessibility win for the globe nav bar buttons.
