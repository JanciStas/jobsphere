# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

JobSphere is an enterprise-grade Applicant Tracking System (ATS) powered by Anthropic's Claude AI. It's a monorepo built with Next.js 14, featuring AI CV parsing, hybrid job matching, email automation, skills assessments, and Stripe billing.

**Key Technologies:**

- Next.js 14 (App Router) with TypeScript
- Prisma ORM with PostgreSQL (pgvector extension for semantic search)
- NextAuth v4.24.7 for authentication (downgraded from v5 beta due to production bug)
- Turborepo for monorepo management
- TailwindCSS + shadcn/ui for UI
- BullMQ for background job processing
- Claude AI (Anthropic) for CV parsing and candidate matching

## Monorepo Structure

```
apps/
├── web/          # Main Next.js application
├── api/          # Standalone API (if needed)
└── workers/      # Background workers package

packages/
├── db/           # Shared Prisma schema and database client
├── ai/           # AI utilities (CV parsing, embeddings, Claude integration)
├── ui/           # Shared UI components
└── i18n/         # Internationalization utilities
```

## Essential Commands

### Development

```bash
# Install dependencies (use yarn - specified in packageManager)
yarn install

# Start development server (runs on port 3000)
yarn dev

# Run all tests with coverage
yarn test

# Run tests in watch mode (within apps/web)
cd apps/web && yarn test

# Run single test file
cd apps/web && yarn test path/to/test.spec.ts

# Run E2E tests
yarn test:e2e

# Run E2E tests with UI
cd apps/web && yarn test:e2e:ui
```

### Database Operations

```bash
# Generate Prisma client (run after schema changes)
yarn db:push
# OR for migrations
yarn db:migrate

# Open Prisma Studio
cd apps/web && yarn db:studio

# Seed database with test data
yarn db:seed

# Reset database (WARNING: deletes all data)
yarn db:reset
```

### Build & Deploy

```bash
# Type check all packages
yarn typecheck

# Lint all packages
yarn lint

# Format code
yarn format

# Build for production
yarn build

# Build web app only (skips env verification)
cd apps/web && yarn build:skip-verify
```

### Docker Services

```bash
# Start all infrastructure services (PostgreSQL, Redis, ClamAV, etc.)
yarn docker:up

# Stop all services
yarn docker:down

# View logs
yarn docker:logs
```

### Workers & Background Jobs

```bash
# Run BullMQ workers (email sequences, embeddings, assessments)
cd apps/web && yarn workers

# Watch mode for workers
cd apps/web && yarn workers:dev
```

## Architecture Patterns

### Authentication & Authorization

**NextAuth v4 Setup:**

- Configuration: `apps/web/src/lib/auth.ts`
- Supports Credentials (email/password) and Google OAuth
- Session strategy: JWT
- OAuth tokens are encrypted with AES-256-GCM (see `apps/web/src/lib/encryption.ts`)

**Authorization Pattern:**

- Multi-tenant: Users belong to Organizations via `UserOrgRole` junction table
- Roles: `ORG_ADMIN`, `RECRUITER`, `HIRING_MANAGER`, `AGENCY`
- Always verify user's organization membership before operations

**Example:**

```typescript
const session = await auth()
if (!session?.user?.id) throw new UnauthorizedError()

const membership = await prisma.userOrgRole.findFirst({
  where: { userId: session.user.id, orgId },
})
if (!membership) throw new Error('Not a member of this organization')
```

### NextAuth Version History

**Current Version: v4.24.7** (as of 2025-01)

**Why v4 instead of v5?**

- NextAuth v5 (beta.4) had a critical bug on Vercel production builds
- Error: "aQ is not a constructor" when calling `/api/auth/providers`
- Only occurred in production (worked in dev with `next dev`)
- Root cause: Constructor export issue in minified build
- Resolution: Downgraded to stable v4.24.7 (commit 0b5047b)

**Migration Path:**

- Stay on v4 until NextAuth v5 reaches stable release (not beta)
- Monitor: https://github.com/nextauthjs/next-auth/releases
- v5 offers benefits: Native Edge support, TypeScript improvements, better DX
- Migrate when: v5.0.0 stable released AND bug verified fixed

**v4 Configuration:**

- File: `apps/web/src/lib/auth.ts`
- Pattern: Export `authOptions` object, use `NextAuth(authOptions)`
- Session strategy: JWT (required for Vercel deployment)
- Adapter: PrismaAdapter from `@next-auth/prisma-adapter` v1.0.7

**v4 API Route Pattern:**

```typescript
// apps/web/src/app/api/auth/[...nextauth]/route.ts
import NextAuthHandler from '@/lib/auth'
export { NextAuthHandler as GET, NextAuthHandler as POST }
export const runtime = 'nodejs' // Required for bcryptjs and Prisma
```

**Getting Session in v4:**

```typescript
// Server Components
import { auth } from '@/lib/auth'
const session = await auth()

// Client Components
import { useSession } from 'next-auth/react'
const { data: session } = useSession()
```

**Differences from v5:**

- v5: `export const { auth, handlers } = NextAuth(config)`
- v4: `export default NextAuth(authOptions)` and `export const auth = () => getServerSession(authOptions)`
- v5: No `[...nextauth]` catch-all route needed
- v4: Requires `[...nextauth]/route.ts` catch-all

**Related Commits:**

- 0b5047b - Downgrade to v4.24.7
- 24b2d2c - Remove debug logging
- e8b88d8 - Remove debug endpoints

### Server Actions vs API Routes

**Prefer Server Actions for:**

- Form submissions
- Simple CRUD operations
- Operations triggered from Server Components

**Use API Routes for:**

- File uploads (`/api/upload`, `/api/cv/upload`)
- Webhooks (`/api/stripe/webhook`)
- External integrations
- Operations requiring custom headers/streaming

**Server Actions Location:** `apps/web/src/lib/actions/`

- `jobs.ts` - Job CRUD operations
- `applications.ts` - Application management
- `auth.ts` - Auth operations

### Data Access Layer

**Prisma Client:**

- Singleton instance: `apps/web/src/lib/prisma.ts`
- Always use this imported instance (do not create new clients)
- Schema location: `packages/db/prisma/schema.prisma`

**Key Models:**

- `User` - Authentication and user profiles
- `Organization` - Companies/Employers
- `UserOrgRole` - Organization memberships with roles
- `Job` - Job postings (fields: title, description, workMode, type, seniority, location, salaryMin/Max)
- `Application` - Job applications with status tracking
- `Candidate` - Candidate profiles with parsed CV data
- `MatchScore` - AI-powered job-candidate matching scores (uses vector similarity)
- `EmailSequence` - Automated email campaigns
- `Assessment` - Skills testing for candidates

### CV Parsing Pipeline

**Multi-Stage Fallback Architecture** (see `apps/web/src/lib/cv-parser-pipeline.ts`):

1. **Stage 0: Security Checks**
   - File size validation (max 10MB)
   - MIME type verification (prevents spoofing)
   - VBA macro detection in DOCX files
   - ClamAV antivirus scanning (if enabled)

2. **Stage 1: Node.js Parser** (~100ms)
   - PDF: `pdf-parse` library
   - DOCX: `mammoth` library
   - Success if extracted text > 50 chars

3. **Stage 2: OCR Fallback** (~2-3s per page)
   - Python service with Tesseract
   - Supports: EN, DE, SK, CS, PL
   - Endpoint: Docker container `python-parser`

4. **Stage 3: Metadata Fallback**
   - Extracts filename, file metadata
   - Returns graceful degradation response

**AI Extraction:**

- After text extraction, Claude AI parses structured data
- Fields: name, email, phone, skills, experience, education
- Located in: `packages/ai/`

**Configuration:**

```bash
ENABLE_OCR=true
OCR_TIMEOUT=30000
ENABLE_ANTIVIRUS=true
CLAMAV_HOST=clamav
CLAMAV_PORT=3310
```

### Rate Limiting & Security

**Rate Limiting** (`apps/web/src/lib/rate-limit.ts`):

- Uses Redis (Upstash) with sliding window algorithm — **v produkcii `KV_REST_API_URL/TOKEN` nie sú nastavené, limiter padá na in-memory fallback, ktorý sa resetuje každým cold startom** (nález 2026-09-14 M2)
- Presets:
  - `auth`: 5 req/min (login, signup)
  - `api`: 100 req/min (authenticated APIs)
  - `public`: 200 req/min (public endpoints)
  - `strict`: 10 req/15min (sensitive operations)
  - `upload`: 10 req/5min (file uploads)

**Wrap API routes:**

```typescript
import { withRateLimit } from '@/lib/rate-limit'

export const POST = withRateLimit(
  async (req) => {
    /* handler */
  },
  { preset: 'upload', byUser: true },
)
```

**Security Features:**

- AES-256-GCM encryption for OAuth tokens (`apps/web/src/lib/encryption.ts`)
- CSRF protection (`apps/web/src/lib/csrf.ts`)
- Audit logging (`apps/web/src/lib/audit-log.ts`)
- Zod validation on all inputs (`apps/web/src/lib/validation.ts`)
- Security headers configured in `next.config.js`

### Background Jobs (BullMQ)

**Workers Location:** `apps/web/src/workers/`

- `email-sequence.worker.ts` - Automated drip campaigns
- `embedding.worker.ts` - Generate vector embeddings for jobs/candidates
- `assessment-grading.worker.ts` - Auto-grade skills assessments

**Queue System:**

- Uses Redis for job storage
- Configured in `apps/web/src/lib/queue.ts`
- Start workers: `yarn workers`

**Adding a new job:**

```typescript
import { emailQueue } from '@/lib/queue'

await emailQueue.add('send-email', {
  to: 'user@example.com',
  template: 'application-received',
  data: { candidateName, jobTitle },
})
```

### Internationalization (i18n)

**Supported Locales:** EN, DE, CS, SK, PL

- Library: `next-intl`
- Messages: `apps/web/messages/{locale}.json`
- All routes are under `[locale]` dynamic segment

**Usage in components:**

```typescript
import { useTranslations } from 'next-intl'

const t = useTranslations('JobsPage')
return <h1>{t('title')}</h1>
```

**Server-side:**

```typescript
import { getTranslations } from 'next-intl/server'

const t = await getTranslations('JobsPage')
```

## Common Workflows

### Adding a New API Route

1. Create route file: `apps/web/src/app/api/{endpoint}/route.ts`
2. Apply rate limiting with `withRateLimit`
3. Validate input with Zod schema
4. Check authentication with `await auth()`
5. Verify organization membership if needed
6. Use Prisma client from `@/lib/prisma`
7. Add error handling and logging

### Modifying Database Schema

1. Edit `packages/db/prisma/schema.prisma`
2. Generate migration: `cd packages/db && yarn db:migrate`
3. Or push without migration: `yarn db:push`
4. Regenerate Prisma client: `yarn db:generate`
5. Update TypeScript types if needed
6. Restart dev server to pick up new types

### Testing

**Unit/Integration Tests:**

- Framework: Vitest
- Location: `apps/web/src/lib/__tests__/`
- Coverage prah je **ratchet na nameraných hodnotách** (`apps/web/vitest.config.ts`: statements 22 / branches 61 / functions 39 / lines 22), nie 80 % — pozri poznámku z 2026-07-29 nižšie

**E2E Tests:**

- Framework: Playwright
- Location: `apps/web/tests/e2e/`
- Run: `yarn test:e2e`

**Mocking Prisma:**

`vitest-mock-extended` **nie je závislosťou tohto repa** a `mockDeep` sa nepoužíva ani v jednom teste
(overené 2026-07-29) — nasledujúci vzor by nezbehol. Skutočná konvencia sú plain `vi.fn()` mocky:

```typescript
vi.mock('@/lib/prisma', () => ({
  prisma: {
    candidate: { findFirst: vi.fn(), findMany: vi.fn() },
    matchScore: { findMany: vi.fn(), upsert: vi.fn() },
  },
}))
```

Vzor v praxi: `apps/web/src/app/api/candidates/[id]/__tests__/match-scores.test.ts`.

## Environment Variables

**Required for Development:**

```bash
DATABASE_URL                # PostgreSQL connection string
NEXTAUTH_URL                # http://localhost:3000
NEXTAUTH_SECRET            # Generate with: openssl rand -base64 32
ENCRYPTION_KEY             # Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ANTHROPIC_API_KEY          # Claude AI API key
```

**Optional but Recommended:**

```bash
GOOGLE_CLIENT_ID           # Google OAuth
GOOGLE_CLIENT_SECRET
KV_REST_API_URL           # Upstash Redis for rate limiting
KV_REST_API_TOKEN
RESEND_API_KEY            # Email service (or use EMAIL_SERVICE="log")
STRIPE_SECRET_KEY         # Billing
```

**Docker Environment:**

- Start services: `yarn docker:up`
- Default DATABASE_URL: `postgresql://jobsphere:jobsphere_dev_2024@localhost:5432/jobsphere`
- Default REDIS_URL: `redis://localhost:6379`

## Important Notes

### File Uploads

- Current: Local storage in `public/uploads/cvs/`
- Production: Migrate to Vercel Blob or S3
- Max size: 10MB (configurable via `MAX_FILE_SIZE`)
- Allowed types: PDF, DOC, DOCX

### Semantic Search

- Uses pgvector extension for vector similarity
- Embeddings stored in `ResumeSection.embeddingVector` and `Job.embedding` (pgvector `Unsupported("vector")`; HNSW indexy existujú len v SQL migrácii)
- Generate embeddings via `embedding.worker.ts` (queue path) alebo hodinový backfill `/api/cron/embeddings` (Vercel Cron — jediná cesta, ktorá v produkcii reálne beží)
- Search implementation: `apps/web/src/lib/semantic-search.ts`

### Email System

- Abstraction layer: `apps/web/src/lib/email.ts`
- Providers: Resend, SendGrid, or log-only (dev)
- Set `EMAIL_SERVICE` env var
- Templates use React components (if using Resend)

### Stripe Integration

- Webhook handler: `apps/web/src/api/stripe/webhook/route.ts`
- Subscription management via `Subscription` model
- Entitlements checked in `apps/web/src/lib/entitlements.ts`

### Error Handling

- Custom errors: `apps/web/src/lib/errors.ts`
- Use `UnauthorizedError`, `ValidationError`, etc.
- Sentry integration for production error tracking

### Code Style

- Strict TypeScript mode enabled
- ESLint + Prettier configured
- Pre-commit hooks via Husky
- Use `yarn format` before committing

## Recent Updates (January 2026)

All 30+ incomplete features have been completed across 5 implementation phases.

### Phase 1-2: Email System (✅ COMPLETED)

**Email Verification & Password Reset:**

- ✅ Email verification with tokens (1-hour expiry) - `apps/web/src/services/user.service.ts`
- ✅ Password reset flow with secure token generation
- ✅ Email tracking via EmailMessage/EmailThread models
- ✅ Integration with Resend and SendGrid providers

**Email Sequences & Assessments:**

- ✅ Automated email sequences with smart conditions (stage_changed, replied, opened)
- ✅ Condition evaluation using EmailEvent tracking - `apps/web/src/workers/email-sequence.worker.ts` (`apps/workers/` je mimo workspaces a mŕtve od PR #12)
- ✅ Assessment reminder emails with candidate notifications
- ✅ Worker-based email sending with retry logic

### Phase 3: GDPR Compliance (✅ COMPLETED)

**Database Models:**

- ✅ ConsentRecord - Track user consent for MARKETING, ANALYTICS, COOKIES
- ✅ DSARRequest - Data Subject Access Requests (EXPORT, DELETE)
- ✅ WebVitalsMetric - Performance monitoring data
- Schema: `packages/db/prisma/schema.prisma` (lines 1278-1335)

**GDPR APIs:**

- ✅ `/api/gdpr/export` - Export all user data as JSON
- ✅ `/api/gdpr/consent` - Record and manage consent preferences
- ✅ `/api/gdpr/dsar` - Submit and track DSAR requests
- ✅ Email notifications to GDPR admin and user

**Configuration:**

- Set `GDPR_ADMIN_EMAIL` env var for DSAR notifications
- All requests tracked with IP address and user agent
- 30-day processing requirement enforced

### Phase 4: Background Jobs & Monitoring (✅ COMPLETED)

**BullMQ Cron Jobs:**

- ⚠️ BullMQ repeatable jobs (`apps/web/src/lib/cron.ts`) **nikdy v produkcii nebežali** — Vercel nemá worker proces. Od 2026-08-14 beží plánovaná práca cez **Vercel Cron** (`vercel.json` → `/api/cron/{email-sequences,assessment-reminders,retention,embeddings}`), ktorý volá tie isté procesory cez `JobLike`
- ✅ Assessment reminders: Daily at 9 AM UTC
- ✅ Email sequences: Every 15 minutes
- ✅ Redis-backed persistence with automatic retry
- `initializeCronJobs()` je relevantné len pre samostatný worker proces (`yarn workers`), ktorý v produkcii neexistuje

**Web Vitals Monitoring:**

- ✅ Activated web-vitals package integration
- ✅ Tracks CLS, FCP, FID, INP, LCP, TTFB metrics
- ✅ Database storage for long-term analysis
- ✅ Real-time reporting to `/api/analytics/web-vitals`
- Import: `reportWebVitals()` in `apps/web/src/lib/monitoring/web-vitals.ts`

**Plan Identification:**

- ✅ Fixed `getCurrentPlan()` in `apps/web/src/lib/entitlements.ts`
- ✅ Multi-strategy plan detection:
  1. Product relationship lookup
  2. Subscription metadata check
  3. Product name parsing fallback

**CV Storage Security:**

- ✅ Vercel Blob `access:'private'` (`@vercel/blob` 2.5; finding F6) — CVs are private at rest; the authenticated `/api/cv/{id}/download` route reads them via the SDK `get({access:'private'})` (with a `fetch()` fallback for legacy public blobs).
- ✅ Implemented local file deletion with fs/promises
- ✅ Signed URLs for secure CV access (download route authorizes the caller)
- File: `apps/web/src/lib/cv-storage.ts`

### Phase 5: Documentation (✅ COMPLETED)

**Environment Variables:**

- ✅ Added `GDPR_ADMIN_EMAIL` to `.env.example`
- ✅ Added `STORAGE_PROVIDER` configuration
- ✅ Documented all email and worker settings

**Verification Commands:**

```bash
# Type check (should pass with no errors)
cd apps/web && yarn tsc --noEmit

# Run tests
yarn test

# Check build
yarn build
```

### Migration Required

Produkcia historicky preberala schému cez `db push`, takže `_prisma_migrations` nemusí sedieť — **`migrate deploy` proti produkcii nepúšťať** (a `db push` by zahodil HNSW indexy). Nové migrácie sú idempotentné a aplikujú sa `prisma db execute --file`. Historický postup (len pre čerstvú DB):

```bash
cd packages/db
npx prisma migrate deploy
# or
npx prisma migrate dev --name add-gdpr-and-web-vitals-models
npx prisma generate
```

### Production Readiness

**Status (2026-09-14): 70 % pripravenosti** — pozri `PRODUCTION_TEST_REPORT_2026-09-14.md`. Pôvodné „10/10 — All features complete" z januára neplatí: billing bez Stripe kľúčov, E2E 21/300, integrácia 256/371.

- ✅ Email verification & password reset
- ✅ Email sequences with smart conditions
- ✅ GDPR compliance (export, consent, DSAR)
- ✅ Background jobs with BullMQ repeatable jobs
- ✅ Web Vitals monitoring
- ✅ Secure CV storage with private access
- ✅ Plan identification working
- ✅ Documentation complete

---

## Pracovný štandard — Definition of Done po každej úprave kódu

Po dokončení AKEJKOĽVEK zmeny kódu, pred ohlásením „hotovo" a pred commitom, VŽDY a v tomto poradí:

1. **Diff-scoped security check** — prejdi LEN zmenené súbory/riadky (`git diff`) proti checklistu:
   secrets/leak · authZ & IDOR · **multi-tenant org-scoping (`orgId` + `UserOrgRole`)** · input validation (Zod) ·
   injection (Prisma `$queryRaw`/command/path) · Stripe/webhook podpis · PII/GDPR. Toto NIE je full-repo audit.
2. **Quality gate** — spusti typecheck + lint + testy. Ak pre dotknutú cestu existuje security test, musí prejsť;
   ak na novej/zmenenej kritickej ceste chýba, DOPÍŠ ho.
3. **Posture update** — ak pribudol/zanikol nález, prepočítaj posture skóre
   (od 100: Critical −20 / High −10 / Medium −4 / Low −1) a aktualizuj sekciu `## Security posture`
   aj `bezpecnostny-audit/findings.json`.
4. **Pravidlá** — žiadne secrets do logov/výstupu (len súbor + typ); nič needituj mimo scope zmeny
   bez upozornenia; oprav root cause, nie symptóm.

Príkazy projektu: typecheck=`yarn typecheck` · lint=`yarn lint` · test=`yarn test` · audit=`yarn audit`

> Hooky v `.claude/settings.json` toto čiastočne vynucujú (PostToolUse: prettier + secret-scan; Stop-gate: typecheck+lint).
> Manuálne kedykoľvek: `/po-zmene`.

> **2026-07-29 — brány reálne strážia.** Do tohto dátumu `yarn lint` nekontroloval **nič**: `.eslintrc.json`
> mal v `ignorePatterns` `apps/**` a `packages/**`, takže ESLint (vrátane `eslint-plugin-security`) preskakoval
> každý zdrojový súbor — „zelený lint" v CI aj v Stop-gate bol bezobsažný. Po zapnutí: 133 errorov, všetky opravené.
> Rovnako `coverage.exclude` vo `vitest.config.ts` prepisoval defaulty, takže sa do coverage rátali testy a `.next/`;
> prah 80 % nebol nikdy dosiahnuteľný. Prah je teraz na **nameranej** hodnote (lines 19 / branches 58 / functions 36)
> a slúži ako ratchet proti regresii.

## Security posture

skóre: **69/100** (findings.json, sweep 2026-09-15) — počítané formulou nižšie len z `bezpecnostny-audit/findings.json` (Critical/High/Medium/Low), nie z celého production-readiness reportu; predošlá hodnota 74 v tejto sekcii omylom miešala security nálezy s QA metrikami (H6 E2E, M4 integrácia), ktoré nie sú vo findings.json. Tie sa teraz merajú a hlásia samostatne (pozri nižšie) — obe sa v tomto kole dramaticky zlepšili.

otvorené: **0 Critical · 2 High** (H4 Stripe env, SEC-1 Next 14.2.35 — už najnovší 14.x patch, ďalšia oprava = major upgrade na Next 15+, mimo rozsahu) · **2 Medium** (M2 KV rate-limit env, M9 Trivy CI gate — zámerne vypnutý, kým SEC-1 nemá patch) · **3 Low** (SEC-5 swagger-ui-react, SEC-6 axios/@sendgrid, L3 HEALTH_CHECK_SECRET) | opravené v tomto kole (2026-09-15): H3 (mŕtva results route), M1 (OAuth tlačidlá), SEC-2 (next-auth → 4.24.15), SEC-3 (xmldom → 0.8.15 cez root `resolutions`), plus M7-i18n a 4 appkové bugy mimo tejto tabuľky (embeddings sa nikdy neukladali, withdraw crash, pagination 500, MULTI_SELECT grading) — pozri `bezpecnostny-audit/findings.json`.

**Integrácia a E2E — namerané znova 2026-09-15** (predošlé čísla boli skreslené: integračná suita bežala s data-collision medzi `packages/db` a `apps/web` testami, E2E bežalo cez `yarn dev` s on-demand kompiláciou spôsobujúcou 10s timeouty na každý login):

- Integrácia (čistá izolovaná test DB): **373/381 (97,9 %)**, hore z 256/371 (69 %). Zvyšných 8 zlyhaní sú testovacie chyby/timing-citlivosti (overené jednotlivo), nie appkové bugy.
- E2E chromium proti produkčnému buildu (`yarn start`, ako CI): **230/296 passed** na prvom behu (6 failed, 2 flaky-ale-passed-on-retry, 48 skipped, 10 nespustené), hore z 21/300 (7 %). Z tých 6: 2 opravené a jednotlivo overené (OAuth test aktualizovaný na nové M1 správanie; mobilný hamburger touch-target opravený `shrink-0` v `nav-drawer.tsx`), 1 (multi-select assessment redirect) vyšetrený bez jednoznačnej príčiny — appka aj server logujú úspech, problém je klientsky, treba ďalší dedikovaný pass. Zvyšné 3 (candidate-search ×2, cv-upload PDF) padajú na chýbajúcich env kľúčoch v E2E prostredí (OPENAI_API_KEY, storage/ClamAV), nie appkový bug.

Formula skóre (nezmenená): 100 − Critical·20 − High·10 − Medium·4 − Low·1.

> Predošlá baseline (100/100, 2026-06-29): `bezpecnostny-audit/SECURITY_REPORT_2026-06-29.md` · tracking: `bezpecnostny-audit/findings.json`. M5 = samostatný follow-up PR (workeri + Prisma schéma, testovať mimo prod).

> Re-baseline: `Read SECURITY_AUDIT_TESTS_REPORT.md and execute it as a prompt.` · diff-scoped DoD: `/po-zmene`.

## Pointery (detail v agent_docs/)

- Auth & multi-tenancy: `@agent_docs/auth.md`
- Stripe & entitlements: `@agent_docs/stripe.md`
- Dátový model & tenant scoping: `@agent_docs/data-model.md`
- Deploy & env: `@agent_docs/deploy.md`
- Pracovný štandard / DoD / hooky: `@CC_MASTER_WORKFLOW.md`
