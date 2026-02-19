# Task Completion Checklist

When completing a task, run these steps in order:

1. npx tsc --noEmit - Verify zero TypeScript errors
2. pnpm test - Run all vitest tests (currently 374 tests)
3. pnpm format - Format code with Prettier
4. Update todo.md - Mark completed items as [x]
5. Save checkpoint via webdev_save_checkpoint

## Before Committing
- Ensure no console.log statements in production code (server logging with tags like [TDoA] is acceptable)
- Verify no hardcoded secrets or API keys
- Check that new tRPC procedures have Zod input validation
- Ensure new database columns have appropriate defaults or are nullable
- Run pnpm db:push if schema was modified