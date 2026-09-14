# JobSphere — Testovací report stavu projektu

**Dátum:** 2026-09-14 · **Vetva:** `main` @ 23f4260 (opravy na `fix/test-sweep-2026-09`) · **Prostredie:** lokálny Docker Postgres/Redis pre DB-závislé suity + živá produkcia `www.jobsphere.eu` (len GET) · **Metóda:** 7 oblastí, každá s vlastným behom a dôkazom; skóre = vážený scorecard + security posture podľa vzorca repa

---

## 1. Verdikt: **70 % pripravenosti · GO s podmienkami**

Jadro drží: build, typecheck, lint, 1111 unit testov, migrácie od nuly, drift gate a živé sondy sú zelené. Čo ťahá číslo dole, sú **tri dead-endy viditeľné používateľom** (redirect slučka bez locale, 500 pri assessmente s kódom, mŕtva stránka výsledkov), **billing bez kľúčov**, a **dve testovacie vrstvy, ktoré roky negatujú** (E2E 21/300, integrácia 256/371). Dve z tých troch chýb sú opravené na vetve tohto reportu.

| Oblasť                 | Váha |  Skóre | Kľúčové dôkazy                                                                                                                                    |
| ---------------------- | ---: | -----: | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kód a brány            |   15 | **93** | typecheck ✅ · lint 0 err / 862 warn · unit **1111/1111** · coverage 25,4/63,3/43,2/25,4 vs ratchet 22/61/39/22 · i18n 5×1133 ✅ · build 203 s ✅ |
| Integrácia s DB        |   15 | **61** | **256 / 371** (17 z 19 súborov padá) · sqli 41/44 · xss 7/22 · 1 reálna chyba appky (H2), zvyšok zastarané testy                                  |
| E2E / UI               |   15 | **60** | global-setup ✅ · **21 passed / 43 failed / 230 nespustených** (stop na 40 pádoch) · a11y **66/92**, 23× color-contrast                           |
| Bezpečnosť             |   20 | **74** | contract testy ✅ · IDOR review 3 stránok ✅/⚠ · hlavičky ✅ · yarn audit: Next 14.2.35 s Critical advisories (nedosiahnuteľné)                  |
| Produkčná prevádzka    |   20 | **52** | 26 sond ✅ · health `healthy` · cron 4× beží · **Stripe/Sentry/KV/HEALTH_CHECK_SECRET chýbajú** · redirect slučka · mŕtva results route           |
| Dáta a migrácie        |    5 | **95** | drift gate ✅ · od nuly 60 tab / 212 idx / 79 FK ✅ · HNSW ×2 ✅ · idempotencia 3/3 ✅                                                            |
| Kvalita a dokumentácia |   10 | **75** | 8 stale tvrdení v CLAUDE.md · findings.json zastaraný · mŕtvy railway.toml · CRM UI bez prekladov                                                 |

**Vážené skóre:** (93·15 + 61·15 + 60·15 + 74·20 + 52·20 + 95·5 + 75·10) / 100 = **69,6 ≈ 70 %**

Pravidlo pre oblasť: štart 100; červená brána −25; Critical −20 / High −10 / Medium −4 / Low −1; podlaha 0.

**Security posture: 74 / 100** (10.7.2026 bolo 91). Výpočet: 100 − 20·0 − 10·1 (SEC-1) − 4·3 (SEC-2, SEC-3, M5 deferred) − 1·4 (SEC-4, SEC-5, SEC-6, scraper consent) = 74. Rozdiel voči júlu je celý v zostarnutých závislostiach — Next 14.2.35, next-auth 4.24.7, xmldom cez mammoth.

---

## 2. Porovnanie s 10.7.2026

|                        | 10.7.                       | 14.9.                     |
| ---------------------- | --------------------------- | ------------------------- |
| unit testy             | 726                         | 1111                      |
| integračná suita       | nebola meraná               | 256/371                   |
| E2E                    | discovery 392, beh nemeraný | 21/300 reálne             |
| posture                | 91                          | 74                        |
| otvorené High          | 0                           | 6 (2 opravené na vetve)   |
| plánovaná práca (cron) | „BullMQ" — nikdy nebežala   | Vercel Cron, 4 joby bežia |

---

## 3. Nálezy podľa závažnosti

### 🔴 High (6)

**H1 — Redirect slučka pre chránené cesty bez locale** · `apps/web/src/middleware.ts` · ✅ opravené na vetve
`/dashboard` (aj `/employer`, `/admin`, `/settings`, `/profile`) → locale = „dashboard" → redirect na `/dashboard/login` → znova chránená cesta → 12× redirect, `ERR_TOO_MANY_REDIRECTS`. Overené live aj lokálne.
_Po lopate:_ kto klikne na starý odkaz alebo bookmark bez `/sk/`, vidí chybu prehliadača namiesto prihlásenia.

**H2 — POST `/api/assessments` s programovacou otázkou → 500** · `api/assessments/route.ts:147` · ✅ opravené
Route posielala do Prismy `code`, model `Question` má `starterCode`. Každý assessment s CODE otázkou spadol.
_Po lopate:_ testy s programovacou úlohou sa nedali vôbec uložiť.

**H3 — Stránka výsledkov assessmentu volá neexistujúci endpoint** · `assessment/[id]/results/[attemptId]/assessment-results-client.tsx` · ❌ neopravené
Fetch na `GET /api/assessments/[id]/results/[attemptId]`; existujú len `[id]`, `invite`, `submit`, `generate`.
_Po lopate:_ výsledky testu sa kandidátovi ani firme nikdy nezobrazia. Potrebuje novú route s org-scopingom a kontrolou, či attempt patrí kandidátovi/organizácii volajúceho.

**H4 — Stripe kľúče nie sú v produkcii** · Vercel env · ❌ (konfigurácia)
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` chýbajú; pricing stránka existuje.
_Po lopate:_ nikto nemôže zaplatiť, webhook nemôže overiť podpis.

**H5 — Next.js 14.2.35 mimo bezpečnostnej podpory** (SEC-1) · `apps/web/package.json` · ❌
`yarn audit` hlási 2 Critical (RCE na Windows hostoch — v Linux/Vercel konfigurácii nedosiahnuteľné). Upgrade na 14.2.x latest / 15.
_Po lopate:_ rámec, na ktorom appka stojí, už nedostáva bezpečnostné záplaty.

**H6 — E2E suita reálne neprechádza** · `apps/web/tests/e2e/**` · ❌
300 testov, prihlásenie 6 rolí funguje, ale selektory nezodpovedajú UI (`textarea[name="questions.0.text"]` not found). Padá cv-upload 14, candidate-flow 12, auth 6, assessment-builder 5, email-sequence-builder 4. CI gate `e2e-tests` je blokujúci a **trvalo červený od 14.8.** — rovnaká signatúra na všetkých 19 cross-browser shardoch.
_Po lopate:_ máme 300 automatických testov, ktoré nič nechránia, a červený semafor, ktorý všetci ignorujú.

### 🟠 Medium (12)

- **M1** Login zobrazuje Google aj Apple tlačidlá; produkcia má len `credentials` (`/api/auth/providers`) → klik skončí chybou NextAuth. _Po lopate:_ tlačidlá, ktoré nefungujú.
- **M2** Rate limit v produkcii je in-memory (chýba `KV_REST_API_URL/TOKEN`), resetuje sa každým cold startom — log `Upstash KV not configured` na každom štarte. _Po lopate:_ ochrana proti hádaniu hesiel sa tvári, že beží.
- **M3** Sentry DSN chýba → chyby z produkcie sa nikam nehlásia. Navyše 101 volaní `logger.error(msg, { error })` logovalo `[object Object]` — ✅ opravené v loggeri (`describeNonError` + rozbalenie tvaru). _Po lopate:_ mesiac padajúcich embeddingov nemal v logoch žiadnu čitateľnú príčinu.
- **M4** Integračná suita 115/371 zastaraná (signup anti-enumeration, paginácia applications, worker fixtures, vector-search raw SQL, Resend bez kľúča, mock trap `UnauthorizedError`) a v CI pod `continue-on-error` → negatuje.
- **M5** `packages/db` testy nikdy nemohli bežať (`pnpm prisma migrate deploy` v yarn repe, hardcoded 5432). ✅ opravené — po oprave 15/16, 1 reálny pád: `Application > should track stage history`.
- **M6** a11y: 23× `color-contrast` violations (axe), 66/92 prechádza.
- **M7** CRM UI z PR #18 bez prekladov: `candidate-tags.tsx`, `notification-bell.tsx`, `employer/tasks/*` — 0× `useTranslations`.
- **M8** `deploy.yml` padá na `Input required and not supplied: vercel-token` — workflow je redundantný voči Vercel Git integrácii (tá HEAD nasadila, `Vercel=success`), len zavádza červenou.
- **M9** Trivy v `ci.yml` bez `exit-code` → nikdy nezlyhá. Nemenené: flip by okamžite sčervenal `main` kvôli Next advisories — rozhodnutie vlastníka.
- **M10** `bezpecnostny-audit/findings.json` zastaraný (nálezy z 10.7. nikdy nezapísané; DoD to vyžaduje) — ✅ doplnené v tomto PR. Posture v CLAUDE.md 91 neaktualizovaný od 10.7. — ✅ prepísané.
- **M11** SEC-2 next-auth 4.24.7 < 4.24.15 (homoglyph bypass v email normalizeri); SEC-3 `@xmldom/xmldom` 0.8.11 cez mammoth (13 High advisories).
- **M12** `railway.toml` na pnpm + mŕtve `apps/api`/`apps/workers` (mimo workspaces, posledný commit 29.7.) — zavádza prevádzku.

### 🟡 Low (10)

- **L1** 862 lint warnings (774× `no-explicit-any`, 73× `detect-object-injection`); 97× `any` v src; 8 súborov > 650 riadkov (max 1035).
- **L2** `X-Powered-By: Next.js` unikalo — ✅ `poweredByHeader: false`. CSP `unsafe-inline` pre script-src (dokumentované SEC-005).
- **L3** `HEALTH_CHECK_SECRET` chýba → `/api/health/db` a `/api/health/redis` vracajú 503 (mŕtve sondy); `/api/health` funguje.
- **L4** Mŕtve env v produkcii: `POSTGRES_*`, `SUPABASE_*`, `NEXT_PUBLIC_SUPABASE_*` (nič ich nečíta). Lokálne `packages/db/.env` a `yarn test:db:migrate` mieria na dva rôzne zrušené Supabase tenanty.
- **L5** docker-compose služby bez referencie v kóde: meilisearch, qdrant, minio, mailhog.
- **L6** `POST /api/jobs` volá `revalidatePath` — v testovom prostredí 500 (`Invariant: static generation store missing`); v produkcii OK. Test-env artefakt, 11 pádov v `jobs/create.test.ts`.
- **L7** Coverage headroom na branches len 2,3 pp (63,3 vs 61) — ratchet čoskoro zahryzne.
- **L8** 8 stale tvrdení v CLAUDE.md (10/10 ready, coverage 80 %, `Candidate.cvEmbedding`, BullMQ cron, Upstash, `mockDeep`, `apps/workers/...`, `migrate deploy`) — ✅ opravené v tomto PR.
- **L9** SEC-5 swagger-ui-react reťazec (js-yaml, minimatch, lodash); SEC-6 axios cez @sendgrid/mail — nízka dosiahnuteľnosť.
- **L10** E2E global-teardown padá na `organization.deleteMany` (FK poradie); Playwright auth states neboli gitignored (vzor nekryl `apps/web/`) — ✅ opravené.

---

## 4. Neoverené (a prečo)

- E2E beh zastavený na 40 pádoch → **230 testov sa nespustilo**; skutočné pass-rate môže byť vyššie než 21/300.
- Cross-browser (firefox/webkit/edge/mobile) lokálne nebežal — len CI signatúra.
- Lighthouse / `test:performance` nebežali (potrebujú `yarn start` + DATABASE_URL).
- Obsah produkčnej DB (počty riadkov, čo cron reálne spracoval) — nemám prístup k Neonu.
- Vercel **preview** deploye padajú preto, že Preview prostredie nemá ani jednu env premennú — nesúvisí s obsahom vetiev.

---

## 5. Čo zdvihne skóre najviac (poradie podľa výnos/náklad)

1. **Env v produkcii (H4, M1, M2, M3, L3):** Stripe kľúče, Sentry DSN, Upstash KV, `HEALTH_CHECK_SECRET`; alebo Google/Apple tlačidlá schovať, kým providery nie sú nakonfigurované. Nula riadkov kódu, +~12 bodov v Prevádzke.
2. **Zmergovať tento PR** (H1, H2, M3-logger, M5, L2, L8, L10) — dve produkčné chyby a observabilita.
3. **Results route pre assessment (H3)** — jedna route s org-scopingom, odblokuje celý flow testov.
4. **E2E: zosúladiť selektory s UI (H6)** alebo dočasne zúžiť gate na špecky, ktoré prechádzajú, aby `main` nebol trvalo červený.
5. **Integračné testy (M4):** 4 súbory tvoria 50 pádov (assessment-grading 15, applications 13, jobs 11, vector-search 10) — po nich zmazať `continue-on-error`.
6. **Next.js upgrade (H5, M11)** — 14.2 latest, potom next-auth 4.24.15.

---

## 6. Zmeny v tomto PR (`fix/test-sweep-2026-09`)

| Súbor                                                                    | Zmena                                                                                                         |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | --- | --- |
| `apps/web/src/middleware.ts`                                             | locale z prvého segmentu len ak je v `locales`, inak `sk`                                                     |
| `apps/web/src/app/api/assessments/route.ts`                              | `code` → `starterCode`                                                                                        |
| `apps/web/src/lib/logger.ts`                                             | `error()` rozbalí `{ error, ...ctx }`; `describeNonError` pre ne-Error throwables                             |
| `apps/web/next.config.js`                                                | `poweredByHeader: false`                                                                                      |
| `packages/db/tests/setup.ts`                                             | `pnpm` → `yarn`; `DATABASE_URL                                                                                |     | =`  |
| `apps/web/vitest.config.ts`, `src/lib/__tests__/account-lockout.test.ts` | odstránená mŕtva karanténa (test padal aj samostatne; správanie kryje `tests/security/login-lockout.test.ts`) |
| `.gitignore`                                                             | `**/playwright/.auth/`                                                                                        |
| `bezpecnostny-audit/findings.json`, `CLAUDE.md`                          | write-back nálezov 10.7. + 14.9., posture 74, 8 opravených tvrdení                                            |
| nové testy                                                               | middleware (7), assessments create (1), logger error shape (4)                                                |

Brány po zmenách: typecheck ✅ · lint 0 chýb ✅ · unit **1111/1111** ✅.

Dôkazy: `scratchpad/sweep/` (coverage, integration, e2e, a11y, lint, build logy; `report-bezpecnost.json`).
