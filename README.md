# Career Dashboard

A private, Claude-powered workspace for job applications. It is built on one rule: **every sentence in a resume must point at real experience.**

1. **Career library** (`/profile`, `/achievements`). Your roles, achievements, metrics, skills and credentials. Each fact is marked *verified*, *approximate*, *private* or *needs confirmation*. Claude can read your resume in (`/profile/import`), but nothing enters the library until you accept it.
2. **Jobs** (`/jobs`). Paste a posting. Claude pulls out the requirements, then labels each one against your library as *strong evidence*, *transferable*, or a *gap*. Jobs are ranked by your own criteria, and every score is explained.
3. **Resume drafts** (`/jobs/[id]/resume/[draft]`):
   - Claude drafts a tailored, single-column resume. Every bullet cites the achievement it came from.
   - You accept, reject, lock, edit or regenerate each bullet, with controls for tone, length and emphasis.
   - Rule checks catch numbers that aren't in the achievement, implied titles, SaaS claims without a SaaS role, date problems, duplicates and vague filler. Claude can also review the draft as a skeptical interviewer would.
4. **Export.** DOCX, a text-based PDF, or plain text. A cover letter can be drafted from the same approved facts.
5. **Track** (`/applications`). Marking a job *applied* freezes the exact resume, cover letter and posting in insert-only snapshots, which a database trigger protects. Next actions, contacts and outcomes stay beside them.
6. **Claude activity** (`/activity`) logs every call's tokens and estimated cost. A daily budget caps spending.

## Stack

Next.js 16 on Vercel · Neon Postgres and Neon Auth · Drizzle · Anthropic API (`@anthropic-ai/sdk`, structured outputs, server-side only) · Tailwind v4.

## Environment variables

| Name | What it is |
|---|---|
| `DATABASE_URL` | Neon pooled connection string |
| `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` | Neon Auth endpoint and a random cookie secret of 32 or more characters |
| `OWNER_EMAIL` | The only account allowed in. Its email must be verified; Google sign-in verifies it. |
| `NEXT_PUBLIC_APP_URL` | The public origin |
| `ANTHROPIC_API_KEY` | Claude API key (server-side only) |
| `CLAUDE_MODEL` | Optional. Defaults to `claude-opus-5-5`; `claude-sonnet-5-5` costs about half as much. |
| `AI_DAILY_BUDGET_USD` | Optional. Daily spending cap, default `5`. |

## Develop

```bash
pnpm install
pnpm db:local                                   # PGlite sandbox with all migrations
CAREER_LOCAL_DB=.local-db CAREER_DEV_PREVIEW=1 AI_FAKE=1 pnpm dev
pnpm check                                      # lint, typecheck, tests, build
```

`AI_FAKE=1` returns canned Claude output, so local runs and tests never spend money. `CAREER_DEV_PREVIEW=1` skips sign-in, and only under `next dev`.

## Database changes

Edit `src/db/schema.ts`, run `npx drizzle-kit generate --name=<change>`, keep the migration additive, and apply the new `drizzle/*.sql` file to Neon before deploying code that needs it.
