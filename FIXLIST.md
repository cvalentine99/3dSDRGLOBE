# Fix List: Getting Valentine RF Working Off Manus

Status as of 2026-11-17. IDs are stable so commits can reference them.
- `[x]` = done
- `[ ]` = to do
- **CONFIRMED** = reproduced or provable from the code
- **SEEN** = visible in a headless-Chromium screenshot
- **PROBABLE** = needs a check on a real GPU

Globe IDs `N1`–`N17` and `M#` (findings from the March review) come from `GLOBE_VISUAL_BUG_REVIEW_RETRO.md`, which has the evidence and fix snippets for each.

---

## 0. Current state

- `pnpm install`, `pnpm check` and `pnpm build` all pass.
- `pnpm dev` boots with **no `.env` at all**. The globe renders the 1,517 bundled stations, and directory aggregation adds about 55 more.
- Without a database, the server degrades instead of crashing (`getDb()` returns `null`).
- Tests: 1,006 pass. The 81 failures are pre-existing: they need MySQL, or an AI key for translation.

## 1. Manus removal

### Done
- [x] Removed the Manus debug collector. In dev it recorded console logs, network requests and UI events, and wrote them to `.manus-logs/`.
- [x] Removed `vite-plugin-manus-runtime`, which is the Manus previewer bridge (it `postMessage`s to the parent frame).
- [x] Removed `@builder.io/vite-plugin-jsx-loc`, which tags JSX with source locations for the Manus editor.
- [x] Removed the `.manus*.computer` dev allowed-hosts.
- [x] Removed the Umami analytics tag. Its endpoint was never configured, so it only produced a 400 and a server `URIError` on every load.
- [x] Removed `localStorage["manus-runtime-user-info"]`.
- [x] Deleted the unused `ManusDialog.tsx`.
- [x] Removed the committed `.manus/db/` query logs. They named the old TiDB host, user and database but contained **no password**; the old values are still in git history. Added `.manus/` and `.manus-logs/` to `.gitignore`.
- [x] Moved the propagation fallbacks (KC2G ionosondes, HamQSL solar) from the Manus CDN to `client/public/fallback/`. These are the same snapshots, dated Feb 2026.
- [x] Dropped the stations fallback on the Manus CDN; `/stations.json` ships locally.
- [x] Replaced the space background, a Manus signed URL that now returns **403** so the page was already plain black, with a CSS gradient (`lib/spaceBackground.ts`).
- [x] Removed the GPS-hosts fallback on Manus CloudFront (now **403**), along with the two tests that grepped the source for it.
- [x] Made the HDX HAPI identifier configurable through `HAPI_APP_IDENTIFIER`. The legacy `@manus.im` identity is used, with a warning, until one is set.

### Needs decisions first (see §2)
- [ ] **P1** Auth: `server/_core/sdk.ts`, `oauth.ts` and `cookies.ts`, plus `client/src/const.ts` `getLoginUrl` (the Manus OAuth portal). It logs `OAUTH_SERVER_URL is not configured` on every boot, and every `protectedProcedure` route (saved queries, briefings, sharing…) is unusable.
- [ ] **P2** LLM: `server/_core/llm.ts` posts to the Manus "forge" proxy (`forge.manus.im` / `BUILT_IN_FORGE_*`). This powers Intel Chat (`ragEngine`), briefings, `signalClassifier`, `anomalyDetector`, and the geofence and conflict sweeps.
- [ ] **P3** Speech-to-text: `voiceTranscription.ts` (Whisper through forge) powers live translation. These are the 26 failing `translation.test.ts` tests.
- [ ] **P4** File storage: `server/storage.ts` uses the forge storage proxy for recordings and translation audio.
- [ ] **P5** Delete the unused forge wrappers: `_core/map.ts`, `dataApi.ts`, `imageGeneration.ts` and `notification.ts` (used only by `systemRouter`). Also delete `client/src/components/Map.tsx` (Google Maps through the forge proxy; imported nowhere).
- [ ] **P6** Test fixtures: change `loginMethod: "manus"` (5 files) and the `radio-globe.manus.space` origin in `targets.test.ts` once auth is replaced.
- [ ] **P7** Rename or remove the Manus scratch files: `todo.md`, `research_notes.md`, `screenshot_notes.md`, `serena-analysis-report.md`, `.serena/`.
- [ ] **P8** Register your own HDX HAPI identifier and set `HAPI_APP_IDENTIFIER`. HAPI returns 403 for unregistered identifiers, so this can't be a made-up value.

## 2. Decisions to make

1. **Login:** single-user/no login, a password, or GitHub OAuth.
2. **AI provider:** for chat, briefings and translation (translation needs speech-to-text).
3. **Database:** keep MySQL (run it in Docker), or port the schema to SQLite.
4. **Recordings storage:** local disk or an S3-compatible bucket. The AWS SDK is already a dependency.

## 3. Security and privacy (not Manus, but worse)

- [ ] **S1** `server/receiverStatus.ts` "ProxyPool" sends receiver status checks through **random free public proxies** pulled from `api.proxyscrape.com`. Strangers' proxies can read and alter that traffic. When the list fetch fails, it retries on every request; it logged 269 warnings in the first minute. **Remove it.**
- [ ] **S2** `client/src/lib/propagationService.ts` falls back to third-party CORS proxies (`api.allorigins.win`, `corsproxy.io`). Proxy these two feeds through our own Express server instead.
- [ ] **S3** TDoA calls `http://tdoa.kiwisdr.com` over plain HTTP. Upstream only offers HTTP, so document it at least.
- [ ] **S4** Optional: purge `.manus/db/` from git history. The files contain no password, so this is low priority.

## 4. Globe visuals

Priority order. P0 = clearly broken, P1 = visibly wrong, P2 = polish.

### P0: broken
- [ ] **N1** Fly-to uses `theta = -lng`; it should be `(lng + 90)°`. Stations land a quarter to half a screen off-centre after a click, a continent filter, TDoA, or IntelChat. Five call sites. CONFIRMED
- [ ] **N2** Geofence click inverse is 90° off everywhere; use `lon = atan2(-z, x)`. CONFIRMED
- [ ] **N3** Hover, click and tap raycasts ignore the globe, so clicking ocean selects a station on the far side of the Earth. CONFIRMED
- [ ] **N7** `FallbackMap` is never mounted, so WebGL failure, context loss and the FPS-critical path all show nothing. CONFIRMED
- [ ] **M1** `useImperativeHandle` sits after an early return, so the "3D Globe Unavailable" card can never render. Retry also never re-runs init. CONFIRMED
- [ ] **N5** Selection and hover are stored as array indices and go stale on every marker rebuild, so the wrong station pulses. CONFIRMED

### P1: visibly wrong
- [ ] **N4** `depthTest:false` on every ring, halo and TDoA/target overlay means they draw through the Earth. Far-side markers hide, but their rings float on the near side. CONFIRMED
- [ ] **N6** All 2,000 markers are destroyed and rebuilt every 2 s during status scans (`isStationOnline` identity changes on each poll), and ring pulses jump. CONFIRMED
- [ ] **M4** The animation loop forces every marker's opacity to 0.85, which erases the online/offline/unknown dimming. CONFIRMED
- [ ] **N9** Auto-rotate theta is never wrapped, and a hidden tab's delta isn't clamped. Fly-to after an hour idle spins 34 turns. CONFIRMED
- [ ] **N8** IntelChat highlight rings reach radius 4 on a radius-5 globe, which covers half the planet. CONFIRMED
- [ ] **V1** A broad Phong specular hotspot plus exposure 1.4 and four lights wash out the centre of the globe; a big cyan blob shows in every screenshot. Lower `specular`/`shininess`, or use `MeshStandardMaterial` with a sensible roughness. SEEN (software GPU); re-check on real hardware.
- [ ] **V2** At `QUALITY_LOW` the globe drops to a 16-segment sphere, so the silhouette is visibly polygonal and markers (placed on a true sphere) float off or sink into the faces. Use a 48+ segment floor; it's cheap. SEEN
- [ ] **N15** The governor's "start at MED on mobile" is never applied to the scene; `usePointMarkers` and `markerSegments` are unused. CONFIRMED
- [ ] **N13** Geofence edges are straight chords and the centroid isn't re-projected, so zones wider than about 15° sink into the globe. CONFIRMED
- [ ] **N12** Saved geofence zones are never drawn (`Home` passes `undefined` in both branches). CONFIRMED
- [ ] **N11** Ionosonde markers appear only after an unrelated re-render, because the data lives in a ref. CONFIRMED
- [ ] **N14** "Focus target" fakes a TDoA result for 500 ms, then wipes the real one. CONFIRMED
- [ ] **V3** Legend / globe colour mismatch. The legend shows type colours (KiwiSDR green, OpenWebRX cyan, WebSDR red), but dots get recoloured by status (online green, offline red, conflict amber, new violet). Online green looks like KiwiSDR, and offline red looks like WebSDR. Add status keys to the legend or use a different encoding. SEEN
- [ ] **V4** Earth textures load at runtime from `unpkg.com` with no error handler. If that fails, the globe is an untextured grey ball. Ship them in `client/public/`. CONFIRMED

### P1: layout and CSS
- [ ] **V5** The bottom-left stats bar is covered by the IntelChat button (reads "151… GETS"). SEEN
- [ ] **V6** The bottom-right "Scanning n/1541" pill is tucked under the legend. When idle, an empty bordered pill still renders (`Home.tsx` progress container). SEEN
- [ ] **V7** Mobile (390 px): the filter panel covers about half the screen by default, and the legend overlaps the stats bar and the chat button. SEEN
- [ ] **V8** The "Select a target…" hint sits over the globe and the South America markers; in light mode its dark text shadow looks muddy. SEEN

### P2: polish and robustness
- [ ] **N10** `targetSpherical` phi and radius aren't clamped, which causes dead zones after over-dragging or over-zooming.
- [ ] **N16** `disposeTdoaGroup` leaks label sprites, `CanvasTexture`s and heatmap textures.
- [ ] **N17a** No `mouseleave` handler, so the tooltip and the enlarged marker stick when the cursor leaves the canvas.
- [ ] **N17b** Pinch, then lift one finger: the camera jumps. PROBABLE
- [ ] **N17c** Markers are tone-mapped (ACES), so globe colours don't match the legend's hex values. Set `toneMapped:false`. PROBABLE
- [ ] **N17d** Context restore creates a second renderer that is never disposed.
- [ ] **V9** Light mode: the globe is lit identically to dark mode (dark ocean on a pale page), and the title's backdrop shows as a grey slab over the top of the globe. SEEN
- [ ] **M7** `preserveDrawingBuffer: true` is always on, just for screenshots; enable it only when capturing.
- [ ] **M8** One `MeshBasicMaterial` per conflict event; share materials per colour, or use `InstancedMesh`.
- [ ] **M14** The camera lerp is frame-rate dependent.

## 5. Reliability and developer experience

- [ ] **R1** The dev server silently moves to the next port when 3000 is busy. This caused stale-server confusion during this session. Fail loudly instead, or log it prominently.
- [ ] **R2** Directory aggregators return errors: `sdr-list.xyz` and `receiverbook.de` give HTTP 405, and the KiwiSDR GPS list times out. Re-check their current APIs.
- [ ] **R3** The 81 tests that need MySQL or AI keys should skip cleanly when those aren't configured, or run against a Docker DB in CI.
- [ ] **R4** Add `.env.example` documenting `DATABASE_URL`, `JWT_SECRET`, `HAPI_APP_IDENTIFIER`, `TDOA_AUTH_KEY`, `ACLED_*` and the AI keys.
- [ ] **R5** Client bundle chunk-size warning: code-split the heavy panels.
