# Code Style and Conventions

## TypeScript
- Strict TypeScript with noEmit checks
- Zod for runtime validation on all tRPC inputs
- Drizzle ORM typed schema with inferred types (e.g., typeof tdoaTargets.$inferSelect)
- Superjson for tRPC serialization

## Naming
- camelCase for variables, functions, and properties
- PascalCase for React components, interfaces, and types
- UPPER_SNAKE_CASE for constants
- Database tables: snake_case

## Architecture Patterns
- tRPC router pattern: publicProcedure / protectedProcedure with .input(z.object({...}))
- Service modules: standalone files in server/ (e.g., anomalyDetector.ts, positionPredictor.ts)
- React: functional components with hooks, contexts for shared state
- Three.js: imperative code in TDoAGlobeOverlay.ts, React wrapper in Globe.tsx

## File Organization
- server/_core/ - Framework plumbing (DO NOT EDIT)
- server/routers.ts - All tRPC procedures (should be split when >150 lines per router)
- drizzle/schema.ts - All database table definitions
- client/src/components/ - Reusable UI components
- client/src/pages/ - Route-level pages
- client/src/lib/ - Utility functions and services
- shared/ - Shared types and constants

## Testing
- Vitest with describe/it/expect pattern
- Tests in server/*.test.ts files
- Pure function unit tests (no DB mocking needed for utility functions)