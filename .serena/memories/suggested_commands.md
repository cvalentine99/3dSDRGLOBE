# Suggested Commands

## Development
- pnpm dev - Start development server (NODE_ENV=development tsx watch server/_core/index.ts)
- pnpm build - Build for production (vite build + esbuild server bundle)

## Database
- pnpm db:push - Generate and run Drizzle migrations (drizzle-kit generate && drizzle-kit migrate)

## Testing
- pnpm test - Run all vitest tests (vitest run)
- npx vitest run server/targets.test.ts - Run specific test file

## Type Checking
- npx tsc --noEmit - Full TypeScript type check

## Formatting
- pnpm format - Format code with Prettier

## Package Management
- pnpm add <package> - Add dependency
- pnpm add -D <package> - Add dev dependency