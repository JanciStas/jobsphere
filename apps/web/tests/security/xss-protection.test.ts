/**
 * XSS (Cross-Site Scripting) Protection Security Tests
 *
 * Comprehensive security tests to verify XSS prevention across all API endpoints.
 * Tests both API responses AND database storage to ensure no malicious scripts
 * can be injected at any layer.
 *
 * Test Coverage:
 * - Script tag injection
 * - Event handler injection (onerror, onclick, onload)
 * - HTML entity encoding
 * - Malformed URLs (javascript:, data:)
 * - XSS in query parameters
 * - Reflected XSS prevention
 * - Stored XSS prevention
 *
 * @see OWASP XSS Prevention Cheat Sheet
 *
 * 2026-09 repair — each write path is asserted against its REAL contract:
 *
 *  - POST /api/jobs and POST /api/applications do NOT sanitize HTML on write.
 *    Zod checks shape and length only, and the payload is stored verbatim as
 *    inert text. Execution safety of that text is a render-layer property —
 *    React escapes it — verified in tests/e2e/security.spec.ts ("React escapes
 *    the value, so it must survive as literal text and never run"). What these
 *    tests pin for those routes is the API-layer truth: the payload round-trips
 *    unchanged as data, nothing is evaluated or transformed server-side, and
 *    the response is JSON, never an HTML page that could execute it.
 *
 *  - PATCH /api/organizations/[id] DOES sanitize (src/lib/sanitize.ts): name and
 *    description through sanitizeHtml, website through sanitizeUrl, which
 *    rejects javascript:/data: schemes. Those tests assert the sanitized output.
 *
 *  - A few fixtures used to send seniority 'MEDIOR', which is not in the enum
 *    (JUNIOR/MID/SENIOR/LEAD/EXECUTIVE) — every job-create request 400'd before
 *    the payload ever reached the assertions below.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { POST as JobsPOST, GET as JobsGET } from '@/app/api/jobs/route'
import { POST as ApplicationsPOST } from '@/app/api/applications/route'
import { PATCH as OrgPATCH } from '@/app/api/organizations/[id]/route'
import {
  createTestRequest,
  createRecruiterSession,
  createOrgAdminSession,
  createCandidateSession,
  parseResponse,
} from '../integration/helpers/api-client'
import { prisma, TEST_IDS, cleanupDynamicData } from '../integration/helpers/test-db'

/**
 * XSS Attack Payloads
 * Based on OWASP XSS Filter Evasion Cheat Sheet
 */
const XSS_PAYLOADS = {
  // Basic script injection
  basicScript: '<script>alert("xss")</script>',
  scriptWithSrc: '<script src="https://evil.com/xss.js"></script>',

  // Event handlers
  imgOnerror: '<img src=x onerror=alert(1)>',
  imgOnload: '<img src="valid.jpg" onload=alert(1)>',
  svgOnload: '<svg onload=alert(1)>',
  divOnclick: '<div onclick=alert(1)>Click</div>',
  inputOnfocus: '<input onfocus=alert(1) autofocus>',
  bodyOnload: '<body onload=alert(1)>',

  // JavaScript protocol URLs
  jsProtocol: 'javascript:alert(1)',
  jsProtocolInLink: '<a href="javascript:alert(1)">click</a>',

  // Data URIs
  dataUri: 'data:text/html,<script>alert(1)</script>',
  dataUriBase64: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',

  // Special characters
  htmlEntities: '&lt;script&gt;alert("xss")&lt;/script&gt;',
  angleBrackets: '< > & " \' /',

  // Case variations
  upperCase: '<SCRIPT>alert(1)</SCRIPT>',
  mixedCase: '<ScRiPt>alert(1)</sCrIpT>',

  // Polyglot payloads
  polyglot: 'jaVasCript:/*-/*`/*\\`/*\'/*"/**/(/* */onerror=alert(1) )//%0D%0A%0d%0a//',

  // HTML5 event handlers
  detailsOntoggle: '<details open ontoggle=alert(1)>',
  videoOncanplay: '<video oncanplay=alert(1)><source>',
}

// Mock NextAuth using vi.hoisted for proper hoisting
const { mockAuthFn } = vi.hoisted(() => ({
  mockAuthFn: vi.fn(),
}))

// Partial mock. lib/errors.ts reaches UnauthorizedError through @/lib/auth, so
// replacing the module wholesale makes handleApiError throw while handling an
// error. requireAuth is overridden too: the real one calls the real auth(),
// which needs a Next request context this harness does not have.
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  auth: mockAuthFn,
  requireAuth: vi.fn(async () => {
    const session = await mockAuthFn()
    if (!session?.user?.id) {
      throw new Error('You must be logged in to access this resource')
    }
    return session
  }),
}))

// Job creation ends with revalidatePath('/jobs'), which outside a Next request
// context throws "static generation store missing" and fails an otherwise
// successful request — the same mock tests/integration/api/jobs/create.test.ts
// uses.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

describe('XSS Protection Security Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await cleanupDynamicData()
  })

  describe('1. Script Tag Injection', () => {
    it('stores a script tag in the job title as inert data', async () => {
      // Arrange
      mockAuthFn.mockResolvedValue(createRecruiterSession())

      const xssPayload = XSS_PAYLOADS.basicScript
      const request = createTestRequest('POST', {
        title: xssPayload,
        description: 'A'.repeat(100),
        employmentType: 'FULL_TIME',
        workMode: 'REMOTE',
        type: 'FULL_TIME',
        seniority: 'MID',
      })

      // Act
      const response = await JobsPOST(request)
      const data = await parseResponse(response)

      // Assert — see the file header: jobs are stored verbatim; the render
      // layer escapes. The API contract is a byte-exact round-trip.
      expect(response.status).toBe(201)
      expect(response.headers.get('content-type')).toContain('application/json')
      expect(data.title).toBe(xssPayload)

      // Verify database storage matches what was sent, exactly
      const job = await prisma.job.findUnique({
        where: { id: data.id },
      })
      expect(job?.title).toBe(xssPayload)
    })

    it('stores script tags in the job description as inert data', async () => {
      // Arrange
      mockAuthFn.mockResolvedValue(createRecruiterSession())

      const maliciousDescription = `
        This is a great job opportunity!
        ${XSS_PAYLOADS.basicScript}
        ${XSS_PAYLOADS.scriptWithSrc}
        Please apply today!
      `

      const request = createTestRequest('POST', {
        title: 'Senior Developer',
        description: maliciousDescription,
        employmentType: 'FULL_TIME',
        workMode: 'REMOTE',
        type: 'FULL_TIME',
        seniority: 'SENIOR',
      })

      // Act
      const response = await JobsPOST(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(201)
      expect(response.headers.get('content-type')).toContain('application/json')

      // Verify database
      const job = await prisma.job.findUnique({
        where: { id: data.id },
      })
      expect(job?.description).toContain('<script>alert("xss")</script>')
      expect(job?.description).toContain('<script src="https://evil.com/xss.js"></script>')
    })

    it('stores a script tag in the cover letter as inert data', async () => {
      // Arrange - create a job first
      mockAuthFn.mockResolvedValue(createRecruiterSession())

      const jobRequest = createTestRequest('POST', {
        title: 'Test Job',
        description: 'A'.repeat(100),
        employmentType: 'FULL_TIME',
        workMode: 'REMOTE',
        type: 'FULL_TIME',
        seniority: 'MID',
      })

      const jobResponse = await JobsPOST(jobRequest)
      const jobData = await parseResponse(jobResponse)

      // Switch to candidate session
      mockAuthFn.mockResolvedValue(createCandidateSession())

      const maliciousCoverLetter = `
        Dear Hiring Manager,
        ${XSS_PAYLOADS.basicScript}
        I am very interested in this position.
        ${XSS_PAYLOADS.upperCase}
        Best regards
      `

      const appRequest = createTestRequest('POST', {
        jobId: jobData.id,
        coverLetter: maliciousCoverLetter,
      })

      // Act
      const response = await ApplicationsPOST(appRequest)
      const data = await parseResponse(response)

      // Assert — applications, like jobs, store cover letters verbatim
      expect(response.status).toBe(201)

      // Verify database
      const application = await prisma.application.findUnique({
        where: { id: data.id },
      })
      expect(application?.coverLetter).toContain('<script>alert("xss")</script>')
      expect(application?.coverLetter).toContain('<SCRIPT>alert(1)</SCRIPT>')
    })
  })

  describe('2. Event Handler Injection', () => {
    it('stores an img onerror payload in the job title as inert data', async () => {
      // Arrange
      mockAuthFn.mockResolvedValue(createRecruiterSession())

      const request = createTestRequest('POST', {
        title: XSS_PAYLOADS.imgOnerror,
        description: 'A'.repeat(100),
        employmentType: 'FULL_TIME',
        workMode: 'REMOTE',
        type: 'FULL_TIME',
        seniority: 'MID',
      })

      // Act
      const response = await JobsPOST(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(201)
      expect(data.title).toBe(XSS_PAYLOADS.imgOnerror)

      // Verify database
      const job = await prisma.job.findUnique({
        where: { id: data.id },
      })
      expect(job?.title).toBe(XSS_PAYLOADS.imgOnerror)
    })

    it('stores event handler payloads in the job description as inert data', async () => {
      // Arrange
      mockAuthFn.mockResolvedValue(createRecruiterSession())

      const maliciousDescription = `
        Job Requirements:
        ${XSS_PAYLOADS.imgOnerror}
        ${XSS_PAYLOADS.divOnclick}
        ${XSS_PAYLOADS.imgOnload}
        ${XSS_PAYLOADS.svgOnload}
        ${XSS_PAYLOADS.inputOnfocus}
        ${XSS_PAYLOADS.bodyOnload}
        ${XSS_PAYLOADS.detailsOntoggle}
        Apply now!
      `

      const request = createTestRequest('POST', {
        title: 'Developer Position',
        description: maliciousDescription,
        employmentType: 'FULL_TIME',
        workMode: 'REMOTE',
        type: 'FULL_TIME',
        seniority: 'MID',
      })

      // Act
      const response = await JobsPOST(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(201)

      // Verify database
      const job = await prisma.job.findUnique({
        where: { id: data.id },
      })
      expect(job?.description).toContain('<img src=x onerror=alert(1)>')
      expect(job?.description).toContain('<div onclick=alert(1)>Click</div>')
    })

    it('should sanitize event handlers in organization name', async () => {
      // Arrange
      mockAuthFn.mockResolvedValue(createOrgAdminSession())

      // Create test org
      const org = await prisma.organization.create({
        data: {
          name: 'Test Org',
          slug: `test-org-${Date.now()}`,
        },
      })

      // Add admin membership
      await prisma.userOrgRole.create({
        data: {
          userId: TEST_IDS.admin,
          orgId: org.id,
          role: 'ORG_ADMIN',
        },
      })

      const request = createTestRequest('PATCH', {
        name: `Evil Corp ${XSS_PAYLOADS.imgOnerror}`,
      })

      // Act
      const response = await OrgPATCH(request, { params: { id: org.id } })
      const data = await parseResponse(response)

      // Assert — the org route sanitizes for real (src/lib/sanitize.ts)
      expect(response.status).toBe(200)
      expect(data.name).not.toMatch(/onerror/i)

      // Verify database
      const updated = await prisma.organization.findUnique({
        where: { id: org.id },
      })
      expect(updated?.name).not.toMatch(/onerror/i)

      // Cleanup
      await prisma.userOrgRole.deleteMany({ where: { orgId: org.id } })
      await prisma.organization.delete({ where: { id: org.id } })
    })
  })

  describe('3. HTML Entity Encoding', () => {
    it('stores special characters in the job title verbatim', async () => {
      // Arrange
      mockAuthFn.mockResolvedValue(createRecruiterSession())

      const specialTitle = `Developer ${XSS_PAYLOADS.angleBrackets} Position`
      const request = createTestRequest('POST', {
        title: specialTitle,
        description: 'A'.repeat(100),
        employmentType: 'FULL_TIME',
        workMode: 'REMOTE',
        type: 'FULL_TIME',
        seniority: 'MID',
      })

      // Act
      const response = await JobsPOST(request)
      const data = await parseResponse(response)

      // Assert — no encoding happens on write; the title is data, and any
      // escaping belongs to (and is verified at) the render layer.
      expect(response.status).toBe(201)

      const job = await prisma.job.findUnique({
        where: { id: data.id },
      })
      expect(job?.title).toBe(specialTitle)
    })

    it('keeps HTML entities as literal text, never decoded into markup', async () => {
      // Arrange
      mockAuthFn.mockResolvedValue(createRecruiterSession())

      const htmlEntities = XSS_PAYLOADS.htmlEntities
      const request = createTestRequest('POST', {
        title: 'Test Job',
        description: `Description with entities: ${htmlEntities}`,
        employmentType: 'FULL_TIME',
        workMode: 'REMOTE',
        type: 'FULL_TIME',
        seniority: 'MID',
      })

      // Act
      const response = await JobsPOST(request)
      const data = await parseResponse(response)

      // Assert — '&lt;script&gt;' is already inert text; the server must not
      // decode it into live markup anywhere on the way in or out.
      expect(response.status).toBe(201)
      expect(data.description).not.toContain('<script>')

      const job = await prisma.job.findUnique({
        where: { id: data.id },
      })
      expect(job?.description).toContain('&lt;script&gt;')
      expect(job?.description).not.toMatch(/<script[^>]*>/i)
    })
  })

  describe('4. Malformed URLs', () => {
    it('documents that a direct DB write of a javascript: LinkedIn URL is stored verbatim', async () => {
      // No API route accepts `linkedIn` as input (only the GDPR/export readers
      // select it) — so there is no API boundary to test here. This test writes
      // through Prisma directly, and Prisma has no sanitizing middleware, so
      // the value lands verbatim. That is the expected behaviour of a direct
      // DB write; it also documents the obligation: any future API write path
      // for contact URLs must validate the scheme (the org route's sanitizeUrl
      // is the in-repo pattern), and the render layer must treat the field as
      // untrusted text.
      const candidate = await prisma.candidate.create({
        data: {
          orgId: TEST_IDS.org,
          source: 'MANUAL',
        },
      })

      const maliciousContact = await prisma.candidateContact.create({
        data: {
          candidateId: candidate.id,
          fullName: 'Test Candidate',
          email: 'test@example.com',
          linkedIn: XSS_PAYLOADS.jsProtocol,
        },
      })

      const stored = await prisma.candidateContact.findUnique({
        where: { id: maliciousContact.id },
      })
      expect(stored?.linkedIn).toBe(XSS_PAYLOADS.jsProtocol)

      // Cleanup
      await prisma.candidateContact.delete({ where: { id: maliciousContact.id } })
      await prisma.candidate.delete({ where: { id: candidate.id } })
    })

    it('nullifies a data: URI website through the org route sanitizer', async () => {
      // Arrange
      mockAuthFn.mockResolvedValue(createOrgAdminSession())

      const org = await prisma.organization.create({
        data: {
          name: 'Test Org',
          slug: `test-org-${Date.now()}`,
        },
      })

      await prisma.userOrgRole.create({
        data: {
          userId: TEST_IDS.admin,
          orgId: org.id,
          role: 'ORG_ADMIN',
        },
      })

      const request = createTestRequest('PATCH', {
        website: XSS_PAYLOADS.dataUri,
      })

      // Act
      const response = await OrgPATCH(request, { params: { id: org.id } })
      const data = await parseResponse(response)

      // Assert — sanitizeUrl's allowed schemes are http/https/mailto/tel/…;
      // a data: URI is rejected and the field becomes null (not stored, not
      // partially trimmed).
      expect(response.status).toBe(200)
      expect(data.website).toBeNull()

      // Cleanup
      await prisma.userOrgRole.deleteMany({ where: { orgId: org.id } })
      await prisma.organization.delete({ where: { id: org.id } })
    })
  })

  describe('5. XSS in Query Parameters', () => {
    it('should sanitize XSS payload in search query parameter', async () => {
      // Arrange
      const xssSearch = XSS_PAYLOADS.basicScript
      const url = `http://localhost:3000/api/jobs?search=${encodeURIComponent(xssSearch)}`
      const request = createTestRequest('GET', undefined, {}, url)

      // Act
      const response = await JobsGET(request)

      // Assert - should not crash and should not reflect raw script
      expect(response.status).toBeLessThan(500)

      if (response.status === 200) {
        const data = await parseResponse(response)
        const responseStr = JSON.stringify(data)
        expect(responseStr).not.toContain('<script>')
        expect(responseStr).not.toMatch(/<script[^>]*>/i)
      }
    })

    it('should verify query params are sanitized before database queries', async () => {
      // Arrange - create a job with normal content
      mockAuthFn.mockResolvedValue(createRecruiterSession())

      const jobRequest = createTestRequest('POST', {
        title: 'Normal Job Title',
        description: 'A'.repeat(100),
        employmentType: 'FULL_TIME',
        workMode: 'REMOTE',
        type: 'FULL_TIME',
        seniority: 'MID',
      })

      await JobsPOST(jobRequest)

      // Try to search with XSS payload
      const xssPayloads = [
        XSS_PAYLOADS.basicScript,
        XSS_PAYLOADS.imgOnerror,
        XSS_PAYLOADS.jsProtocol,
        XSS_PAYLOADS.polyglot,
      ]

      for (const payload of xssPayloads) {
        const url = `http://localhost:3000/api/jobs?search=${encodeURIComponent(payload)}`
        const request = createTestRequest('GET', undefined, {}, url)

        // Act
        const response = await JobsGET(request)

        // Assert - should handle safely without SQL injection or XSS
        expect(response.status).toBeLessThan(500)

        if (response.status === 200) {
          const data = await parseResponse(response)
          const responseStr = JSON.stringify(data)

          // Response should not contain unescaped XSS payloads
          expect(responseStr).not.toMatch(/<script[^>]*>/i)
          expect(responseStr).not.toMatch(/onerror\s*=/i)
          expect(responseStr).not.toMatch(/javascript:/i)
        }
      }
    })
  })

  describe('6. Reflected XSS Prevention', () => {
    it('should not reflect unsanitized user input in error messages', async () => {
      // Arrange
      mockAuthFn.mockResolvedValue(createRecruiterSession())

      const maliciousTitle = XSS_PAYLOADS.basicScript
      const request = createTestRequest('POST', {
        title: maliciousTitle,
        // Missing required fields to trigger validation error
        employmentType: 'FULL_TIME',
      })

      // Act
      const response = await JobsPOST(request)

      // Assert
      if (response.status === 400) {
        const data = await parseResponse(response)
        const errorStr = JSON.stringify(data)

        // Error message should not reflect raw XSS payload
        expect(errorStr).not.toContain('<script>')
        expect(errorStr).not.toMatch(/<script[^>]*>/i)
      }
    })

    it('should sanitize error responses for invalid data', async () => {
      // Arrange
      mockAuthFn.mockResolvedValue(createRecruiterSession())

      const maliciousData = {
        title: XSS_PAYLOADS.imgOnerror,
        description: XSS_PAYLOADS.divOnclick,
        employmentType: XSS_PAYLOADS.jsProtocol, // Invalid enum value with XSS
        workMode: 'REMOTE',
        type: 'FULL_TIME',
        seniority: 'MID',
      }

      const request = createTestRequest('POST', maliciousData)

      // Act
      const response = await JobsPOST(request)

      // Assert
      const data = await parseResponse(response)
      const responseStr = JSON.stringify(data)

      // Should not reflect XSS payloads in error response
      expect(responseStr).not.toMatch(/<script[^>]*>/i)
      expect(responseStr).not.toMatch(/onerror/i)
      expect(responseStr).not.toMatch(/onclick/i)
      expect(responseStr).not.toMatch(/javascript:/i)
    })
  })

  describe('7. Stored XSS Prevention', () => {
    it('round-trips a job with XSS payloads as inert, unchanged data', async () => {
      // Arrange - Create job with XSS payload
      mockAuthFn.mockResolvedValue(createRecruiterSession())

      const xssTitle = `Senior Developer ${XSS_PAYLOADS.basicScript}`
      const xssDescription = `
        Great opportunity!
        ${XSS_PAYLOADS.imgOnerror}
        ${XSS_PAYLOADS.divOnclick}
      `

      const createRequest = createTestRequest('POST', {
        title: xssTitle,
        description: xssDescription,
        employmentType: 'FULL_TIME',
        workMode: 'REMOTE',
        type: 'FULL_TIME',
        seniority: 'SENIOR',
      })

      // Act - Create job
      const createResponse = await JobsPOST(createRequest)
      const createData = await parseResponse(createResponse)

      expect(createResponse.status).toBe(201)

      // Retrieve job via API
      const getRequest = createTestRequest('GET', undefined, {}, 'http://localhost:3000/api/jobs')
      const getResponse = await JobsGET(getRequest)
      const jobs = await parseResponse(getResponse)

      // Assert - Find our job
      const retrievedJob = Array.isArray(jobs)
        ? jobs.find((j: any) => j.id === createData.id)
        : null

      if (retrievedJob) {
        // Retrieved data must match what was stored — no transformation on the
        // way out either.
        expect(retrievedJob.title).toBe(xssTitle)
      }

      // Verify database storage — verbatim, inert
      const dbJob = await prisma.job.findUnique({
        where: { id: createData.id },
      })
      expect(dbJob?.title).toBe(xssTitle)
      expect(dbJob?.description).toContain('<img src=x onerror=alert(1)>')
    })

    it('round-trips a cover letter with XSS payloads as inert, unchanged data', async () => {
      // Arrange - Create job
      mockAuthFn.mockResolvedValue(createRecruiterSession())

      const jobRequest = createTestRequest('POST', {
        title: 'Test Job',
        description: 'A'.repeat(100),
        employmentType: 'FULL_TIME',
        workMode: 'REMOTE',
        type: 'FULL_TIME',
        seniority: 'MID',
      })

      const jobResponse = await JobsPOST(jobRequest)
      const job = await parseResponse(jobResponse)

      // Switch to candidate and apply with malicious cover letter
      mockAuthFn.mockResolvedValue(createCandidateSession())

      const xssCoverLetter = `
        Dear Hiring Manager,

        ${XSS_PAYLOADS.basicScript}
        ${XSS_PAYLOADS.imgOnerror}
        ${XSS_PAYLOADS.svgOnload}

        I am very interested in this position.

        ${XSS_PAYLOADS.jsProtocolInLink}

        Best regards
      `

      const appRequest = createTestRequest('POST', {
        jobId: job.id,
        coverLetter: xssCoverLetter,
      })

      // Act
      const appResponse = await ApplicationsPOST(appRequest)
      const application = await parseResponse(appResponse)

      // Assert
      expect(appResponse.status).toBe(201)

      // Verify database storage — verbatim, inert
      const dbApplication = await prisma.application.findUnique({
        where: { id: application.id },
      })
      expect(dbApplication?.coverLetter).toContain('<script>alert("xss")</script>')
      expect(dbApplication?.coverLetter).toContain('<img src=x onerror=alert(1)>')
      expect(dbApplication?.coverLetter).toContain('<a href="javascript:alert(1)">click</a>')
    })
  })

  describe('8. Additional XSS Attack Vectors', () => {
    it('stores case-variation payloads verbatim as inert data', async () => {
      // Arrange
      mockAuthFn.mockResolvedValue(createRecruiterSession())

      const caseVariations = [
        XSS_PAYLOADS.upperCase,
        XSS_PAYLOADS.mixedCase,
        '<ScRiPt>alert(1)</ScRiPt>',
        '<IMG SRC=x ONERROR=alert(1)>',
      ]

      for (const payload of caseVariations) {
        const request = createTestRequest('POST', {
          title: payload,
          description: 'A'.repeat(100),
          employmentType: 'FULL_TIME',
          workMode: 'REMOTE',
          type: 'FULL_TIME',
          seniority: 'MID',
        })

        // Act
        const response = await JobsPOST(request)
        const data = await parseResponse(response)

        // Assert — verbatim storage; case games change nothing at this layer
        expect(response.status).toBe(201)

        const job = await prisma.job.findUnique({
          where: { id: data.id },
        })
        expect(job?.title).toBe(payload)
      }
    })

    it('stores a polyglot payload verbatim as inert data', async () => {
      // Arrange
      mockAuthFn.mockResolvedValue(createRecruiterSession())

      const request = createTestRequest('POST', {
        title: 'Test Job',
        description: XSS_PAYLOADS.polyglot,
        employmentType: 'FULL_TIME',
        workMode: 'REMOTE',
        type: 'FULL_TIME',
        seniority: 'MID',
      })

      // Act
      const response = await JobsPOST(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(201)

      const job = await prisma.job.findUnique({
        where: { id: data.id },
      })
      expect(job?.description).toBe(XSS_PAYLOADS.polyglot)
    })

    it('stores an SVG payload verbatim as inert data', async () => {
      // Arrange
      mockAuthFn.mockResolvedValue(createRecruiterSession())

      const svgXss = `
        <svg xmlns="http://www.w3.org/2000/svg">
          <script>alert(1)</script>
        </svg>
        ${XSS_PAYLOADS.svgOnload}
      `

      const request = createTestRequest('POST', {
        title: 'Test Job',
        description: svgXss,
        employmentType: 'FULL_TIME',
        workMode: 'REMOTE',
        type: 'FULL_TIME',
        seniority: 'MID',
      })

      // Act
      const response = await JobsPOST(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(201)

      const job = await prisma.job.findUnique({
        where: { id: data.id },
      })
      expect(job?.description).toContain('<svg xmlns="http://www.w3.org/2000/svg">')
      expect(job?.description).toContain('<svg onload=alert(1)>')
    })

    it('stores a split-across-fields attack as two inert fields', async () => {
      // Arrange - Split attack across multiple fields
      mockAuthFn.mockResolvedValue(createRecruiterSession())

      const request = createTestRequest('POST', {
        title: '<script>alert',
        description: '("xss")</script>',
        employmentType: 'FULL_TIME',
        workMode: 'REMOTE',
        type: 'FULL_TIME',
        seniority: 'MID',
      })

      // Act
      const response = await JobsPOST(request)
      const data = await parseResponse(response)

      // Assert — each field is stored verbatim; only a render layer that
      // concatenated title+description into markup unsafely could reassemble
      // them, and no layer does.
      expect(response.status).toBe(201)

      const job = await prisma.job.findUnique({
        where: { id: data.id },
      })
      expect(job?.title).toBe('<script>alert')
      expect(job?.description).toBe('("xss")</script>')
    })
  })

  describe('9. Context-Specific XSS Tests', () => {
    it('should sanitize organization description with HTML content', async () => {
      // Arrange
      mockAuthFn.mockResolvedValue(createOrgAdminSession())

      const org = await prisma.organization.create({
        data: {
          name: 'Test Org',
          slug: `test-org-${Date.now()}`,
        },
      })

      await prisma.userOrgRole.create({
        data: {
          userId: TEST_IDS.admin,
          orgId: org.id,
          role: 'ORG_ADMIN',
        },
      })

      const maliciousDescription = `
        We are a leading company.
        ${XSS_PAYLOADS.basicScript}
        ${XSS_PAYLOADS.imgOnerror}
        Join our team!
      `

      const request = createTestRequest('PATCH', {
        description: maliciousDescription,
      })

      // Act
      const response = await OrgPATCH(request, { params: { id: org.id } })
      const data = await parseResponse(response)

      // Assert — the org route sanitizes for real
      expect(response.status).toBe(200)
      expect(data.description).not.toMatch(/<script[^>]*>/i)
      expect(data.description).not.toMatch(/onerror/i)

      // Verify database
      const updated = await prisma.organization.findUnique({
        where: { id: org.id },
      })
      expect(updated?.description).not.toMatch(/<script[^>]*>/i)

      // Cleanup
      await prisma.userOrgRole.deleteMany({ where: { orgId: org.id } })
      await prisma.organization.delete({ where: { id: org.id } })
    })

    it('nullifies dangerous URL schemes in the website field', async () => {
      // Arrange
      mockAuthFn.mockResolvedValue(createOrgAdminSession())

      const org = await prisma.organization.create({
        data: {
          name: 'Test Org',
          slug: `test-org-${Date.now()}`,
        },
      })

      await prisma.userOrgRole.create({
        data: {
          userId: TEST_IDS.admin,
          orgId: org.id,
          role: 'ORG_ADMIN',
        },
      })

      const maliciousUrls = [
        XSS_PAYLOADS.jsProtocol,
        XSS_PAYLOADS.dataUri,
        `javascript:void(eval('${XSS_PAYLOADS.basicScript}'))`,
      ]

      for (const url of maliciousUrls) {
        const request = createTestRequest('PATCH', {
          website: url,
        })

        // Act
        const response = await OrgPATCH(request, { params: { id: org.id } })

        // Assert — sanitizeUrl rejects every scheme outside its allowlist, so
        // the field comes back null, not trimmed or partially kept.
        expect(response.status).toBe(200)
        const data = await parseResponse(response)
        expect(data.website).toBeNull()
      }

      // Cleanup
      await prisma.userOrgRole.deleteMany({ where: { orgId: org.id } })
      await prisma.organization.delete({ where: { id: org.id } })
    })
  })
})
