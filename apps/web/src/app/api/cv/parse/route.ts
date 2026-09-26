/**
 * CV Parse API
 * Parses raw text with Claude & saves to database
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveActiveMembership } from '@/lib/api-helpers'
import { extractCvFromText } from '@jobsphere/ai'
import { addEmbeddingJob } from '@/lib/queue'
import { logger } from '@/lib/logger'
import { withRateLimit } from '@/lib/rate-limit'
import { withCsrfProtection } from '@/lib/csrf'
import { getOrCreateCandidateForUser, getPersonalCandidateForUser } from '@/lib/identity'
import { isAllowedCvUrl } from '@/lib/cv-url'
import { extractedCvToResumeFields } from '@/lib/cv-resume-fields'

export const runtime = 'nodejs'

// Validate the request body. rawText is the extracted CV text; the optional
// file metadata is produced by /api/cv/upload and forwarded by the client so we
// can persist the stored file as a CandidateDocument and link it to the created
// Resume (SEC-001).
const parseSchema = z.object({
  rawText: z.string().min(1).max(1_000_000),
  fileUrl: z.string().url().optional(),
  filename: z.string().max(500).optional(),
  mime: z.string().max(200).optional(),
  size: z.number().int().nonnegative().optional(),
  hash: z.string().max(200).optional(),
})

export const POST = withCsrfProtection(
  withRateLimit(
    async (request: Request) => {
      try {
        // 1. Optional authentication - allow anonymous users
        const session = await auth()

        // 2. Get raw text (and optional uploaded-file metadata) from body.
        const body = await request.json()
        const validation = parseSchema.safeParse(body)
        if (!validation.success) {
          return NextResponse.json(
            { error: 'Invalid request data', details: validation.error.issues },
            { status: 400 },
          )
        }

        const { rawText, fileUrl, filename, mime, size, hash } = validation.data

        if (rawText.length < 20) {
          return NextResponse.json(
            {
              error: `Invalid CV text - too short (${rawText.length} characters, minimum 20 required)`,
            },
            { status: 400 },
          )
        }

        // SSRF guard (F1): the file reference is later fetched server-side by the CV
        // download route, so reject any client-provided fileUrl that isn't one we
        // produced (Vercel Blob / local uploads). Checked before the costly AI call.
        if (fileUrl && !isAllowedCvUrl(fileUrl)) {
          return NextResponse.json({ error: 'Invalid file reference' }, { status: 400 })
        }

        logger.info('Parsing CV', { textLength: rawText.length })

        // Get locale from accept-language header or default to 'en'
        const acceptLanguage = request.headers.get('accept-language')
        const locale = acceptLanguage?.split(',')[0]?.split('-')[0] || 'en'

        // 4. Parse CV with AI (OpenRouter Gemini Flash or Claude fallback)
        const openRouterKey = process.env.OPENROUTER_API_KEY
        const anthropicKey = process.env.ANTHROPIC_API_KEY

        if (!openRouterKey && !anthropicKey) {
          return NextResponse.json({ error: 'AI service not configured' }, { status: 500 })
        }

        const extractedCV = await extractCvFromText(rawText, {
          openRouterApiKey: openRouterKey,
          apiKey: anthropicKey,
          model: openRouterKey ? 'google/gemini-2.5-flash-lite' : 'claude-opus-4-20250514',
          locale,
        })

        // Detect an empty/garbage extraction so we don't silently report success on
        // a CV the AI couldn't read (the caller surfaces extractionEmpty).
        const extractionEmpty =
          !extractedCV.summary &&
          !extractedCV.personal?.fullName &&
          !(Array.isArray(extractedCV.experiences) && extractedCV.experiences.length > 0) &&
          !(Array.isArray(extractedCV.education) && extractedCV.education.length > 0) &&
          !(Array.isArray(extractedCV.skills) && extractedCV.skills.length > 0)
        if (extractionEmpty) {
          logger.warn('CV extraction produced no usable fields', { textLength: rawText.length })
        }

        // 5. If user is logged in, save to database
        if (session?.user?.id) {
          // Resolve the Candidate to attach this CV to. Employer-side members get
          // their org candidate; a plain job-seeker (no org membership) gets their
          // PERSONAL candidate so the uploaded CV lands in their own profile
          // instead of failing — the "my CV in my profile" model.
          const userOrg = await resolveActiveMembership(session.user.id, session.user.activeOrgId)

          const candidate = userOrg
            ? await getOrCreateCandidateForUser(session.user.id, userOrg.orgId)
            : await getPersonalCandidateForUser(session.user.id)

          // If the upload step provided the stored file reference, persist it as a
          // CandidateDocument so the CV is no longer orphaned and can be served via
          // the authenticated download route (SEC-001).
          let sourceDocumentId: string | undefined
          if (fileUrl && filename && mime && typeof size === 'number') {
            const document = await prisma.candidateDocument.create({
              data: {
                candidateId: candidate.id,
                type: 'CV',
                uri: fileUrl,
                filename,
                mime,
                size,
                hash: hash || null,
                parsedAt: new Date(),
              },
            })
            sourceDocumentId = document.id
          }

          // Create Resume record from the parsed CV, linking the source document
          // when available. Populate the structured JSON columns (builder shape) so
          // the employer detail + "Moje CV" preview show the uploaded CV's
          // experience/education/skills/languages — not just the summary.
          const structured = extractedCvToResumeFields(extractedCV)
          const resume = await prisma.resume.create({
            data: {
              candidateId: candidate.id,
              sourceDocumentId,
              language: locale,
              summary: extractedCV.summary || null,
              personalInfo: structured.personalInfo,
              experiences: structured.experiences,
              education: structured.education,
              languages: structured.languages,
              skills: structured.skills,
            },
          })

          // 6. Create ResumeSection records from extractedCV
          const sections = []

          if (extractedCV.summary) {
            sections.push({
              resumeId: resume.id,
              kind: 'SUMMARY',
              text: extractedCV.summary,
              order: 1,
            })
          }

          if (extractedCV.experiences && Array.isArray(extractedCV.experiences)) {
            const experienceText = extractedCV.experiences
              .map((exp: any) => {
                const parts = []
                if (exp.title) parts.push(exp.title)
                if (exp.company) parts.push(exp.company)
                if (exp.period) parts.push(exp.period)
                if (exp.description) parts.push(exp.description)
                return parts.join(' | ')
              })
              .join('\n\n')

            if (experienceText) {
              sections.push({
                resumeId: resume.id,
                kind: 'EXPERIENCE',
                text: experienceText,
                order: 2,
              })
            }
          }

          if (extractedCV.education && Array.isArray(extractedCV.education)) {
            const educationText = extractedCV.education
              .map((edu: any) => {
                const parts = []
                if (edu.degree) parts.push(edu.degree)
                if (edu.institution) parts.push(edu.institution)
                if (edu.year) parts.push(edu.year)
                if (edu.field) parts.push(edu.field)
                return parts.join(' | ')
              })
              .join('\n\n')

            if (educationText) {
              sections.push({
                resumeId: resume.id,
                kind: 'EDUCATION',
                text: educationText,
                order: 3,
              })
            }
          }

          if (extractedCV.skills && Array.isArray(extractedCV.skills)) {
            const skillsText = extractedCV.skills.join(', ')

            if (skillsText) {
              sections.push({
                resumeId: resume.id,
                kind: 'SKILLS',
                text: skillsText,
                order: 4,
              })
            }
          }

          // Bulk create sections
          if (sections.length > 0) {
            await prisma.resumeSection.createMany({
              data: sections,
            })
          }

          // 7. Queue embedding generation job asynchronously
          if (sections.length > 0) {
            addEmbeddingJob({ resumeId: resume.id }).catch((error) => {
              logger.error('Failed to queue embedding job', error)
              // Don't fail the request if job queueing fails
            })
            logger.info('Queued embedding job for resume', { resumeId: resume.id })
          }

          return NextResponse.json({
            resumeId: resume.id,
            candidateId: candidate.id,
            documentId: sourceDocumentId ?? null,
            success: true,
            parsed: extractedCV,
            sectionsCreated: sections.length,
            extractionEmpty,
          })
        }

        // 6. For anonymous users, just return parsed data (don't save to DB)
        return NextResponse.json({
          success: true,
          parsed: extractedCV,
          extractionEmpty,
          anonymous: true,
        })
      } catch (error) {
        logger.error('CV parse error', error)
        return NextResponse.json({ error: 'Failed to parse CV' }, { status: 500 })
      }
    },
    { preset: 'upload' }, // 10 requests per 5 minutes
  ),
)
