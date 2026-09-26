# JobSphere — hĺbkový audit celej aplikácie

Dátum: **2026-09-26** · Vetva: `main` · Commit: **`0ff8e08`** (2026-09-15)
Metodika: findings-first · statické brány spustené reálne · runtime overenie v izolácii · vyvrátenie hypotéz
Rozsah: `apps/web` (94 API routes), `packages/{ai,db}`, frontend, CI, závislosti, i18n, schéma
Nadväzuje na: `audit/AUDIT_REPORT.md` (2026-06-10, 142 nálezov) a `bezpecnostny-audit/findings.json` (2026-09-15)

> **Tento report je výsledkom DVoch pokusov.** Prvý (A1–A11) bol statický a sám seba ohodnotil na 50 % —
> minul build, frontend, schému a nespustil ani jeden test sústavy. Druhý pokus (A12–A19) doplnil build,
> frontend, schému, N+1 a **dokázal A1/A3/A4 spustením**, nie čítaním. Záznam oboch pokusov s časom
> a hodnotením: `audit/ATTEMPTS_LOG.md`. Nálezy z druhého pokusu sú nižšie označené **(P2)**.

---

## 1. Verdikt

**Kód je v lepšom stave, než hovoria jeho vlastné dokumenty — ale má jednu dieru v autorizácii, ktorá
ruší celý model „odobrania člena z organizácie", a jednu triedu chýb, ktorá sa v tomto repe systematicky
opakuje: rozchádzajúce sa validačné pravidlá medzi POST a PUT/PATCH na tej istej entite.**

Kvalitatívne brány sú zelené (typecheck 0 chýb, lint 0 chýb, **build prejde**, testy 96/96 súborov bez
zlyhania, i18n 5×1162 kľúčov bez rozdielu) a väčšina z 94 routes má korektný tenant scoping. Audit
napriek tomu našiel **20 nových nálezov: 5 High, 10 Medium, 5 Low** — z toho jeden je **regresia**
nálezu, ktorý bol v júni označený za opravený, a tri High sú vo frontende, ktorý prvý pokus vôbec
nemeral.

Projekčné skóre po započítaní týchto nálezov do `findings.json` je **záporné** (−16 podľa projektovej
formuly), čo znamená, že **formula je vyčerpaná**, nie že by projekt bol pod nulou — pozri §8.
Reálna produkčná pripravenosť je bližšie k **55 %**: jadro je slušné, ale pred nasadením treba A1,
A12–A14 a A2.

**Blokery pred produkciou:** A1 (odobraný člen má stále prístup), A2 (Next.js bez bezpečnostnej podpory)
a A12/A14 (touch targety a metadata na päťjazyčnom verejnom webe).

---

## 2. Potvrdené nálezy

### 🔴 A1 — Odobraný člen organizácie si zachová plný prístup (autorizačná obchádzka)

**Súbory:** `packages/db/prisma/schema.prisma:183-205` · `apps/web/src/lib/prisma.ts:19` ·
`apps/web/src/lib/api-helpers.ts:40-43` · `apps/web/src/lib/auth.ts:211-215` ·
`apps/web/src/app/api/organizations/current/members/[userId]/route.ts:141-152`

Model `UserOrgRole` má `deletedAt DateTime?` (schema:197) a **odobranie člena ho nastaví**:

```ts
// organizations/current/members/[userId]/route.ts:141-152
await prisma.userOrgRole.update({
  where: { userId_orgId: { userId: params.userId, orgId: userOrgRole.orgId } },
  data: { deletedAt: new Date() },
})
```

Ale `UserOrgRole` **nie je** v zozname soft-delete modelov, takže middleware automatický filter nepridá:

```ts
// lib/prisma.ts:19
const MODELS_WITH_SOFT_DELETE = ['Job', 'Organization', 'User', 'Candidate', 'Application']
```

A guard, za ktorým stojí takmer každá org-scoped route, filtruje iba podľa `userId`:

```ts
// lib/api-helpers.ts:40-43
const orgMember = await prisma.userOrgRole.findFirst({
  where: { userId: session.user.id },
  include: { organization: true },
})
```

**Dopad — a prečo je to horšie než 24-hodinová session:** odobranie člena **nezvyšuje** `sessionEpoch`,
takže `AUTH-001` revokácia sa nespustí. A JWT callback pri ďalšom prihlásení načíta membership tiež bez
filtra `deletedAt`:

```ts
// lib/auth.ts:212-215
prisma.userOrgRole.findMany({
  where: { userId: user.id }, // ← žiadne deletedAt: null
  include: { organization: { select: { id: true, name: true } } },
})
```

Takže odobraný člen (aj odobraný `ORG_ADMIN`) sa **prihlási znova a má prístup ďalej** — nie je to
dočasné okno, je to trvalé. Admin guard na `members/[userId]` (riadky 105-110) má tú istú chybu
(`findFirst({ where: { userId, role: 'ORG_ADMIN' } })`), takže odobraný admin môže ďalej spravovať tím.

**Reprodukcia:** vytvor člena → over, že vidí org dáta → odober ho → **prihlás sa znova** → stále vidí.
**Oprava:** pridať `'UserOrgRole'` do `MODELS_WITH_SOFT_DELETE` **alebo** doplniť `deletedAt: null` do
oboch read path (helper + JWT callback) **a** pri odobraní inkrementovať `sessionEpoch`.

---

### 🔴 A2 — Next.js 14.2.35: eskalácia SEC-1, nová DoS dosiahnuteľná na Verceli

**Súbor:** `apps/web/package.json:88` (`"next": "^14.2.35"`)

Namerané `yarn audit`: **2 Critical + 72 High** v 195 nálezoch. Kritické sú obe Next.js a vyžadujú
`>=15.5.24`:

| Severity | Advisory                                             | Patched        |
| -------- | ---------------------------------------------------- | -------------- |
| Critical | Unauthenticated RCE on windows-hosted servers        | `>=15.5.24`    |
| Critical | Unauthenticated RCE in Image Optimization API (AVIF) | `>=15.5.24`    |
| **High** | **DoS cez nezabezpečenú deserializáciu RSC**         | **`>=15.0.8`** |

Prvé dve sú podľa `findings.json` „na Verceli nedosiahnuteľné" (Windows-only / AVIF config). **Tretí je
však nový a dosiahnuteľný** — RSC deserializácia beží na každom Vercel deployi, ktorý používa App Router.
Toto mení povahu SEC-1: z „nález mimo našej kontroly" na „dosiahnuteľný DoS bez autentifikácie".
`14.2.35` je posledný vydaný 14.x patch, takže jediná oprava je major upgrade na **Next 15.5.24+**.

---

### 🟡 A3 — `PUT /api/jobs/[id]`: cross-tenant injection cudzích FK

**Súbor:** `apps/web/src/app/api/jobs/[id]/route.ts:14-43` (schéma), `:154-175` (zápis)

`updateJobSchema` prijíma `assessmentId` aj `assignedRecruiterId` a handler ich `spread`-ne priamo do
`update()` **bez validačnej logiky, ktorú má POST na tej istej entite**:

```ts
// jobs/[id]/route.ts:154-175
const data = updateJobSchema.parse(rawData)
const updated = await prisma.job.update({
  where: { id: params.id },
  data: { ...data /* ... */ },
})
```

POST pritom obe polia validuje proti organizácii volajúceho:

```ts
// jobs/route.ts:262-278  (assignedRecruiterId → členstvo)
// jobs/route.ts:287-299  (assessmentId → where: { id, orgId: organizationId })
```

**Dopad:** člen s právom editovať vlastný job môže cez PUT priradiť **cudzí `assessmentId`** (následní
uchádzači dostanú pozvánky na cudzí test → únik jeho otázok) alebo **ľubovoľné `userId`** ako
zodpovedného recruitéra (spustí notifikáciu nečlenovi).

---

### 🟡 A4 — `PATCH /api/applications/[id]/interviews/[interviewId]`: nevalidovaný `branchId`

**Súbor:** `apps/web/src/app/api/applications/[id]/interviews/[interviewId]/route.ts:30`, `:100`

```ts
// riadok 100 — zapíše sa priamo
...(data.branchId !== undefined && { branchId: data.branchId }),
```

POST na rovnakej entite pritom cudziu branch odmieta:

```ts
// interviews/route.ts:120-124
const branch = await prisma.branch.findUnique({ where: { id: data.branchId } })
if (!branch || branch.deletedAt || branch.orgId !== orgId) {
  return NextResponse.json({ error: 'Invalid branch' }, { status: 400 })
}
```

**Dopad:** interview možno pripnúť na branch inej organizácie; každé UI, ktoré renderuje jej adresu,
odhalí dáta cudzieho tenanta.

---

### 🟡 A5 — Regresia: `sanitize-html` je opäť zraniteľný

**Súbor:** `apps/web/package.json:101` (`^2.17.4`) · nainštalované: **2.17.5**

Nález **F4** bol 2026-06-29 uzavretý ako opravený (bump na `^2.17.4`, resolved 2.17.5). Odvtedy vyšli
ďalšie dve advisories v tom istom balíku:

- Mutation-XSS / `allowedTags` bypass cez `</textarea/>` — patched `>=2.17.6`
- Stored XSS cez SVG SMIL URI-list scheme-policy bypass — patched `>=2.17.7`

`sanitize-html` je v runtime cestách spracúvajúcich používateľský vstup, takže dosiahnuteľnosť je reálna.
**Oprava je jednoriadková:** `^2.17.7`. Toto je najlepší pomer dopadu a nákladu z celého auditu.

---

### 🟡 A6 — „Per-user" rate limiting reálne neexistuje, všetko je per-IP

**Súbor:** `apps/web/src/lib/rate-limit.ts:410-421` · **82 volaní** `withRateLimit({ byUser: true })`

```ts
if (options.byUser) {
  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    identifier = authHeader.substring(7)
  } else {
    identifier = getClientIp(request) // ← sem to vždy spadne
  }
}
```

Appka posiela session v **cookie**, nie v `Authorization: Bearer` — grep v `src/` nájde Bearer hlavičku
len v OAuth callbackoch, cron auth a health sondách. Takže `byUser: true` **nikdy** nedostane user id a
82 routes sa limit-uje podľa IP. Dôsledok: limity sa delia medzi všetkých za jedným NAT/proxy a
zároveň sú obchádzateľné rotáciou IP.

Naviac `getClientIp()` (`rate-limit.ts:357-372`) berie `x-forwarded-for.split(',')[0]` — prvú hodnotu,
ktorá je spoľahlivá len ak platforma hlavičku **prepisuje** a nie pripája. Odporúčam čítať `x-real-ip`
(Vercel ho nastavuje) a `x-forwarded-for` použiť len ako fallback.

---

### 🟡 A7 — `requireOrgAuth()` pracuje s náhodnou organizáciou, nie s aktívnou

**Súbor:** `apps/web/src/lib/api-helpers.ts:40-43`

```ts
const orgMember = await prisma.userOrgRole.findFirst({
  where: { userId: session.user.id }, // ← bez orderBy, bez deletedAt, bez activeOrgId
})
```

Session pritom nesie `activeOrgId` (PR7 dual-role context switch) a `session.user.orgs`. Pre používateľa
vo **viac ako jednej organizácii** tak každá `requireOrgAuth`/`requireRole` route operuje nad
nede­ter­mi­nis­ticky vybranou org — v rozpore s tým, čo UI ukazuje ako aktívny kontext. Rovnaký vzor je
v `applications/bulk`, `applications/export`, `organizations/current`, `user/preferences`,
`stripe/checkout`, `stripe/portal`, `sequences/[id]/enroll`.

---

### 🟢 A8 — `DELETE /api/candidates/[id]/tags` nevaliduje tag proti organizácii

`apps/web/src/app/api/candidates/[id]/tags/route.ts:114-119` — kandidát je org-scoped, ale mazanie je
`deleteMany({ where: { candidateId: id, tagId } })` bez kontroly `tag.orgId` (POST ju má). Dopad nízky
(maže existujúcu join väzbu), ale je to nekonzistentný tenant check.

### 🟢 A9 — PII v logoch pri neúspešnom prihlásení

`apps/web/src/lib/auth.ts:131` a `:142` logujú `user.email` v plaintexte (`Account locked for ${user.email}`,
`Failed login attempt ${n}/${max} for ${user.email}`). Nález F5 (2026-06-29) opravil presne tento vzor
v `unsubscribe/route.ts` pomocou `maskEmail()`, ale auth cesta zostala. **Oprava:** použiť ten istý helper.

### 🟢 A10 — Flaky security test oslabuje bránu

`apps/web/tests/security/file-upload-attacks.test.ts:655` — „Nested ZIP bomb" padá na 5s timeout v plnej
suíte, ale **v izolácii prejde za 795 ms** (`--testTimeout=60000`, 36 testov / 35 skipped). Príčina je
kontencia prostredia (plná suita: 208 s, setup 547 s), nie chyba v appke. Security test, ktorý padá
1× za N behov, ale eroduje dôveru v bránu — zvýšiť `testTimeout` pre tento súbor.

### 🟢 A11 — `CSRF_SECRET` má per-process fallback

`apps/web/src/lib/csrf.ts:13-28` — ak `CSRF_SECRET` nie je nastavený, vygeneruje sa náhodný secret **na
proces**. V serverless prostredí má každá inštancia iný, takže token vydaný jednou inštanciou neprejde
validáciou na druhej. Mitigované same-origin fallbackom (`isSameSiteRequest`), takže dopad je nízky —
ale nastaviť `CSRF_SECRET` je jednoriadková vec.

---

## 2b. Nálezy z druhého pokusu (P2) — frontend, schéma, mŕtvy kód

Prvý pokus frontend, schému a `apps/api`+`apps/workers` vynechal. Toto dopĺňa tú medzeru.

### 🔴 A12 (P2) — Touch targety pod 44 px v celej hlavičke

**Súbory:** `apps/web/src/components/ui/button.tsx:22-25` · `layout/notification-bell.tsx:71` ·
`layout/language-switcher.tsx:38-46` · `admin/users/users-client.tsx:296-304` · `layout/nav-drawer.tsx:75-83`

```ts
// button.tsx:22-25
default: 'h-10 px-4 py-2',   // 40 px
sm: 'h-9 rounded-md px-3',   // 36 px
icon: 'h-10 w-10',           // 40 px
```

WCAG 2.5.8 (Target Size, AA) žiada 24 px minimum, Apple/Material 44 px pre dotyk. Všetky tri varianty
sú pod 44 px a `sm` je používaný na **ikonové tlačidlá v hlavičke** — zvonček notifikácií, prepínač
jazyka, zatvorenie mobilného menu (`nav-drawer.tsx:75`, `p-1` + `h-5 w-5` ≈ 28 px). Predošlá oprava
(`shrink-0` v `nav-drawer.tsx:57`) riešila len hamburger **trigger**, súrodencov nie.

### 🔴 A13 (P2) — Vstup bez prístupného mena

**Súbor:** `apps/web/src/components/assessments/ResultsList.tsx:80-85`

```tsx
<Input
  placeholder="Search by candidate name or email..."
  value={searchTerm}
  onChange={(e) => setSearchTerm(e.target.value)}
/>
```

`placeholder` **nie je** prístupné meno — čítačky ho ignorujú. Chýba `<label>` aj `aria-label`.
(Ostatné panely v tom istom priečinku — `notifications-tab.tsx`, `branches-tab.tsx` — `Label htmlFor`
majú správne, takže je to lokálna nekonzistencia, nie systémový vzor.)

### 🔴 A14 (P2) — Hardcoded metadata namiesto prekladov na päťjazyčnom webe

**Súbory:** `[locale]/companies/page.tsx:13`, `terms/page.tsx:6`, `privacy/page.tsx:6`,
`career-advice/page.tsx:6`, `features/page.tsx:6`, `freelancers/page.tsx:13`, `contact/page.tsx:6`,
`gdpr/page.tsx:6`, `create-cv/page.tsx:6`, `post-job/page.tsx:6`, `blog/page.tsx:7`, `api-docs/page.tsx:6`,
`dashboard/cv/page.tsx:5`, `dashboard/profile/page.tsx:10` a ~15 `employer/*` stránok

```ts
// companies/page.tsx:13 — slovensky, na všetkých piatich locale
export const metadata: Metadata = { title: 'Profily firiem' /* ... */ }
```

Web sa prezentuje ako EN/DE/CS/SK/PL, ale `<title>` je buď natvrdo slovenský, alebo natvrdo anglický.
Preklady pritom **existujú** (1162 kľúčov v každom katalógu, parita overená). `getTranslations`
v `metadata` používajú len `jobs/page.tsx:23` a `pricing/page.tsx:9`. Toto je SEO aj UX nález:
nemčina a poľština dostávajú slovenské titulky.

**Naopak v poriadku:** `sitemap.ts` (statické cesty + 1000 publikovaných jobov × 5 locale), `robots.ts`
a `JobPosting` JSON-LD (`jobs/[id]/page.tsx:187-267`) so všetkými povinnými poľami pre Google for Jobs.

### 🟡 A15 (P2) — Sedem komponentov s natvrdo anglickým textom

**Súbory:** `components/MatchExplanation.tsx` (16+ reťazcov: `'Excellent Match'` :45, `'AI Analysis'` :94,
`'Score Breakdown'` :101, …) · `settings/notifications-tab.tsx` (13+: :153-285) ·
`layout/header.tsx` (natvrdo **slovensky** `'Kontext'` :134, `'Firma'` :138, `'Ako uchádzač'` :144) ·
`settings/billing-tab.tsx` :202-232 · `assessments/ResultsList.tsx` :73-124 ·
`settings/profile-tab.tsx` :214-371 · `settings/team-tab.tsx`, `team/MemberRow.tsx`, `team/InviteMemberDialog.tsx`

Nález M7 z `HANDOFF_TEST_SWEEP_2026-09-14` opravil tri komponenty (candidate-tags, notification-bell,
employer/tasks). Týchto sedem zostalo — a `header.tsx` je najhorší, lebo je na **každej** stránke
a zobrazuje slovenčinu používateľom v nemčine a poľštine.

### 🟡 A16 (P2) — Hardcoded anglické `aria-label`

**Súbory:** `layout/header.tsx:53,60,65,114,176,181` · `layout/skip-nav.tsx:15` ·
`admin/admin-sidebar.tsx:163-164` · `layout/language-switcher.tsx:42,48,55`

Text pre čítačky obrazovky (`"Site header"`, `"Open main menu"`, `"Skip to main content"`) je
netranslated, hoci vizuálny text okolo neho translated je. Nízky dopad na širokú populáciu, ale
systematické.

### 🟡 A17 (P2) — N+1 vo SendGrid webhooku

**Súbor:** `apps/web/src/app/api/webhooks/email/route.ts:151-180`

```ts
async function handleSendGridWebhook(events: any[]) {
  for (const event of events) {
    const run = await prisma.emailSequenceRun.findFirst({ where: { id: emailId } })
    const events = await prisma.emailSequenceEvent.findMany({ where: { runId: run.id }, take: 1 })
    await prisma.emailSequenceEvent.create({
      data: {
        /* ... */
      },
    })
  }
}
```

**Tri sekvenčné DB dotazy na každý event v cykle.** SendGrid dávkuje až 100+ eventov na jeden POST →
**300+ round-tripov na jedno volanie webhooku**. SendGrid pri prekročení timeoutu request opakuje,
takže pomalé spracovanie vedie k duplicitným doručeniam. (Idempotencia je riešená pre Stripe cez
`ProviderEvent`, pre e-mailové eventy nie.)

### 🟡 A18 (P2) — 913 riadkov tRPC, ktoré žiadna brána nikdy nekontroluje

**Súbory:** `apps/api/src/index.ts` (230 riadkov), `apps/api/src/trpc/context.ts` (109),
`apps/api/src/trpc/router.ts` (574)

`apps/api` **nie je prázdny stub** — je to kompletná tRPC vrstva. Ale root `package.json`
(`workspaces: ["apps/web", "packages/*"]`) ho vylučuje, takže **nikdy neprejde typecheckom, lintom,
testom ani buildom**. `Dockerfile.worker` ho označuje za mŕtvy; `pnpm-workspace.yaml` ho naopak
zahŕňa (`apps/*`) — dva konfiguračné súbory si navzájom odporujú. 913 riadkov, ktoré môžu byť
rozbité a nikto to nezistí.

### 🟡 A19 (P2) — `railway.toml` a root `Dockerfile` stále deployujú mŕtvy strom cez pnpm

**Súbory:** `railway.toml`, `Dockerfile`

```toml
# railway.toml
[build]
buildCommand = "pnpm install && pnpm build"
[[services]]
startCommand = "pnpm --filter @jobsphere/api start"
```

Repo používa **yarn** (`packageManager: yarn@1.22.19`, `yarn.lock` existuje, `pnpm-lock.yaml` nie).
`railway.toml` navyše očakáva env premenné `JWT_SECRET`, `COOKIE_SECRET`, `S3_BUCKET`, `S3_ACCESS_KEY`,
ktoré **v kóde neexistujú** — aplikácia používa `NEXTAUTH_SECRET`, `ENCRYPTION_KEY` a Vercel Blob.
Root `Dockerfile` stavia `apps/api` + `apps/workers` a má `CMD ["node", "apps/api/dist/index.js"]`.
Buď je Railway odpojený (a je to mínové pole pre budúceho človeka), alebo beží a servíruje niečo, čo
s aplikáciou nemá nič spoločné.

### 🟢 A20 (P2) — `Task.candidateId` bez indexu

**Súbor:** `packages/db/prisma/schema.prisma` (model `Task`)

Prisma na PostgreSQL **nevytvára indexy na cudzie kľúče automaticky**. Analýza našla **8 FK stĺpcov
bez indexu**, ale po overení reálneho použitia sa **len `Task.candidateId`** používa vo `where`
(`api/tasks/route.ts:50`). Zvyšných 7 (`Resume.sourceDocumentId`, `MatchScore.resumeId`,
`AssessmentInvite.jobId`, `Plan.productId`, `Subscription.productId`, `Invoice.subscriptionId`,
`Payment.invoiceId`) sú write-only referencie — bez dopadu na dotazy. Preto **Low**, nie Medium.

> **Poznámka k metóde:** prvý beh môjho FK skriptu hlásil **10** stĺpcov vrátane `FreelancerProfile.userId`.
> To bol **false positive** — skript ignoroval field-level `@unique`. Odhalil som to tým, že kód volá
> `findUnique({ where: { userId } })`, čo by sa nad neunikátnym poľom neskompilovalo. Po oprave: 8.

---

## 3. Overené a vyvrátené (rovnako dôležité)

| Hypotéza                                                 | Výsledok                | Dôkaz                                                                                                                                                                                                                                                               |
| -------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Nested ZIP bomb spôsobuje DoS / páli LLM kredity**     | **VYVRÁTENÉ**           | `vision-ocr.ts:41-45` vracia early `unsupported mime` pre `.docx` — žiadne LLM volanie. Test prejde v izolácii za 795 ms.                                                                                                                                           |
| **Do gitu je commitnutý 93 MB produkčný SQL dump s PII** | **VYVRÁTENÉ**           | `git ls-files` — `*.sql`, `*.sql.gz`, `*.zip`, `*.log`, `nul`, `*.tsbuildinfo` sú **untracked** (`.gitignore:66-68,88-105`).                                                                                                                                        |
| **`nul` súbory v roote sú commitnuté**                   | **VYVRÁTENÉ**           | Untracked + `.gitignore:105`. Sú to artefakty z Windows presmerovania, len na disku.                                                                                                                                                                                |
| **i18n katalógy sa rozchádzajú**                         | **VYVRÁTENÉ**           | 5 locales × **1162 kľúčov**, 0 missing / 0 extra v každom.                                                                                                                                                                                                          |
| **`.env.local` uniká do gitu**                           | **VYVRÁTENÉ**           | `.gitignore:113` (`git check-ignore` potvrdzuje).                                                                                                                                                                                                                   |
| **Typecheck je červený**                                 | **VYVRÁTENÉ**           | `apps/web`: **0 chýb**; `packages/ai` aj `packages/db` prechádzajú.                                                                                                                                                                                                 |
| **Lint je červený**                                      | **VYVRÁTENÉ**           | **0 errors**, 862 warnings (prevažne `no-explicit-any` v testoch).                                                                                                                                                                                                  |
| **(P2) Vo frontende je XSS**                             | **VYVRÁTENÉ**           | Jediný `dangerouslySetInnerHTML` je JSON-LD a escapuje `<` (`jobs/[id]/page.tsx:359`). Žiadny markdown renderer v `src` (grep na `marked`/`markdown-it`/`remark` = 0). `href` na `company.website`, `portfolioUrl` sú gated cez `z.string().url()` + `sanitizeUrl`. |
| **(P2) Chýbajú `alt` texty**                             | **VYVRÁTENÉ**           | Overených 16 call sites `<img>`/`<Image>` — **všetky majú `alt`**.                                                                                                                                                                                                  |
| **(P2) Radix dialógy bez názvu**                         | **VYVRÁTENÉ**           | `nav-drawer.tsx:74` (`sr-only`), `ui/dialog.tsx` obsahuje `DialogTitle`; dialógy v `bulk-email`, `interview-schedule`, `MemberRow` tiež.                                                                                                                            |
| **(P2) Kontrast farieb je pod AA**                       | **VYVRÁTENÉ**           | `--muted-foreground: 0 0% 45%` (`globals.css:20`) = #737373 na bielom ≈ **4,74:1** (AA pass). `text-gray-400` len na `aria-hidden` chevronoch.                                                                                                                      |
| **(P2) Chýba sitemap / robots / JSON-LD**                | **VYVRÁTENÉ**           | `sitemap.ts` (statické cesty + 1000 jobov × 5 locale), `robots.ts`, `JobPosting` JSON-LD so všetkými povinnými poľami.                                                                                                                                              |
| **(P2) 10 FK stĺpcov bez indexu**                        | **ČIASTOČNE VYVRÁTENÉ** | Prvý beh skriptu mal bug (ignoroval field-level `@unique`). Skutočnosť: **8**, a z nich sa vo `where` používa **len 1** (`Task.candidateId`).                                                                                                                       |
| **(P2) Build je rozbitý**                                | **VYVRÁTENÉ**           | `next build` → `BUILD_EXIT:0` za 5 min 02 s. Prvé zlyhanie spôsobil sandbox `safe-delete` shim, nie kód.                                                                                                                                                            |

---

## 4. Stav kvalitatívnych brán (namerané 2026-09-26)

| Brána                               | Výsledok                                    | Poznámka                                                                                                                                    |
| ----------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Typecheck (`apps/web`)              | ✅ **0 chýb**                               | `turbo typecheck` padá na Windows `os error 231` — nutné spúšťať per-package                                                                |
| Lint                                | ✅ **0 errors** / 862 warnings              | warnings = `no-explicit-any`, `security/detect-object-injection`                                                                            |
| **Production build** (P2)           | ✅ **`BUILD_EXIT:0`, 5 min 02 s**           | First Load JS shared 87,7 kB · Middleware 149 kB. Prvý beh zablokoval sandbox `safe-delete` shim, nie kód                                   |
| Unit testy                          | ⚠️ **1124 (1 zlyhanie) → 1084 (0 zlyhaní)** | dva behy, rovnakých 96 súborov, **rôzny počet testov** — príčinu som nezistil. Zlyhanie = flaky ZIP bomb (A10), v izolácii prejde za 795 ms |
| **Verifikačné testy A1/A3/A4** (P2) | ✅ **4 / 4 prešli**                         | `tests/security/audit-2026-09-26-verification.test.ts` — dokazujú zraniteľnosť, nie správanie                                               |
| i18n parity                         | ✅ **1162 × 5, 0 rozdielov**                |                                                                                                                                             |
| `yarn audit`                        | ❌ **2 Critical / 72 High / 110 Moderate**  | Critical = Next.js (A2); Medium = sanitize-html (A5)                                                                                        |
| **E2E (296 testov)** (P2)           | ⛔ **NEDÁ SA SPUSTIŤ**                      | `P2021: The table public.Answer does not exist` — chýba pgvector, pozri §9                                                                  |
| **Integrácia (381 testov)** (P2)    | ⛔ **NEDÁ SA SPUSTIŤ**                      | `P3018` / `0A000: extension "vector" is not available` na prvej migrácii                                                                    |
| CI                                  | ⚠️                                          | `security-scan` (Trivy) **bez `exit-code: 1`** → nikdy nezlyhá (M9); security integration `continue-on-error: true`                         |

---

## 5. Regresie voči predchádzajúcim uzávierkam

| Nález                    | Uzavretý                           | Stav dnes                                               |
| ------------------------ | ---------------------------------- | ------------------------------------------------------- |
| **F4** sanitize-html XSS | 2026-06-29 „fixed"                 | **VRÁTENÉ** — 2 nové advisories, treba `>=2.17.7` (A5)  |
| **SEC-1** Next.js        | 2026-09-15 „open, nedosiahnuteľné" | **ESKALOVANÉ** — pribudla dosiahnuteľná DoS (A2)        |
| **F5** PII v logoch      | 2026-06-29 „fixed" (unsubscribe)   | **ČIASTOČNE** — rovnaký vzor pretrváva v `auth.ts` (A9) |

---

## 6. Dokumentácia vs. realita

`README.md` je systematicky mimo: tvrdí **NextAuth v5** (realita v4.24.15, downgrade kvôli produkčnému
bugu — `CLAUDE.md` to vysvetľuje), **80 % coverage** (realita ratchet ~22 %), a „Security Rating 7.5/10".
`CLAUDE.md` sám označuje pôvodné „10/10 — All features complete" za neplatné. Keďže `CLAUDE.md` je
načítavaný ako kanonický zdroj pre agentov, `README.md` by mal buď odkázať naň, alebo byť opravený —
inak bude každý ďalší agent aj človek pracovať s nesprávnym obrazom systému.

---

## 7. Prioritizácia

| #   | Nález                                                                   | Náklad | Dopad                 |
| --- | ----------------------------------------------------------------------- | ------ | --------------------- |
| 1   | **A1** soft-delete membership → doplniť filter + `sessionEpoch`         | S      | 🔴 kritický           |
| 2   | **A5** sanitize-html → `^2.17.7`                                        | XS     | 🟡 vysoký pomer       |
| 3   | **A3** PUT jobs — validovať FK ako POST                                 | S      | 🟡 tenant únik        |
| 4   | **A4** PATCH interview — validovať `branchId` ako POST                  | XS     | 🟡 tenant únik        |
| 5   | **A6** rate limit — čítať user id zo session, nie z Bearer              | S      | 🟡                    |
| 6   | **A7** `requireOrgAuth` — viazať na `activeOrgId`                       | S      | 🟡                    |
| 7   | **A9** PII — `maskEmail()` v auth logoch                                | XS     | 🟢                    |
| 8   | **A11** `CSRF_SECRET` do env                                            | XS     | 🟢                    |
| 9   | **A10** `testTimeout` pre file-upload suitu                             | XS     | 🟢                    |
| 10  | **(P2) A12** touch targety — `sm`/`icon` varianty na ≥44 px             | S      | 🔴 a11y               |
| 11  | **(P2) A13** `aria-label` na `ResultsList` search                       | XS     | 🔴 a11y               |
| 12  | **(P2) A14** `generateMetadata` s `getTranslations` na ~20 stránok      | M      | 🔴 SEO/UX             |
| 13  | **(P2) A19** zmazať/označiť `railway.toml` + root `Dockerfile`          | XS     | 🟡 mínové pole        |
| 14  | **(P2) A18** rozhodnúť o `apps/api` (zmazať alebo zaradiť do workspace) | S      | 🟡 913 riadkov        |
| 15  | **(P2) A17** SendGrid webhook — dávkové dotazy mimo cyklu               | M      | 🟡 N+1                |
| 16  | **(P2) A15/A16** i18n v 7 komponentoch + `aria-label`                   | M      | 🟡                    |
| 17  | **A2** Next 15.5.24+ upgrade                                            | XL     | 🔴 samostatný projekt |

Položky 1–16 sú dohromady odhadom **dva až tri pracovné dni** a odstránia všetky nálezy okrem A2.
Najlepší pomer dopadu a nákladu: **A5** (`^2.17.7`, jedna zmena verzie) a **A13/A19** (dve jednoriadkové
zmeny s okamžitým efektom).

---

## 8. Skóre

Formula projektu: `100 − Critical·20 − High·10 − Medium·4 − Low·1`

| Kategória | Otvorené po oboch pokusoch                                                                |
| --------- | ----------------------------------------------------------------------------------------- |
| Critical  | 0                                                                                         |
| High      | 6 — H4 (Stripe env) · SEC-1/A2 (Next.js) · A1 (membership bypass) · (P2) A12 · A13 · A14  |
| Medium    | 12 — M2 (KV env) · M9 (Trivy) · A3 · A4 · A5 · A6 · A7 · (P2) A15 · A16 · A17 · A18 · A19 |
| Low       | 8 — SEC-5 · SEC-6 · L3 · A8 · A9 · A10 · A11 · (P2) A20                                   |

**Projekcia: 100 − 0 − 60 − 48 − 8 = −16 → formula je vyčerpaná, pozri poznámku nižšie.**

> **Formula je na tomto projekte vyčerpaná.** Pri 24 otvorených nálezoch vracia záporné číslo, čo
> nie je informácia, ale artefakt lineárneho vzorca. Odporúčam prejsť na vážený model, kde sa počíta
> **váha × dosiahnuteľnosť**, nie holý počet. Praktickejšie čítanie súčasného stavu:
>
> - **Bezpečnostné jadro:** slušné. Žiadny Critical v našom kóde, žiadny potvrdený cross-tenant read IDOR,
>   webhooky overujú podpisy, CSRF/rate-limit/AES infraštruktúra existuje.
> - **Tenant izolácia:** jedna vážna diera (A1) + dva write-only úniky (A3/A4). Všetky tri sú malé opravy.
> - **Frontend kvalita:** najslabšia oblasť — prístupnosť a metadata na päťjazyčnom verejnom webe.
> - **Testovacia sústava:** dve tretiny (E2E + integrácia) sú v tomto prostredí **trvalo neoveriteľné**.
> - **Reálna produkčná pripravenosť: ~55 %.** Jadro funguje, ale pred nasadením treba A1, A12–A14 a A2.

---

## 9. Čo tento audit **neurobil** — a prečo

Prvý pokus tieto body len vymenoval. Druhý ich skúsil spustiť a narazil na konkrétny blok, ktorý
vieme reprodukovať. Záznam oboch pokusov s časom a hodnotením: `audit/ATTEMPTS_LOG.md`.

### Spustené a prešlo (P2)

- **Production build:** `next build` → `BUILD_EXIT:0` za 5 min 02 s.
- **Verifikačné testy A1/A3/A4:** 4/4 prešli — nálezy sú **dokázané spustením**, nie čítaním.
- **Frontend statická analýza:** a11y, SEO, XSS, i18n — 6 nových nálezov, 5 z 5 spot-checkov potvrdených.
- **Schéma:** 59 modelov, 117 `@@index`, FK indexy, N+1.
- **`apps/api` + `apps/workers`:** overené proti `Dockerfile.worker` — a našiel sa nový nález (A18/A19).
- **E2E inventár:** `playwright test --list` → 296 testov v 27 súboroch.

### Nespustené — blok prostredia, nie rozhodnutie

**E2E (296 testov) a integrácia (381 testov) sa v tomto prostredí spustiť nedajú.** Reťaz dôkazov:

1. **Docker daemon nebeží** — `docker ps` → `failed to connect to the docker API at
npipe:////./pipe/dockerDesktopLinuxEngine`. Nedá sa použiť `docker/docker-compose.test.yml`
   s obrazom `ankane/pgvector`.
2. **Lokálny PostgreSQL 18 pgvector nemá** —
   `SELECT name FROM pg_available_extensions WHERE name='vector'` → **0 rows**
   (dostupné sú len `btree_gin`, `pg_trgm`, `uuid-ossp`).
3. **`prisma migrate deploy` preto padá na prvej migrácii:**
   ```
   Applying migration `20250114_complete_schema`
   Error: P3018 · Database error code: 0A000
   ERROR: extension "vector" is not available
   HINT: The extension must first be installed on the system where PostgreSQL is running.
   ```
4. **Bez schémy nemôže bežať `tests/setup/global-setup.ts`** — seeduje dáta do DB a bez `DATABASE_URL`
   odmietne štart.
5. **Reálny beh E2E to potvrdil:**
   ```
   P2021: The table `public.Answer` does not exist in the current database.
   ```

**Jedna vec odblokuje všetko ostatné:** spustiť Docker Desktop, alebo doinštalovať pgvector do
lokálneho PG18. Potom sa dajú spustiť E2E, integrácia, runtime overenie A3/A4 cez HTTP, axe a Lighthouse.

### Zostáva nehotové aj po odblokovaní

- **Nezávislý sweep všetkých 94 API routes** — tvrdenie „žiadne klasické cross-tenant read IDOR" je
  stále slovo subagenta. Ja som osobne overil len A3, A4 a A1. Toto je najväčšia **metodická** medzera.
- **Billing toky end-to-end** — vyžadujú testovacie Stripe kľúče (H4).
- **Rozptyl v počte unit testov** (1124 vs 1084 pri rovnakých 96 súboroch) — nezistená príčina.
