# Claude Customization for Tirvea

Claude (GitHub Copilot) uses the same conventions and patterns as all AI agents working in this codebase.

## Reference: AGENTS.md

For comprehensive setup, architecture patterns, conventions, and gotchas, see [AGENTS.md](AGENTS.md).

This includes:
- Quick start & common commands
- Architecture & design patterns (auth, RBAC, API responses, database)
- File structure overview
- Common pitfalls to avoid
- Testing & debugging patterns
- Tech stack & design system

## Key Reminders for Claude

1. **Always check Next.js 16 docs** in `node_modules/next/dist/docs/` — breaking changes apply here
2. **Prefer explicit RBAC** — every permission must be listed, no role hierarchy inference
3. **Use response envelopes** — every API response is `{ data }` or `{ error }`
4. **Link to docs, don't embed** — [docs/](docs/) contains feature docs (DESIGN-SYSTEM, AUTH-SETUP, TRUST-SAFETY, etc.)
5. **Study exemplar files** — [src/lib/auth.ts](src/lib/auth.ts), [src/lib/api.ts](src/lib/api.ts), [tests/trust-safety.test.ts](tests/trust-safety.test.ts)

## Quick Commands
```bash
npm run dev              # Turbopack dev
npm run build            # Production build
npx prisma migrate dev   # Create migration
npx tsx tests/*.test.ts  # Run integration tests
```

