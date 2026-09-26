# JobSphere - Enterprise AI-Powered ATS

[![Next.js](https://img.shields.io/badge/Next.js-14-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748)](https://www.prisma.io/)
[![Claude AI](https://img.shields.io/badge/Claude-Opus%204-orange)](https://www.anthropic.com/)
[![Security](https://img.shields.io/badge/Security-B+-yellow)](docs/SECURITY_IMPLEMENTATION.md)
[![Test Coverage](https://img.shields.io/badge/Coverage-improving-yellow)](apps/web/coverage)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**Live Demo:** [https://jobsphere-khaki.vercel.app](https://jobsphere-khaki.vercel.app)
**Security Rating:** 7.5/10 | **Beta** 🚧

## 🚀 Overview

JobSphere is an enterprise-grade Applicant Tracking System powered by Anthropic's Claude AI, built with Next.js 14. Complete with AI CV parsing, hybrid matching algorithms, email automation, skills assessments, Stripe billing, and full GDPR compliance.

---

## ✨ Features

### For Candidates

- **Job Search & Filtering** - Browse jobs with advanced filters (location, work mode, salary, seniority)
- **AI-Powered Job Recommendations** - See top matching jobs with AI-generated explanations
- **Match Score Breakdown** - Detailed scoring based on skills, experience, education, and location
- **One-Click Applications** - Apply to jobs with CV upload and cover letter
- **Application Tracking** - Monitor application status with detailed timeline
- **Skills Assessments** - Complete assessments to demonstrate your capabilities
- **Personal Dashboard** - Track all applications in one place
- **Profile Management** - Maintain your professional profile and preferences

### For Employers

- **Job Posting Management** - Create and manage job listings
- **Applicant Tracking** - Review and manage candidates with advanced filtering
- **AI-Powered Candidate Matching** - Hybrid BM25 + Vector + LLM matching algorithm
- **Semantic Candidate Search** - Find candidates using natural language queries with hybrid scoring
- **Skills Assessments** - Create custom assessments with auto-grading via Claude AI
- **Assessment Builder** - Dynamic forms with MCQ, code, and text questions
- **Assessment Results Viewing** - Filterable results table with pass/fail indicators and score breakdowns
- **Application Review** - Detailed applicant profiles with parsed CV data and match scores
- **Application Analytics Dashboard** - KPIs, charts, conversion funnel, and trend analysis
- **Email Sequence Automation** - Create drip campaigns with template variables and scheduling
- **Team Member Management** - Invite/remove members with role-based access (Admin, Recruiter, Hiring Manager)
- **Status Management** - Update application statuses through recruitment pipeline
- **Company Settings** - Manage company profile, billing, and notifications

### Platform Features

- **🌍 Multilingual** - Support for 5 languages (EN, DE, CS, SK, PL)
- **🔒 Secure Authentication** - NextAuth v5 with Email/Password + Google OAuth
- **📱 Responsive Design** - Mobile-first approach with beautiful UI
- **📧 Email Notifications** - Automated email updates for applications
- **📊 Analytics Dashboard** - Real-time statistics and insights
- **🎨 Modern UI** - Built with shadcn/ui and TailwindCSS
- **⚡ Performance** - Server-side rendering and optimized loading

---

## 🛠️ Tech Stack

### Frontend

- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript 5
- **Styling:** TailwindCSS + shadcn/ui
- **Internationalization:** next-intl
- **Forms:** React Hook Form + Zod validation
- **State Management:** React Server Components

### Backend

- **Database:** PostgreSQL with pgvector extension (via Supabase/Vercel Postgres)
- **ORM:** Prisma
- **Authentication:** NextAuth v5
- **Background Jobs:** BullMQ with Redis (Upstash)
- **Workers:** Email sequences, embedding generation, assessment auto-grading
- **AI:** Anthropic Claude (CV parsing, semantic matching, assessment grading)
- **Semantic Search:** pgvector for vector similarity search + hybrid BM25 scoring
- **File Upload:** Local file storage (dev) / Vercel Blob (production)
- **Email:** Resend / SendGrid (configurable)
- **API:** Next.js API Routes + Server Actions

### Infrastructure

- **Hosting:** Vercel
- **CI/CD:** GitHub Actions (automatic deployment)
- **Testing:** Vitest + Testing Library (80%+ coverage)
- **Security:**
  - AES-256-GCM encryption for OAuth tokens
  - Redis-based rate limiting (Upstash)
  - Zod input validation on all API routes
  - Security headers (CSP, HSTS, X-Frame-Options)
  - Sentry error monitoring
  - CSRF protection
  - Bcrypt password hashing
  - Service Layer Pattern for business logic

---

## 🏗️ Architecture Overview

JobSphere uses a modern, scalable architecture designed for enterprise-grade performance and reliability.

### Multi-Tenant Organization Model

- **Organization-Scoped Data:** All resources (jobs, candidates, applications) are scoped to organizations
- **Role-Based Access Control:** Four roles - ORG_ADMIN, RECRUITER, HIRING_MANAGER, AGENCY
- **Permission Checks:** Middleware-enforced authorization on all API routes
- **Data Isolation:** Strict organization boundaries prevent data leakage

### Background Workers (BullMQ)

- **email-sequence.worker.ts** - Automated drip campaigns with template variables
- **embedding.worker.ts** - Generate vector embeddings for semantic search
- **assessment-grading.worker.ts** - Auto-grade assessments using Claude AI
- **Queue System:** Redis-backed with automatic retries and error handling
- **Observability:** Structured logging and job status tracking

### Semantic Search & AI Matching

- **Hybrid Scoring Algorithm:**
  - **BM25:** Traditional keyword-based scoring
  - **Vector Similarity:** pgvector cosine similarity on embeddings
  - **LLM Analysis:** Claude AI for contextual understanding
- **Match Score Calculation:** Weighted combination of all three methods
- **Real-time Embeddings:** Generated on CV upload via worker queue
- **Caching:** Match scores cached for performance

### File Storage Strategy

- **Development:** Local file system (`public/uploads/cvs/`)
- **Production:** Vercel Blob Storage with private access
- **Abstraction Layer:** `cv-storage.ts` handles provider switching
- **Security:** File size limits, MIME type validation, antivirus scanning (ClamAV)

---

## 🔬 CV Parsing Pipeline

JobSphere features a **production-ready, multi-stage CV parsing system** with automatic fallbacks, OCR support, and comprehensive security checks.

### Pipeline Overview

```
File Upload → Security Check → Node.js Parser → OCR Fallback → AI Extraction
     ↓              ↓                ↓              ↓              ↓
  Blob Store   Antivirus         pdf-parse      Tesseract      Claude AI
               MIME Check         mammoth        PyMuPDF        Gemini Flash
               Macro Check
```

### Features

**Multi-Stage Fallback:**

1. **Stage 1**: Fast Node.js parser (pdf-parse, mammoth) - ~100ms
2. **Stage 2**: OCR with Tesseract (scanned PDFs) - ~2-3s per page
3. **Stage 3**: Metadata extraction (graceful degradation)

**Security Hardening:**

- ✅ ClamAV antivirus scanning
- ✅ MIME type verification (prevent spoofing)
- ✅ VBA macro detection in DOCX
- ✅ File size limits (10 MB default)
- ✅ Rate limiting (10 uploads/5min per IP)

**Multi-Language OCR:**

- 🇬🇧 English
- 🇩🇪 German
- 🇸🇰 Slovak
- 🇨🇿 Czech
- 🇵🇱 Polish

**Observability:**

- Unique `traceId` for every upload
- Structured logging at each stage
- Parse method tracking (`node_pdf`, `ocr_tesseract`, `metadata_fallback`)
- Confidence scores (0-1)

### Usage

**Docker Compose (Recommended):**

```bash
# Start all services (includes ClamAV + Python parser)
docker-compose -f docker/docker-compose.yml up -d

# Verify services
docker ps | grep jobsphere
```

**Environment Setup:**

```bash
# Enable OCR
ENABLE_OCR=true
OCR_TIMEOUT=30000

# Enable Antivirus
ENABLE_ANTIVIRUS=true
CLAMAV_HOST=clamav  # or 'localhost' outside Docker
CLAMAV_PORT=3310

# File Limits
MAX_FILE_SIZE=10485760  # 10 MB
```

**API Example:**

```typescript
// Upload CV
const formData = new FormData()
formData.append('file', file)

const response = await fetch('/api/cv/upload', {
  method: 'POST',
  body: formData,
})

const result = await response.json()
// {
//   rawText: "John Doe\nSoftware Engineer...",
//   parseMethod: "ocr_tesseract",
//   confidence: 0.7,
//   traceId: "550e8400-...",
//   extractedLength: 1234
// }
```

For detailed documentation, see [docs/PARSING.md](docs/PARSING.md).

---

## 🔒 Security Features

JobSphere implements enterprise-grade security measures:

### Authentication & Authorization

- NextAuth v5 with credential and OAuth providers
- Role-based access control (RBAC)
- Session management with JWT tokens
- Protected API routes with authentication middleware

### Data Protection

- **Encryption at rest**: OAuth tokens encrypted with AES-256-GCM
- **Encryption in transit**: HTTPS only (HSTS enforced)
- **Input validation**: Zod schemas on all API endpoints
- **SQL injection prevention**: Prisma ORM with parameterized queries
- **XSS protection**: Content Security Policy headers

### Rate Limiting

- IP-based rate limiting with Redis
- Configurable limits per endpoint type:
  - Auth endpoints: 5 requests/minute
  - API endpoints: 100 requests/minute
  - Public endpoints: 200 requests/minute
  - Strict endpoints: 10 requests/15 minutes

### Monitoring & Logging

- Sentry integration for error tracking
- Audit logging for sensitive operations
- Real-time performance monitoring
- Security event logging

See [SECURITY_IMPLEMENTATION.md](docs/SECURITY_IMPLEMENTATION.md) for complete details.

---

## 🧪 Quality Assurance

### Testing Strategy

```bash
# Run all tests
yarn test

# Run tests with coverage
yarn test:coverage

# Run tests in watch mode
yarn test:watch

# Run tests with UI
yarn test:ui
```

**Coverage gate:** a ratchet on measured values in `apps/web/vitest.config.ts` (currently
statements 22 / branches 61 / functions 39 / lines 22 — an honest floor, not a target of 80 %).
It only ever moves up.

### Type Safety

- **Strict TypeScript** mode enabled
- Strict TypeScript; remaining `any` usages are reported as lint warnings and are being reduced
- Zod runtime validation for all inputs
- Prisma-generated types for database

### Code Quality

- ESLint with strict rules
- Prettier for code formatting
- Husky pre-commit hooks
- Conventional commit messages
- Automated CI/CD pipeline

---

## 🚦 Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database (or Vercel Postgres)
- yarn 1.x (pinned via `packageManager`; do not use npm or pnpm — the lockfile is `yarn.lock`)

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/jobsphere.git
cd jobsphere
```

### 2. Install Dependencies

```bash
yarn install
# or
npm install
```

### 3. Environment Variables

Create `apps/web/.env` file:

```bash
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/jobsphere"

# NextAuth
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret-key-generate-with-openssl"

# Encryption (REQUIRED for production)
ENCRYPTION_KEY="5e7d659701318fd16b0b45bc476cc37358b91a0a4c8ed625d811bec6abb3f1ec"

# AI / Claude (REQUIRED for CV parsing, matching, grading)
ANTHROPIC_API_KEY="your-anthropic-api-key"

# Redis / Upstash (REQUIRED for rate limiting and BullMQ workers)
KV_REST_API_URL="https://your-redis-instance.upstash.io"
KV_REST_API_TOKEN="your-upstash-token"
REDIS_URL="redis://localhost:6379"  # For BullMQ workers

# File Storage (Production)
STORAGE_PROVIDER="local"  # Options: local, vercel-blob
BLOB_READ_WRITE_TOKEN="your-vercel-blob-token"  # Only for production

# OAuth (optional)
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
MICROSOFT_CLIENT_ID="your-microsoft-client-id"
MICROSOFT_CLIENT_SECRET="your-microsoft-client-secret"

# Email (optional - defaults to 'log' mode)
EMAIL_SERVICE="log"  # Options: log, resend, sendgrid
EMAIL_FROM="JobSphere <noreply@jobsphere.app>"
# RESEND_API_KEY="re_xxx"
# SENDGRID_API_KEY="SG.xxx"

# Monitoring (optional but recommended for production)
NEXT_PUBLIC_SENTRY_DSN="https://your-sentry-dsn@sentry.io/project"
NEXT_PUBLIC_POSTHOG_KEY="phc_your-posthog-key"

# Stripe (for billing)
STRIPE_SECRET_KEY="sk_test_xxx"
STRIPE_WEBHOOK_SECRET="whsec_xxx"
STRIPE_PRICE_PROFESSIONAL_MONTHLY="price_xxx"
STRIPE_PRICE_ENTERPRISE_MONTHLY="price_xxx"
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_xxx"

# App URLs
NEXT_PUBLIC_APP_URL="http://localhost:3000"
NEXT_PUBLIC_API_URL="http://localhost:3000/api"
```

**Generate Encryption Key:**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4. Database Setup

```bash
cd apps/web

# Generate Prisma Client
yarn prisma generate

# Run migrations
yarn prisma migrate dev

# (Optional) Seed database
yarn prisma db seed
```

### 5. Run Development Server

```bash
yarn dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 📁 Project Structure

```
jobsphere/
├── apps/
│   └── web/                    # Next.js web application
│       ├── src/
│       │   ├── app/            # App router pages
│       │   │   ├── [locale]/   # Internationalized routes
│       │   │   │   ├── dashboard/        # Candidate dashboard
│       │   │   │   ├── employer/         # Employer ATS
│       │   │   │   ├── jobs/             # Job listings & details
│       │   │   │   ├── login/            # Authentication
│       │   │   │   ├── signup/
│       │   │   │   ├── pricing/
│       │   │   │   └── forgot-password/
│       │   │   └── api/        # API routes
│       │   │       ├── auth/
│       │   │       ├── jobs/
│       │   │       ├── applications/
│       │   │       └── upload/
│       │   ├── components/     # React components
│       │   │   └── ui/         # shadcn/ui components
│       │   └── lib/            # Utilities
│       │       ├── prisma.ts   # Prisma client
│       │       ├── auth.ts     # NextAuth config
│       │       ├── email.ts    # Email service
│       │       └── actions/    # Server actions
│       ├── public/             # Static files
│       │   └── uploads/        # File uploads
│       ├── prisma/             # Database schema
│       └── package.json
├── packages/
│   └── database/               # Shared Prisma schema
├── docs/
│   └── archive/                # Historické reporty (COMPLETE.md, status reporty…)
└── README.md                   # This file
```

---

## 🗄️ Database Schema

### Core Models

- **User** - Authentication and user profiles
- **Organization** - Companies/Employers
- **UserOrgRole** - Organization memberships with roles (ORG_ADMIN, RECRUITER, HIRING_MANAGER, AGENCY)
- **Job** - Job postings with vector embeddings for semantic search
- **Application** - Job applications with status tracking
- **ApplicationEvent** - Application timeline/history
- **Candidate** - Candidate profiles with parsed CV data
- **CandidateContact** - Contact information for candidates
- **Email** - Email tracking
- **Subscription** - Billing/subscription management

### Assessment Models

- **Assessment** - Skills tests with sections and questions
- **AssessmentSection** - Sections within assessments
- **Question** - Questions with types (MCQ, MULTI_SELECT, SHORT_TEXT, LONG_TEXT, CODE)
- **Attempt** - Assessment submissions by candidates
- **Answer** - Individual question answers with auto-grading

### AI & Matching Models

- **MatchScore** - AI-powered job-candidate matching scores (BM25 + Vector + LLM)
- **Resume** - Parsed CV data with vector embeddings
- **ResumeSection** - Parsed resume sections (SUMMARY, EXPERIENCE, EDUCATION, SKILLS)

### Email Automation Models

- **EmailSequence** - Automated email drip campaigns
- **EmailSequenceStep** - Steps in email sequences with scheduling
- **Invite** - Assessment invitations sent to candidates

See `packages/db/prisma/schema.prisma` for complete schema.

---

## 📧 Email Configuration

JobSphere supports multiple email providers:

### Resend (Recommended)

```bash
EMAIL_SERVICE="resend"
RESEND_API_KEY="re_your_api_key"
EMAIL_FROM="JobSphere <noreply@yourdomain.com>"
```

### SendGrid

```bash
EMAIL_SERVICE="sendgrid"
SENDGRID_API_KEY="SG.your_api_key"
EMAIL_FROM="noreply@yourdomain.com"
```

### Development (Log Only)

```bash
EMAIL_SERVICE="log"  # Emails are logged to console
```

---

## 🔐 Authentication

JobSphere uses **NextAuth v5** with:

1. **Email/Password** - Bcrypt hashed passwords
2. **Google OAuth** - One-click sign-in
3. **Protected Routes** - Middleware-based protection
4. **Session Management** - JWT-based sessions

### Setting up Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable Google+ API
4. Create OAuth 2.0 credentials
5. Add authorized redirect URIs:
   - `http://localhost:3000/api/auth/callback/google` (dev)
   - `https://yourdomain.com/api/auth/callback/google` (prod)
6. Copy Client ID and Secret to `.env`

---

## 📁 File Upload

Currently uses local file storage in `public/uploads/cvs/`.

### Migrating to Cloud Storage

**Vercel Blob:**

```bash
yarn add @vercel/blob

# Update apps/web/src/app/api/upload/route.ts
import { put } from '@vercel/blob'
const blob = await put(filename, file, { access: 'public' })
```

**AWS S3:**

```bash
yarn add @aws-sdk/client-s3

# Configure S3 client and upload
```

---

## 🌍 Internationalization

JobSphere supports 5 languages out of the box:

- 🇬🇧 English (en)
- 🇩🇪 German (de)
- 🇨🇿 Czech (cs)
- 🇸🇰 Slovak (sk)
- 🇵🇱 Polish (pl)

Translations are managed via `next-intl`. To add a new language:

1. Create `messages/{locale}.json`
2. Add locale to `src/i18n.ts`
3. Update middleware config

---

## 🚀 Deployment

### Vercel (Recommended)

1. **Connect GitHub Repository**

   ```bash
   # Push to GitHub
   git add .
   git commit -m "Initial commit"
   git push origin main
   ```

2. **Import to Vercel**
   - Go to [vercel.com](https://vercel.com)
   - Import your repository
   - Set environment variables
   - Deploy

3. **Database Setup**
   - Create Vercel Postgres database
   - Copy `DATABASE_URL` to environment variables
   - Migrations run automatically on deploy

### Environment Variables for Production

Set these in Vercel Dashboard → Settings → Environment Variables:

**Required:**

```bash
DATABASE_URL=postgres://...
NEXTAUTH_URL=https://yourdomain.com
NEXTAUTH_SECRET=<generate-with-openssl-rand-base64-32>
ENCRYPTION_KEY=<generate-with-crypto.randomBytes>
KV_REST_API_URL=<upstash-redis-url>
KV_REST_API_TOKEN=<upstash-token>
```

**Recommended:**

```bash
NEXT_PUBLIC_SENTRY_DSN=<your-sentry-dsn>
EMAIL_SERVICE=resend
RESEND_API_KEY=<your-resend-key>
```

**Optional:**

```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
MICROSOFT_CLIENT_ID=...
MICROSOFT_CLIENT_SECRET=...
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=...
```

**Public variables:**

```bash
NEXT_PUBLIC_APP_URL=https://yourdomain.com
NEXT_PUBLIC_API_URL=https://yourdomain.com/api
```

**Setup Upstash Redis:**

1. Go to [upstash.com](https://upstash.com)
2. Create new Redis database
3. Copy REST API URL and Token
4. Add to environment variables

**Setup Sentry (Optional):**

1. Go to [sentry.io](https://sentry.io)
2. Create new project (Next.js)
3. Copy DSN
4. Add to environment variables

---

## 🧪 Testing

```bash
# Run type checking
yarn typecheck

# Run linting
yarn lint

# Format code
yarn format

# Build for production
yarn build
```

---

## 📊 API Reference

### Jobs API

**GET /api/jobs**

- Query params: `search`, `workMode`, `jobType`, `seniority`
- Returns: Array of active jobs

**POST /api/jobs**

- Body: Job details (title, location, salary, etc.)
- Returns: Created job
- Auth: Required

**GET /api/jobs/:id**

- Returns: Job details with organization info
- Auth: Optional

**GET /api/jobs/recommended**

- Returns: Top 10 AI-recommended jobs based on user profile
- Auth: Required

### Applications API

**GET /api/applications**

- Query params: `status`, `jobId`
- Returns: User's applications (or org applications for employers)
- Auth: Required

**POST /api/applications**

- Body: Application details (jobId, coverLetter, cvUrl)
- Returns: Created application
- Auth: Required

**GET /api/applications/:id**

- Returns: Application details
- Auth: Required (candidate or employer)

**PATCH /api/applications/:id**

- Body: Status update
- Returns: Updated application
- Auth: Required (employer only)

### Assessments API

**POST /api/assessments**

- Body: Assessment with sections and questions
- Returns: Created assessment with nested structure
- Auth: Required (employer only)

**GET /api/assessments/:id**

- Returns: Assessment details with all questions
- Auth: Required

**POST /api/assessments/:id/submit**

- Body: Attempt with answers
- Returns: Submitted attempt (auto-graded via Claude AI)
- Auth: Required

**GET /api/assessments/:id/results**

- Returns: All attempts for this assessment with scores
- Auth: Required (employer only)

### Candidate Search API

**POST /api/candidates/search**

- Body: Search query with filters (skills, experience, location)
- Returns: Candidates with hybrid match scores (BM25 + Vector + LLM)
- Auth: Required (employer only)

**GET /api/candidates/:id/match-scores**

- Returns: Match scores vs. all open jobs for organization
- Auth: Required (employer only)

### Email Sequences API

**GET /api/email-sequences**

- Returns: All email sequences for organization
- Auth: Required (employer only)

**POST /api/email-sequences**

- Body: Sequence with steps (subject, body, delay)
- Returns: Created email sequence
- Auth: Required (employer only)

**GET /api/email-sequences/:id**

- Returns: Email sequence details
- Auth: Required (employer only)

**PATCH /api/email-sequences/:id**

- Body: Updated sequence details
- Returns: Updated sequence
- Auth: Required (employer only)

**DELETE /api/email-sequences/:id**

- Returns: Success confirmation
- Auth: Required (employer only)

### Team Management API

**GET /api/organizations/current/members**

- Returns: Team members with roles
- Auth: Required

**POST /api/organizations/current/members**

- Body: Email and role for new member
- Returns: Invitation sent confirmation
- Auth: Required (ORG_ADMIN only)

**PATCH /api/organizations/current/members/:userId**

- Body: New role
- Returns: Updated member
- Auth: Required (ORG_ADMIN only)

**DELETE /api/organizations/current/members/:userId**

- Returns: Success confirmation
- Auth: Required (ORG_ADMIN only)

### Upload API

**POST /api/upload**

- Body: FormData with file
- Returns: File URL
- Auth: Required
- Max size: 5MB
- Allowed: PDF, DOC, DOCX

**POST /api/cv/upload**

- Body: FormData with CV file
- Returns: Parsed CV data with traceId
- Auth: Required
- Max size: 10MB
- Features: Multi-stage parsing, OCR fallback, antivirus scanning

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [Next.js](https://nextjs.org/) - React framework
- [Vercel](https://vercel.com/) - Hosting platform
- [Prisma](https://www.prisma.io/) - Database ORM
- [shadcn/ui](https://ui.shadcn.com/) - UI components
- [NextAuth](https://next-auth.js.org/) - Authentication
- [Resend](https://resend.com/) - Email service

---

## 📞 Support

- **Documentation:** [docs/archive/COMPLETE.md](docs/archive/COMPLETE.md)
- **Issues:** [GitHub Issues](https://github.com/yourusername/jobsphere/issues)
- **Email:** support@jobsphere.app

---

**Made with ❤️ by the JobSphere Team**
