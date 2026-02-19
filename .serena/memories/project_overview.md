# Radio Globe - Project Overview

## Purpose
Radio Globe is a full-stack web application for global SDR (Software-Defined Radio) receiver intelligence. It provides a 3D interactive globe visualization of ~1500+ KiwiSDR, OpenWebRX, and WebSDR receivers worldwide.

## Tech Stack
- Frontend: React 19 + TypeScript + Tailwind CSS 4 + shadcn/ui + Three.js (3D globe) + Recharts
- Backend: Express 4 + tRPC 11 + Drizzle ORM + MySQL/TiDB
- Auth: Manus OAuth with JWT session cookies
- Storage: S3 via platform helpers
- AI: LLM integration for signal classification
- Build: Vite + esbuild + pnpm
- Testing: Vitest (374 tests)

## Key Modules
- server/routers.ts (1879 lines) - All tRPC routers: receiver, tdoa, targets, recordings, anomalies, sharing, fingerprints, analytics
- server/tdoaService.ts - TDoA triangulation service
- server/positionPredictor.ts - Linear/polynomial regression for position prediction
- server/anomalyDetector.ts - Anomaly detection comparing positions against prediction ellipses
- server/signalClassifier.ts - LLM-based signal classification with frequency fallback
- server/kiwiRecorder.ts - WebSocket-based KiwiSDR audio recording
- client/src/components/Globe.tsx (1146 lines) - Three.js 3D globe with markers and overlays
- client/src/components/TDoAGlobeOverlay.ts (1123 lines) - TDoA visualization layer
- client/src/pages/Home.tsx (739 lines) - Main page orchestrating all panels
- client/src/pages/Dashboard.tsx - Analytics dashboard with charts

## Database Tables (13)
users, receivers, receiverStatusHistory, scanCycles, tdoaJobs, tdoaTargets, tdoaTargetHistory, tdoaRecordings, anomalyAlerts, sharedTargetLists, sharedListMembers, sharedListTargets, signalFingerprints