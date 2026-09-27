import { describe, it, expect, beforeEach, vi } from 'vitest'
import { POST, GET } from '@/app/api/applications/route'
import { auth } from '@/lib/auth'
import { createTestRequest, createCandidateSession, parseResponse } from '../../helpers/api-client'
import {
  prisma,
  TEST_IDS,
  createTestJob,
  createTestCandidateWithContact,
  cleanupDynamicData,
} from '../../helpers/test-db'
import { getOrCreateCandidateForUser } from '@/lib/identity'

/**
 * Integration tests for POST /api/applications
 * Tests job application submission with real database
 */

// Mock NextAuth
// Partial mock. lib/errors.ts reaches UnauthorizedError through @/lib/auth, so
// replacing the module wholesale makes handleApiError throw while handling an
// error — which is every validation and auth path in these files.
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  auth: vi.fn(),
}))

// Mock email functionality to avoid sending real emails
vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn().mockResolvedValue(true),
  getApplicationReceivedEmail: vi.fn().mockReturnValue('<p>Application received</p>'),
  getNewApplicationEmail: vi.fn().mockReturnValue('<p>New application</p>'),
}))

describe('POST /api/applications', () => {
  let testJob: any
  // A *User* id. It is deliberately not called candidateId any more: this suite
  // used it as an Application.candidateId, but Candidate is an org-scoped record
  // with its own id and the route resolves it via getOrCreateCandidateForUser.
  // Passing the user id straight through produced rows that violated
  // Application_candidateId_fkey, and the response assertions compared a Candidate
  // id against a User id.
  const applicantUserId = TEST_IDS.candidate

  /** The org-scoped Candidate the route resolves for the signed-in applicant. */
  async function resolvedCandidateId(): Promise<string> {
    const candidate = await prisma.candidate.findFirst({
      where: { userId: applicantUserId, orgId: TEST_IDS.org, deletedAt: null },
      select: { id: true },
    })
    expect(candidate).not.toBeNull()
    return candidate!.id
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    await cleanupDynamicData()

    // Create a test job for applications
    testJob = await createTestJob({
      title: 'Software Engineer Position',
      description:
        'Looking for a talented software engineer with 3+ years of experience in web development.',
      status: 'PUBLISHED',
    })
  })

  describe('Authentication', () => {
    it('should reject unauthenticated requests', async () => {
      // Arrange
      vi.mocked(auth).mockResolvedValue(null)

      const request = createTestRequest('POST', {
        jobId: testJob.id,
        coverLetter: 'I am very interested in this position.',
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(401)
      expect(data.error).toContain('Unauthorized')

      // Verify no application was created
      const applications = await prisma.application.findMany({
        where: { jobId: testJob.id },
      })
      expect(applications).toHaveLength(0)
    })

    it('should allow authenticated candidate to apply', async () => {
      // Arrange
      vi.mocked(auth).mockResolvedValue(
        createCandidateSession({
          id: applicantUserId,
          email: 'candidate@test.com',
        }),
      )

      const request = createTestRequest('POST', {
        jobId: testJob.id,
        coverLetter:
          'I am excited about this opportunity and believe my skills align well with the requirements.',
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(201)
      expect(data.jobId).toBe(testJob.id)

      // candidateId is a Candidate id scoped to the JOB's organisation, not the
      // applicant's User id, and the Candidate is linked back to the user.
      expect(data.candidateId).not.toBe(applicantUserId)
      const candidate = await prisma.candidate.findUnique({
        where: { id: data.candidateId },
      })
      expect(candidate?.userId).toBe(applicantUserId)
      expect(candidate?.orgId).toBe(testJob.orgId)
    })
  })

  describe('Validation', () => {
    beforeEach(() => {
      vi.mocked(auth).mockResolvedValue(
        createCandidateSession({
          id: applicantUserId,
        }),
      )
    })

    it('should reject application without jobId', async () => {
      // Arrange
      const request = createTestRequest('POST', {
        // jobId missing
        coverLetter: 'I am interested in this position.',
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert — the route answers a failed safeParse with a fixed `error` and the
      // per-field detail in `details` (Zod fieldErrors); it never echoes the field
      // name into `error`.
      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid application data')
      expect(data.details.jobId).toBeTruthy()
    })

    it('should reject application without cover letter', async () => {
      // Arrange
      const request = createTestRequest('POST', {
        jobId: testJob.id,
        // coverLetter missing
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid application data')
      expect(data.details.coverLetter).toBeTruthy()
    })

    it('should reject a malformed jobId before touching the database', async () => {
      // 'non-existent-job-id' is not a cuid, so it never reaches the job lookup:
      // SEC-009/010 added `jobId: z.string().cuid()` and this is rejected at
      // validation. Pinned separately from the 404 case below so a regression in
      // either is visible.
      const request = createTestRequest('POST', {
        jobId: 'non-existent-job-id',
        coverLetter: 'I am interested in this position.',
      })

      const response = await POST(request)
      const data = await parseResponse(response)

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid application data')
      expect(data.details.jobId).toBeTruthy()
    })

    it('should reject application to non-existent job', async () => {
      // Well-formed cuid that no row has.
      const request = createTestRequest('POST', {
        jobId: 'cku0000000000000000nojob',
        coverLetter: 'I am interested in this position.',
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(404)
      expect(data.error).toContain('not found')
    })

    it('should reject duplicate application to same job', async () => {
      // Arrange - create first application
      const firstRequest = createTestRequest('POST', {
        jobId: testJob.id,
        coverLetter: 'First application',
      })
      await POST(firstRequest)

      // Act - try to apply again
      const secondRequest = createTestRequest('POST', {
        jobId: testJob.id,
        coverLetter: 'Second application',
      })
      const response = await POST(secondRequest)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(409)
      expect(data.error).toContain('already applied')

      // Verify only one application exists
      const applications = await prisma.application.findMany({
        where: {
          jobId: testJob.id,
          candidateId: await resolvedCandidateId(),
        },
      })
      expect(applications).toHaveLength(1)
    })
  })

  describe('Application Creation', () => {
    beforeEach(() => {
      vi.mocked(auth).mockResolvedValue(
        createCandidateSession({
          id: applicantUserId,
          email: 'candidate@test.com',
          name: 'Test Candidate',
        }),
      )
    })

    it('should create application with all required fields', async () => {
      // Arrange — expectedSalary is a STRING on the wire (the apply form posts a
      // text input); the route parses it to the Int column.
      const request = createTestRequest('POST', {
        jobId: testJob.id,
        coverLetter:
          'I am very excited about this opportunity. My background in software development aligns perfectly with your requirements.',
        expectedSalary: '70000',
        availableFrom: '2024-02-01',
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(201)
      expect(data.id).toBeDefined()
      expect(data.jobId).toBe(testJob.id)
      expect(data.candidateId).toBe(await resolvedCandidateId())
      expect(data.orgId).toBe(TEST_IDS.org)
      expect(data.coverLetter).toBeDefined()
      expect(data.stage).toBe('NEW')

      // Verify in database
      const application = await prisma.application.findUnique({
        where: { id: data.id },
      })
      expect(application).toBeTruthy()
      expect(application?.coverLetter).toContain('excited about this opportunity')
      expect(application?.expectedSalary).toBe(70000)
      expect(application?.availableFrom?.toISOString()).toContain('2024-02-01')
    })

    it('should reject a non-string expectedSalary', async () => {
      const request = createTestRequest('POST', {
        jobId: testJob.id,
        coverLetter: 'I am interested in this position.',
        expectedSalary: 70000,
      })

      const response = await POST(request)
      const data = await parseResponse(response)

      expect(response.status).toBe(400)
      expect(data.details.expectedSalary).toBeTruthy()
    })

    it('should set default stage to NEW', async () => {
      // Arrange
      const request = createTestRequest('POST', {
        jobId: testJob.id,
        coverLetter: 'I am interested in this position.',
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(201)

      const application = await prisma.application.findUnique({
        where: { id: data.id },
      })
      expect(application?.stage).toBe('NEW')
    })

    it('should associate application with correct organization', async () => {
      // Arrange
      const request = createTestRequest('POST', {
        jobId: testJob.id,
        coverLetter: 'I am interested in this position.',
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(201)
      expect(data.orgId).toBe(TEST_IDS.org)

      const application = await prisma.application.findUnique({
        where: { id: data.id },
      })
      expect(application?.orgId).toBe(testJob.orgId)
    })

    it('should include job details in response', async () => {
      // Arrange
      const request = createTestRequest('POST', {
        jobId: testJob.id,
        coverLetter: 'I am interested in this position.',
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(201)
      expect(data.job).toBeDefined()
      expect(data.job.id).toBe(testJob.id)
      expect(data.job.title).toBe('Software Engineer Position')
      expect(data.job.organization).toBeDefined()
    })

    it('should create application activity record', async () => {
      // Arrange
      const request = createTestRequest('POST', {
        jobId: testJob.id,
        coverLetter: 'I am interested in this position.',
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(201)

      const activity = await prisma.applicationActivity.findFirst({
        where: { applicationId: data.id },
      })
      expect(activity).toBeTruthy()
      expect(activity?.type).toBe('APPLIED')
      expect(activity?.description).toContain('successfully submitted')
      expect(activity?.performedBy).toBe(applicantUserId)
    })
  })

  describe('Email Notifications', () => {
    beforeEach(() => {
      vi.mocked(auth).mockResolvedValue(
        createCandidateSession({
          id: applicantUserId,
          email: 'candidate@test.com',
          name: 'Test Candidate',
        }),
      )
    })

    it('should send email to candidate upon successful application', async () => {
      // Arrange
      const { sendEmail, getApplicationReceivedEmail } = await import('@/lib/email')

      const request = createTestRequest('POST', {
        jobId: testJob.id,
        coverLetter: 'I am interested in this position.',
      })

      // Act
      const response = await POST(request)

      // Assert
      expect(response.status).toBe(201)
      expect(sendEmail).toHaveBeenCalled()
      expect(getApplicationReceivedEmail).toHaveBeenCalledWith(
        'Test Candidate',
        expect.any(String),
        expect.any(String),
      )
    })

    it('should send email to employer about new application', async () => {
      // Arrange
      const { sendEmail, getNewApplicationEmail } = await import('@/lib/email')

      const request = createTestRequest('POST', {
        jobId: testJob.id,
        coverLetter: 'I am interested in this position.',
      })

      // Act
      const response = await POST(request)

      // Assert
      expect(response.status).toBe(201)
      expect(sendEmail).toHaveBeenCalled()
      expect(getNewApplicationEmail).toHaveBeenCalled()
    })

    it('should not fail application if email sending fails', async () => {
      // Arrange
      const { sendEmail } = await import('@/lib/email')
      vi.mocked(sendEmail).mockRejectedValueOnce(new Error('Email service down'))

      const request = createTestRequest('POST', {
        jobId: testJob.id,
        coverLetter: 'I am interested in this position.',
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert - application should still succeed
      expect(response.status).toBe(201)
      expect(data.id).toBeDefined()

      // Verify application was created despite email failure
      const application = await prisma.application.findUnique({
        where: { id: data.id },
      })
      expect(application).toBeTruthy()
    })
  })

  describe('GET /api/applications', () => {
    let candidateApp1: any
    let candidateApp2: any
    let myCandidateId: string

    beforeEach(async () => {
      vi.mocked(auth).mockResolvedValue(
        createCandidateSession({
          id: applicantUserId,
        }),
      )

      // These rows used to be written with candidateId = the User id, which is
      // not a Candidate and blew up on Application_candidateId_fkey. Resolve the
      // same org-scoped Candidate the route would — that also gives it the
      // primary CandidateContact the GET handler matches the session email on.
      const myCandidate = await getOrCreateCandidateForUser(applicantUserId, TEST_IDS.org)
      myCandidateId = myCandidate.id

      // Create test applications
      const job1 = await createTestJob({ title: 'Job 1' })
      const job2 = await createTestJob({ title: 'Job 2' })

      candidateApp1 = await prisma.application.create({
        data: {
          jobId: job1.id,
          candidateId: myCandidateId,
          orgId: TEST_IDS.org,
          coverLetter: 'Application 1',
          stage: 'NEW',
        },
      })

      candidateApp2 = await prisma.application.create({
        data: {
          jobId: job2.id,
          candidateId: myCandidateId,
          orgId: TEST_IDS.org,
          coverLetter: 'Application 2',
          // 'INTERVIEW', not 'INTERVIEWING': APPLICATION_STAGES is
          // NEW | SCREENING | INTERVIEW | HIRED | REJECTED, and the route parses
          // ?stage= against exactly that enum.
          stage: 'INTERVIEW',
        },
      })
    })

    it('should return all applications for authenticated candidate', async () => {
      // Arrange
      const request = createTestRequest(
        'GET',
        undefined,
        undefined,
        'http://localhost:3000/api/applications',
      )

      // Act
      const response = await GET(request)
      const data = await parseResponse(response)

      // Assert — GET returns a page envelope, not a bare array.
      expect(response.status).toBe(200)
      expect(Array.isArray(data.data)).toBe(true)
      expect(data.page).toBe(1)
      expect(data.pageSize).toBe(20)
      expect(data.total).toBeGreaterThanOrEqual(2)
      expect(data.hasMore).toBe(false)
      expect(data.data.length).toBeGreaterThanOrEqual(2)

      const appIds = data.data.map((app: any) => app.id)
      expect(appIds).toContain(candidateApp1.id)
      expect(appIds).toContain(candidateApp2.id)
    })

    it('should filter applications by stage', async () => {
      // Arrange
      const request = createTestRequest(
        'GET',
        undefined,
        undefined,
        'http://localhost:3000/api/applications?stage=INTERVIEW',
      )

      // Act
      const response = await GET(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(200)
      expect(Array.isArray(data.data)).toBe(true)

      const interviewingApps = data.data.filter((app: any) => app.stage === 'INTERVIEW')
      expect(interviewingApps.length).toBeGreaterThan(0)
      expect(data.data.every((app: any) => app.stage === 'INTERVIEW')).toBe(true)
    })

    it('rejects an unknown stage with 400, not 500', async () => {
      const request = createTestRequest(
        'GET',
        undefined,
        undefined,
        'http://localhost:3000/api/applications?stage=INTERVIEWING',
      )

      const response = await GET(request)
      const data = await parseResponse(response)

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid query parameters')
    })

    it('should filter applications by jobId', async () => {
      // Arrange
      const job = await createTestJob({ title: 'Specific Job' })
      await prisma.application.create({
        data: {
          jobId: job.id,
          candidateId: myCandidateId,
          orgId: TEST_IDS.org,
          coverLetter: 'Specific application',
          stage: 'NEW',
        },
      })

      const request = createTestRequest(
        'GET',
        undefined,
        undefined,
        `http://localhost:3000/api/applications?jobId=${job.id}`,
      )

      // Act
      const response = await GET(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(200)
      expect(Array.isArray(data.data)).toBe(true)
      expect(data.data.length).toBe(1)
      expect(data.data.every((app: any) => app.jobId === job.id)).toBe(true)
    })

    it('should include job and organization details', async () => {
      // Arrange
      const request = createTestRequest(
        'GET',
        undefined,
        undefined,
        'http://localhost:3000/api/applications',
      )

      // Act
      const response = await GET(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(200)
      expect(data.data.length).toBeGreaterThan(0)

      const firstApp = data.data[0]
      expect(firstApp.job).toBeDefined()
      expect(firstApp.job.title).toBeDefined()
      expect(firstApp.job.organization).toBeDefined()
      expect(firstApp.job.organization.name).toBeDefined()
      // The list view selects explicitly and drops the heavy columns.
      expect(firstApp.job.description).toBeUndefined()
      expect(firstApp.coverLetter).toBeUndefined()
    })

    it('should order applications by most recent first', async () => {
      // Arrange
      const request = createTestRequest(
        'GET',
        undefined,
        undefined,
        'http://localhost:3000/api/applications',
      )

      // Act
      const response = await GET(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(200)
      expect(data.data.length).toBeGreaterThan(1)

      // Check that dates are in descending order
      for (let i = 0; i < data.data.length - 1; i++) {
        const current = new Date(data.data[i].createdAt)
        const next = new Date(data.data[i + 1].createdAt)
        expect(current.getTime()).toBeGreaterThanOrEqual(next.getTime())
      }
    })

    it('should only return applications for authenticated user', async () => {
      // Arrange - another person's candidate record IN THE SAME ORG, with a
      // different primary contact email (that email is what the handler matches on).
      const { candidate: otherCandidate } = await createTestCandidateWithContact({
        email: 'other-candidate@test.com',
        fullName: 'Other Candidate',
      })

      const otherJob = await createTestJob()
      await prisma.application.create({
        data: {
          jobId: otherJob.id,
          candidateId: otherCandidate.id,
          orgId: TEST_IDS.org,
          coverLetter: 'Other application',
          stage: 'NEW',
        },
      })

      const request = createTestRequest(
        'GET',
        undefined,
        undefined,
        'http://localhost:3000/api/applications',
      )

      // Act
      const response = await GET(request)
      const data = await parseResponse(response)

      // Assert — tenant/identity boundary: only the caller's own candidate rows.
      expect(response.status).toBe(200)
      expect(data.data.length).toBeGreaterThan(0)
      expect(data.data.every((app: any) => app.candidateId === myCandidateId)).toBe(true)
      expect(data.data.some((app: any) => app.candidateId === otherCandidate.id)).toBe(false)
    })

    it('should reject unauthenticated GET requests', async () => {
      // Arrange
      vi.mocked(auth).mockResolvedValue(null)

      const request = createTestRequest(
        'GET',
        undefined,
        undefined,
        'http://localhost:3000/api/applications',
      )

      // Act
      const response = await GET(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(401)
      expect(data.error).toContain('Unauthorized')
    })
  })

  describe('Edge Cases', () => {
    beforeEach(() => {
      vi.mocked(auth).mockResolvedValue(
        createCandidateSession({
          id: applicantUserId,
          email: 'candidate@test.com',
        }),
      )
    })

    it('should handle very long cover letters', async () => {
      // Arrange
      const longCoverLetter = 'A'.repeat(5000) // 5000 character cover letter

      const request = createTestRequest('POST', {
        jobId: testJob.id,
        coverLetter: longCoverLetter,
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(201)

      const application = await prisma.application.findUnique({
        where: { id: data.id },
      })
      expect(application?.coverLetter?.length).toBe(5000)
    })

    it('should handle special characters in cover letter', async () => {
      // Arrange
      const specialCharsCoverLetter =
        'I love coding! 🚀 My skills include: C++, C#, & Node.js. Email: test@example.com'

      const request = createTestRequest('POST', {
        jobId: testJob.id,
        coverLetter: specialCharsCoverLetter,
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(201)

      const application = await prisma.application.findUnique({
        where: { id: data.id },
      })
      expect(application?.coverLetter).toBe(specialCharsCoverLetter)
    })

    it('should handle application when user has no email', async () => {
      // Arrange
      vi.mocked(auth).mockResolvedValue(
        createCandidateSession({
          id: applicantUserId,
          email: undefined, // No email
        }),
      )

      const request = createTestRequest('POST', {
        jobId: testJob.id,
        coverLetter: 'I am interested in this position.',
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert - application should still be created
      expect(response.status).toBe(201)
      expect(data.id).toBeDefined()
    })
  })
})
