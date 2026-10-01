# Career Dashboard — agent guide

A private, single-owner workspace: a career library (source of truth) → job analysis → evidence-matched, tailored resume drafts → checks → export → application tracking. Claude analyzes and writes; the database decides what is true. Every generated resume sentence must point at a real achievement.

## Stack

Next.js 16 (App Router, `src/proxy.ts`), React 19, TypeScript strict, Tailwind v4, Drizzle + Neon (neon-http), Neon Auth, `@anthropic-ai/sdk`, Zod v4. Next 16 differs from older versions — read `node_modules/next/dist/docs/` before using an unfamiliar API (params are Promises, `middleware` is `proxy`, `revalidateTag` needs a profile).

## Conventions

- **Business logic lives in `src/lib/<area>/`** as plain functions taking `(db: Database, userId: string, …)`. They are unit-tested with PGlite. **Server actions** (`"use server"` files under `src/app/(app)/<area>/actions.ts`) are thin: `requireOwnerId()` → `requireDatabase()` → call the lib function → `revalidatePath(...)` → return `ActionResult` (`src/lib/action-result.ts`). Never trust ids from forms: always filter by `userId` too.
- **Pages** are server components under `src/app/(app)/` (the layout enforces the owner). Use `src/components/ui.tsx` (PageHeader, Card, Badge, FactBadge, EvidenceBadge, StatusBadge, EmptyState, Notice, Stat, ButtonLink, buttonClass) and `src/components/forms.tsx` (ActionForm, SubmitButton). Inputs use the `.input` class and labels the `.field` class. Colors: `bg-card`, `bg-muted`, `text-muted-foreground`, `border-border`, `bg-primary text-primary-foreground`, `text-ok/warn/bad` and `bg-ok-soft/warn-soft/bad-soft`. Must work at 390px wide with no horizontal page scroll (wrap tables in `overflow-x-auto`).
- **Claude calls** go through `runStructured()` in `src/lib/ai/run.ts` only. Each task lives in `src/lib/ai/tasks/<name>.ts` and exports its Zod schema, a `PROMPT_VERSION` like `"analyze@1"`, and a function. Give every call a deterministic `fake()` (used when `AI_FAKE=1`). Schemas for Claude output: every property required; use `.nullable()` not `.optional()`; no `.min/.max/.url/.regex` refinements. Pass the career library via `buildLibraryContext()` (`src/lib/ai/library.ts`) as `context`, and map aliases (R1, A1…) back with `resolveAliases()` — drop anything Claude invents. Effort: `low` for extraction-like tasks, `high` for matching/drafting. Long-running pages set `export const maxDuration = 300`.
- **Facts:** `fact_status` is verified | approximate | private | needs_confirmation. Private items are withheld from Claude unless the owner opts in. Never write Claude output into the library without the owner accepting it.
- **Learn content** (`src/content/learn/`) is curated TypeScript, never Claude output. Workflow stages and metrics reference glossary keys, and `tests/learn-content.test.ts` checks every reference. When you add or change a resource, open the provider's page first and copy its cost and effort; if the page doesn't say, say so instead of guessing. Bump `RESOURCES_CHECKED_ON`. Progress is stored in `learning_items` by content key (`term:…`, `resource:…`, `guide:<path>:<section>`).
- **Snapshots are immutable** (DB trigger). Freeze via insert only.
- **Migrations:** edit `src/db/schema.ts`, then `npx drizzle-kit generate --name=<change>`; keep them additive. Tests apply `drizzle/*.sql` to PGlite.

## Commands

`pnpm lint`, `pnpm typecheck`, `pnpm test` (all tests), `npx tsx --tsconfig tests/tsconfig.json --test tests/<file>.test.ts` (one file), `pnpm build`, `pnpm check` (everything).

Local run without Neon/Claude: `pnpm db:local && CAREER_LOCAL_DB=.local-db CAREER_DEV_PREVIEW=1 AI_FAKE=1 pnpm dev`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
