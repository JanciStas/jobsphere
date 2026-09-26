/**
 * CV Auto-Fill Integration Tests
 * Tests the full CV parsing pipeline with AI extraction and form auto-fill
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseCV } from '@/lib/cv-parser-pipeline'
import { extractCvFromText } from '@jobsphere/ai'
import type { ExtractedCV } from '@jobsphere/ai'

// Mock the AI package
vi.mock('@jobsphere/ai', () => ({
  extractCvFromText: vi.fn(),
  CVErrors: {
    corrupted: (msg: string) => ({ code: 'FILE_CORRUPTED', message: msg }),
    hasMacros: () => ({ code: 'FILE_HAS_MACROS', message: 'File contains macros' }),
  },
  CVParseException: class CVParseException extends Error {
    constructor(public error: { code: string; message: string }) {
      super(error.message)
    }
  },
  CVParseErrorCode: {
    FILE_NO_TEXT: 'FILE_NO_TEXT',
    FILE_CORRUPTED: 'FILE_CORRUPTED',
    FILE_HAS_MACROS: 'FILE_HAS_MACROS',
  },
}))

// Mock pdf-parse
vi.mock('pdf-parse', () => ({
  default: vi.fn(),
}))

// Mock mammoth
vi.mock('mammoth', () => ({
  extractRawText: vi.fn(),
}))

// Mock jszip
vi.mock('jszip', () => ({
  default: {
    loadAsync: vi.fn(),
  },
}))

// Mock OCR client
vi.mock('@/lib/ocr-client', () => ({
  callPythonOCR: vi.fn(),
}))

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

describe('CV Auto-Fill Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('End-to-End CV Parsing and AI Extraction', () => {
    it('should parse PDF and extract structured CV data for form auto-fill', async () => {
      // 1. Mock PDF parsing
      const mockBuffer = new ArrayBuffer(500)
      const mockCVText = `
        John Doe
        Email: john.doe@example.com
        Phone: +1-555-0123
        Location: San Francisco, CA

        EXPERIENCE
        Senior Software Engineer at Tech Corp (2020-Present)
        - Led team of 5 developers
        - Built scalable microservices
        - Technologies: TypeScript, React, Node.js

        Software Engineer at StartupXYZ (2018-2020)
        - Full-stack development
        - Technologies: Python, Django, PostgreSQL

        EDUCATION
        B.S. Computer Science
        Stanford University (2014-2018)
        GPA: 3.8

        SKILLS
        TypeScript, React, Node.js, Python, Docker, AWS
      `

      const pdfParse = await import('pdf-parse')
      vi.mocked(pdfParse.default).mockResolvedValueOnce({
        text: mockCVText,
        numpages: 2,
        info: {},
        metadata: null,
        version: '1.0',
      } as any)

      // 2. Parse CV text
      const parseResult = await parseCV(mockBuffer, {
        filename: 'john-doe-cv.pdf',
        mimeType: 'application/pdf',
        fileSize: 500,
      })

      expect(parseResult.method).toBe('node_pdf')
      expect(parseResult.text).toContain('John Doe')
      expect(parseResult.extractedLength).toBeGreaterThan(100)

      // 3. Mock AI extraction
      const mockExtractedCV: ExtractedCV = {
        personal: {
          fullName: 'John Doe',
          email: 'john.doe@example.com',
          phone: '+1-555-0123',
          location: 'San Francisco, CA',
          linkedIn: undefined,
          github: undefined,
          portfolio: undefined,
        },
        summary: 'Experienced software engineer with 6+ years in full-stack development',
        experiences: [
          {
            title: 'Senior Software Engineer',
            company: 'Tech Corp',
            location: 'San Francisco, CA',
            startDate: '2020-01',
            endDate: 'present',
            current: true,
            description: 'Led team of 5 developers, built scalable microservices',
            achievements: ['Led team of 5 developers', 'Built scalable microservices'],
            skills: ['TypeScript', 'React', 'Node.js'],
          },
          {
            title: 'Software Engineer',
            company: 'StartupXYZ',
            location: 'San Francisco, CA',
            startDate: '2018-06',
            endDate: '2020-01',
            current: false,
            description: 'Full-stack development',
            achievements: ['Full-stack development'],
            skills: ['Python', 'Django', 'PostgreSQL'],
          },
        ],
        education: [
          {
            degree: 'B.S. Computer Science',
            institution: 'Stanford University',
            location: 'Stanford, CA',
            startDate: '2014-09',
            endDate: '2018-06',
            gpa: '3.8',
            description: undefined,
          },
        ],
        skills: ['TypeScript', 'React', 'Node.js', 'Python', 'Docker', 'AWS'],
        languages: [{ name: 'English', level: 'NATIVE' }],
        certifications: [],
        projects: [],
      }

      vi.mocked(extractCvFromText).mockResolvedValueOnce(mockExtractedCV)

      // 4. Extract structured data
      const extractedData = await extractCvFromText(parseResult.text, {
        apiKey: 'test-key',
        locale: 'en',
      })

      // 5. Verify auto-fill data structure
      expect(extractedData.personal?.fullName).toBe('John Doe')
      expect(extractedData.personal?.email).toBe('john.doe@example.com')
      expect(extractedData.personal?.phone).toBe('+1-555-0123')
      expect(extractedData.personal?.location).toBe('San Francisco, CA')

      expect(extractedData.experiences).toHaveLength(2)
      expect(extractedData.experiences[0].title).toBe('Senior Software Engineer')
      expect(extractedData.experiences[0].current).toBe(true)

      expect(extractedData.education).toHaveLength(1)
      expect(extractedData.education[0].degree).toBe('B.S. Computer Science')
      expect(extractedData.education[0].gpa).toBe('3.8')

      expect(extractedData.skills).toContain('TypeScript')
      expect(extractedData.skills).toContain('React')
      expect(extractedData.skills.length).toBeGreaterThanOrEqual(5)
    })

    it('should handle CV with minimal information', async () => {
      const mockBuffer = new ArrayBuffer(200)
      const minimalCVText = 'Jane Smith\njane@example.com\nDeveloper with 2 years experience'

      const pdfParse = await import('pdf-parse')
      vi.mocked(pdfParse.default).mockResolvedValueOnce({
        text: minimalCVText,
        numpages: 1,
        info: {},
        metadata: null,
        version: '1.0',
      } as any)

      const parseResult = await parseCV(mockBuffer, {
        filename: 'minimal-cv.pdf',
        mimeType: 'application/pdf',
      })

      const mockMinimalCV: ExtractedCV = {
        personal: {
          fullName: 'Jane Smith',
          email: 'jane@example.com',
          phone: undefined,
          location: undefined,
          linkedIn: undefined,
          github: undefined,
          portfolio: undefined,
        },
        summary: 'Developer with 2 years experience',
        experiences: [],
        education: [],
        skills: [],
        languages: [],
        certifications: [],
        projects: [],
      }

      vi.mocked(extractCvFromText).mockResolvedValueOnce(mockMinimalCV)

      const extractedData = await extractCvFromText(parseResult.text, {
        apiKey: 'test-key',
        locale: 'en',
      })

      expect(extractedData.personal?.fullName).toBe('Jane Smith')
      expect(extractedData.personal?.email).toBe('jane@example.com')
      expect(extractedData.experiences).toHaveLength(0)
      expect(extractedData.education).toHaveLength(0)
    })

    it('should extract data from German CV (multi-language)', async () => {
      const mockBuffer = new ArrayBuffer(400)
      const germanCVText = `
        Max Müller
        E-Mail: max.mueller@beispiel.de
        Telefon: +49-123-456789

        BERUFSERFAHRUNG
        Softwareentwickler bei Deutsche Tech GmbH (2019-Heute)
        - Entwicklung von Webanwendungen
        - Technologien: Java, Spring, PostgreSQL

        AUSBILDUNG
        Bachelor Informatik
        Technische Universität München (2015-2019)

        FÄHIGKEITEN
        Java, Spring, PostgreSQL, Docker, Kubernetes
      `

      const pdfParse = await import('pdf-parse')
      vi.mocked(pdfParse.default).mockResolvedValueOnce({
        text: germanCVText,
        numpages: 1,
        info: {},
        metadata: null,
        version: '1.0',
      } as any)

      const parseResult = await parseCV(mockBuffer, {
        filename: 'max-mueller-lebenslauf.pdf',
        mimeType: 'application/pdf',
        locale: 'de',
      })

      const mockGermanCV: ExtractedCV = {
        personal: {
          fullName: 'Max Müller',
          email: 'max.mueller@beispiel.de',
          phone: '+49-123-456789',
          location: undefined,
          linkedIn: undefined,
          github: undefined,
          portfolio: undefined,
        },
        summary: undefined,
        experiences: [
          {
            title: 'Softwareentwickler',
            company: 'Deutsche Tech GmbH',
            location: 'München, Deutschland',
            startDate: '2019-01',
            endDate: 'present',
            current: true,
            description: 'Entwicklung von Webanwendungen',
            achievements: ['Entwicklung von Webanwendungen'],
            skills: ['Java', 'Spring', 'PostgreSQL'],
          },
        ],
        education: [
          {
            degree: 'Bachelor Informatik',
            institution: 'Technische Universität München',
            location: 'München, Deutschland',
            startDate: '2015-10',
            endDate: '2019-07',
            gpa: undefined,
            description: undefined,
          },
        ],
        skills: ['Java', 'Spring', 'PostgreSQL', 'Docker', 'Kubernetes'],
        languages: [{ name: 'Deutsch', level: 'NATIVE' }],
        certifications: [],
        projects: [],
      }

      vi.mocked(extractCvFromText).mockResolvedValueOnce(mockGermanCV)

      const extractedData = await extractCvFromText(parseResult.text, {
        apiKey: 'test-key',
        locale: 'de',
      })

      expect(extractedData.personal?.fullName).toBe('Max Müller')
      expect(extractedData.personal?.email).toContain('@beispiel.de')
      expect(extractedData.experiences[0].title).toBe('Softwareentwickler')
      expect(extractedData.skills).toContain('Java')
    })
  })

  describe('Form Auto-Fill Scenarios', () => {
    it('should provide data for application form fields', async () => {
      const mockExtractedCV: ExtractedCV = {
        personal: {
          fullName: 'Alice Johnson',
          email: 'alice.johnson@email.com',
          phone: '+1-555-9876',
          location: 'New York, NY',
          linkedIn: 'linkedin.com/in/alicejohnson',
          github: 'github.com/alicejohnson',
          portfolio: 'alicejohnson.dev',
        },
        summary: 'Full-stack developer with expertise in React and Node.js',
        experiences: [
          {
            title: 'Full Stack Developer',
            company: 'WebTech Inc',
            location: 'New York, NY',
            startDate: '2021-03',
            endDate: 'present',
            current: true,
            description: 'Building modern web applications',
            achievements: ['Built 10+ production apps'],
            skills: ['React', 'Node.js', 'MongoDB'],
          },
        ],
        education: [
          {
            degree: 'B.S. Software Engineering',
            institution: 'MIT',
            location: 'Cambridge, MA',
            startDate: '2017-09',
            endDate: '2021-06',
            gpa: '3.9',
            description: undefined,
          },
        ],
        skills: ['React', 'Node.js', 'TypeScript', 'MongoDB', 'AWS'],
        languages: [
          { name: 'English', level: 'NATIVE' },
          { name: 'Spanish', level: 'CONVERSATIONAL' },
        ],
        certifications: [
          {
            name: 'AWS Certified Developer',
            issuer: 'Amazon Web Services',
            date: '2022-08',
            credentialId: 'AWS-12345',
            url: 'aws.amazon.com/verify/12345',
          },
        ],
        projects: [
          {
            name: 'E-commerce Platform',
            description: 'Built scalable e-commerce solution',
            technologies: ['React', 'Node.js', 'Stripe'],
            url: 'github.com/alicejohnson/ecommerce',
            startDate: '2021-01',
            endDate: '2021-06',
          },
        ],
      }

      // Simulate form field mapping
      const formData = {
        // Personal information
        fullName: mockExtractedCV.personal?.fullName,
        email: mockExtractedCV.personal?.email,
        phone: mockExtractedCV.personal?.phone,
        location: mockExtractedCV.personal?.location,
        linkedIn: mockExtractedCV.personal?.linkedIn,
        github: mockExtractedCV.personal?.github,
        portfolio: mockExtractedCV.personal?.portfolio,

        // Professional summary
        coverLetter: mockExtractedCV.summary,

        // Current position
        currentPosition: mockExtractedCV.experiences[0]?.title,
        currentCompany: mockExtractedCV.experiences[0]?.company,

        // Education
        highestDegree: mockExtractedCV.education[0]?.degree,
        university: mockExtractedCV.education[0]?.institution,
        graduationYear: mockExtractedCV.education[0]?.endDate?.split('-')[0],

        // Skills
        skills: mockExtractedCV.skills.join(', '),
        yearsOfExperience: 3, // Calculated from experiences

        // Languages
        languages: mockExtractedCV.languages.map((l) => `${l.name} (${l.level})`).join(', '),
      }

      // Verify form can be auto-filled
      expect(formData.fullName).toBe('Alice Johnson')
      expect(formData.email).toBe('alice.johnson@email.com')
      expect(formData.phone).toBe('+1-555-9876')
      expect(formData.currentPosition).toBe('Full Stack Developer')
      expect(formData.currentCompany).toBe('WebTech Inc')
      expect(formData.highestDegree).toBe('B.S. Software Engineering')
      expect(formData.skills).toContain('React')
      expect(formData.skills).toContain('Node.js')
      expect(formData.languages).toContain('English')
    })

    it('should calculate years of experience from work history', async () => {
      const mockExtractedCV: ExtractedCV = {
        personal: {
          fullName: 'Bob Developer',
          email: 'bob@dev.com',
          phone: undefined,
          location: undefined,
          linkedIn: undefined,
          github: undefined,
          portfolio: undefined,
        },
        summary: undefined,
        experiences: [
          {
            title: 'Senior Developer',
            company: 'Company A',
            location: 'Remote',
            startDate: '2020-01',
            endDate: 'present',
            current: true,
            description: 'Current role',
            achievements: [],
            skills: [],
          },
          {
            title: 'Mid Developer',
            company: 'Company B',
            location: 'Remote',
            startDate: '2018-06',
            endDate: '2019-12',
            current: false,
            description: 'Previous role',
            achievements: [],
            skills: [],
          },
          {
            title: 'Junior Developer',
            company: 'Company C',
            location: 'Remote',
            startDate: '2016-01',
            endDate: '2018-05',
            current: false,
            description: 'First role',
            achievements: [],
            skills: [],
          },
        ],
        education: [],
        skills: [],
        languages: [],
        certifications: [],
        projects: [],
      }

      // Calculate total years of experience.
      //
      // ⚠️ The reference "now" is an explicit input, not the wall clock.
      //
      // This used to call `new Date()` for the `current: true` role and then assert
      // a 7–9 year band. That band was true when the test was written and drifts by
      // one year every January: measured on 2026-09-26 the three roles sum to
      // 126 months → 10 years, and `expect(10).toBeLessThanOrEqual(9)` failed with
      // no product change. See skill `clock-independent-tests`.
      //
      // The parse below reads the fixture's `YYYY-MM` strings as UTC noon and
      // compares with UTC accessors, so the result is identical on any machine
      // regardless of its timezone — a local `getMonth()` would shift a month for
      // runners west of UTC.
      //
      // Note: nothing in `src/` computes years of experience from work history —
      // `Resume.yearsOfExperience` is only ever read back. This test exercises a
      // local reimplementation, so it documents the arithmetic but guards no
      // production code.
      const monthOf = (value: string, fallback: Date) => {
        if (value === 'present') return fallback
        const [year, month] = value.split('-').map(Number)
        return new Date(Date.UTC(year, month - 1, 1, 12))
      }

      const calculateYearsOfExperience = (experiences: ExtractedCV['experiences'], now: Date) => {
        let totalMonths = 0

        experiences.forEach((exp) => {
          const start = monthOf(exp.startDate, now)
          const end = exp.current ? now : monthOf(exp.endDate, now)

          const months =
            (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
            (end.getUTCMonth() - start.getUTCMonth())

          totalMonths += months
        })

        return Math.floor(totalMonths / 12)
      }

      const NOW = new Date(Date.UTC(2026, 0, 15, 12))

      // 2020-01 → 2026-01 = 72 months
      // 2018-06 → 2019-12 = 18 months
      // 2016-01 → 2018-05 = 28 months
      // total 118 months → 9 years
      expect(calculateYearsOfExperience(mockExtractedCV.experiences, NOW)).toBe(9)

      // The same history measured a year earlier is a year shorter. This is what
      // makes the assertion above a contract rather than a snapshot of today.
      expect(
        calculateYearsOfExperience(
          mockExtractedCV.experiences,
          new Date(Date.UTC(2025, 0, 15, 12)),
        ),
      ).toBe(8)
    })

    it('should handle missing optional fields gracefully', async () => {
      const mockExtractedCV: ExtractedCV = {
        personal: {
          fullName: 'Minimal Candidate',
          email: 'minimal@example.com',
          phone: undefined, // Missing
          location: undefined, // Missing
          linkedIn: undefined,
          github: undefined,
          portfolio: undefined,
        },
        summary: undefined, // Missing
        experiences: [], // No experience
        education: [], // No education
        skills: ['JavaScript'], // Minimal skills
        languages: [],
        certifications: [],
        projects: [],
      }

      const formData = {
        fullName: mockExtractedCV.personal?.fullName || '',
        email: mockExtractedCV.personal?.email || '',
        phone: mockExtractedCV.personal?.phone || '',
        location: mockExtractedCV.personal?.location || '',
        coverLetter: mockExtractedCV.summary || '',
        currentPosition: mockExtractedCV.experiences[0]?.title || '',
        skills: mockExtractedCV.skills.join(', '),
      }

      // Verify graceful handling of missing fields
      expect(formData.fullName).toBe('Minimal Candidate')
      expect(formData.email).toBe('minimal@example.com')
      expect(formData.phone).toBe('') // Empty string, not undefined
      expect(formData.location).toBe('')
      expect(formData.coverLetter).toBe('')
      expect(formData.currentPosition).toBe('')
      expect(formData.skills).toBe('JavaScript')
    })
  })

  describe('Error Recovery and Fallbacks', () => {
    it('should handle AI extraction failure gracefully', async () => {
      const mockBuffer = new ArrayBuffer(200)
      const mockCVText = 'Some CV text'

      const pdfParse = await import('pdf-parse')
      vi.mocked(pdfParse.default).mockResolvedValueOnce({
        text: mockCVText,
        numpages: 1,
        info: {},
        metadata: null,
        version: '1.0',
      } as any)

      const parseResult = await parseCV(mockBuffer, {
        filename: 'cv.pdf',
        mimeType: 'application/pdf',
      })

      // Mock AI extraction failure
      vi.mocked(extractCvFromText).mockRejectedValueOnce(new Error('AI service unavailable'))

      await expect(
        extractCvFromText(parseResult.text, {
          apiKey: 'test-key',
          locale: 'en',
        }),
      ).rejects.toThrow('AI service unavailable')
    })

    it('should handle partial AI extraction (some fields missing)', async () => {
      const mockPartialCV: ExtractedCV = {
        personal: {
          fullName: 'Partial Data',
          email: 'partial@example.com',
          phone: undefined, // AI failed to extract
          location: undefined, // AI failed to extract
          linkedIn: undefined,
          github: undefined,
          portfolio: undefined,
        },
        summary: 'Successfully extracted summary',
        experiences: [], // AI failed to extract experiences
        education: [], // AI failed to extract education
        skills: ['React', 'Node.js'], // Partial success
        languages: [],
        certifications: [],
        projects: [],
      }

      vi.mocked(extractCvFromText).mockResolvedValueOnce(mockPartialCV)

      const extractedData = await extractCvFromText('CV text', {
        apiKey: 'test-key',
        locale: 'en',
      })

      // Verify we can still use partial data
      expect(extractedData.personal?.fullName).toBe('Partial Data')
      expect(extractedData.personal?.email).toBe('partial@example.com')
      expect(extractedData.skills).toHaveLength(2)
      expect(extractedData.experiences).toHaveLength(0) // Empty but valid
    })
  })

  describe('Real-world CV Formats', () => {
    it('should handle academic CV with publications', async () => {
      const mockAcademicCV: ExtractedCV = {
        personal: {
          fullName: 'Dr. Sarah Academic',
          email: 'sarah.academic@university.edu',
          phone: '+1-555-1111',
          location: 'Boston, MA',
          linkedIn: undefined,
          github: undefined,
          portfolio: 'scholar.google.com/sarah-academic',
        },
        summary: 'Research scientist specializing in machine learning',
        experiences: [
          {
            title: 'Research Scientist',
            company: 'MIT Media Lab',
            location: 'Cambridge, MA',
            startDate: '2019-09',
            endDate: 'present',
            current: true,
            description: 'Leading ML research projects',
            achievements: ['Published 15 papers', 'Won Best Paper Award'],
            skills: ['Machine Learning', 'Python', 'TensorFlow'],
          },
        ],
        education: [
          {
            degree: 'Ph.D. Computer Science',
            institution: 'Stanford University',
            location: 'Stanford, CA',
            startDate: '2015-09',
            endDate: '2019-06',
            gpa: '4.0',
            description: 'Dissertation: Deep Learning for NLP',
          },
          {
            degree: 'B.S. Computer Science',
            institution: 'MIT',
            location: 'Cambridge, MA',
            startDate: '2011-09',
            endDate: '2015-06',
            gpa: '3.95',
            description: undefined,
          },
        ],
        skills: ['Machine Learning', 'Python', 'TensorFlow', 'PyTorch', 'NLP'],
        languages: [{ name: 'English', level: 'NATIVE' }],
        certifications: [],
        projects: [],
      }

      expect(mockAcademicCV.personal?.fullName).toContain('Dr.')
      expect(mockAcademicCV.education).toHaveLength(2)
      expect(mockAcademicCV.education[0].degree).toContain('Ph.D.')
      expect(mockAcademicCV.experiences[0].achievements).toContain('Published 15 papers')
    })

    it('should handle freelancer CV with multiple projects', async () => {
      const mockFreelancerCV: ExtractedCV = {
        personal: {
          fullName: 'Chris Freelancer',
          email: 'chris@freelance.com',
          phone: '+1-555-2222',
          location: 'Remote',
          linkedIn: 'linkedin.com/in/chrisfreelancer',
          github: 'github.com/chrisfreelancer',
          portfolio: 'chrisfreelancer.com',
        },
        summary: 'Freelance full-stack developer with 50+ completed projects',
        experiences: [
          {
            title: 'Freelance Developer',
            company: 'Self-Employed',
            location: 'Remote',
            startDate: '2018-01',
            endDate: 'present',
            current: true,
            description: 'Building web applications for clients worldwide',
            achievements: ['50+ completed projects', '100% client satisfaction'],
            skills: ['React', 'Node.js', 'MongoDB', 'AWS'],
          },
        ],
        education: [
          {
            degree: 'B.S. Computer Science',
            institution: 'University of Texas',
            location: 'Austin, TX',
            startDate: '2014-09',
            endDate: '2018-05',
            gpa: '3.6',
            description: undefined,
          },
        ],
        skills: ['React', 'Node.js', 'MongoDB', 'AWS', 'Docker', 'Kubernetes'],
        languages: [{ name: 'English', level: 'NATIVE' }],
        certifications: [
          {
            name: 'AWS Solutions Architect',
            issuer: 'Amazon Web Services',
            date: '2020-05',
            credentialId: 'AWS-54321',
            url: undefined,
          },
        ],
        projects: [
          {
            name: 'E-commerce Platform',
            description: 'Built for online retailer',
            technologies: ['React', 'Node.js', 'Stripe'],
            url: undefined,
            startDate: '2022-01',
            endDate: '2022-06',
          },
          {
            name: 'Task Management App',
            description: 'SaaS product for teams',
            technologies: ['Vue.js', 'Firebase'],
            url: 'taskapp.com',
            startDate: '2021-06',
            endDate: '2021-12',
          },
        ],
      }

      expect(mockFreelancerCV.experiences[0].company).toBe('Self-Employed')
      expect(mockFreelancerCV.projects).toHaveLength(2)
      expect(mockFreelancerCV.certifications).toHaveLength(1)
    })
  })
})
