/**
 * E2E Tests - CV Upload Functionality
 *
 * Tests the multi-stage CV parsing pipeline including:
 * - File upload and validation
 * - PDF/DOCX text extraction
 * - OCR / metadata fallback for scanned documents
 * - Security checks (file size, MIME type, macros, antivirus)
 *
 * Three things about the real endpoint shape this file:
 *
 * 1. POST /api/cv/upload is wrapped in `withCsrfProtection`, which accepts a
 *    request only if it carries a same-origin `Origin`/`Referer` (or a
 *    `Sec-Fetch-Site` of same-origin/same-site). Playwright's APIRequestContext
 *    sends none of those by default, so every request here used to come back
 *    403 `CSRF_TOKEN_INVALID`. The `extraHTTPHeaders` below is what a browser
 *    would have sent anyway.
 *
 * 2. The route is rate limited with the `upload` preset — 10 requests per 5
 *    minutes — and anonymous callers are bucketed BY CLIENT IP, so every test in
 *    this file draws on ONE shared budget. The server runs NODE_ENV=production,
 *    where `DISABLE_RATE_LIMIT` is deliberately ignored (SEC-011), so the budget
 *    cannot be lifted for tests. This file therefore runs serially and is kept
 *    to 9 uploads; assertions that used to have their own upload were folded
 *    into the test that already uploads that fixture. Adding another upload here
 *    will start costing a different test a 429.
 *
 * 3. The e2e environment must run with STORAGE_PROVIDER=local and
 *    ENABLE_ANTIVIRUS=false. Otherwise `uploadCV` tries Vercel Blob without a
 *    token (500) and `securityCheck` fails closed on an unreachable ClamAV
 *    (400 `file_malware_detected` / ANTIVIRUS_UNAVAILABLE) — neither of which
 *    says anything about the code under test.
 */

import { test, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'

const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:3000'

// Satisfies the route's same-origin CSRF check (see note 1 above).
test.use({ extraHTTPHeaders: { Origin: BASE_URL } })

// One shared rate-limit bucket means order matters (see note 2 above).
test.describe.configure({ mode: 'serial' })

// Path to test fixtures
const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'files')

// Helper to get fixture file path
function getFixturePath(filename: string): string {
  return path.join(FIXTURES_DIR, filename)
}

// Helper to create a file buffer from fixture
function getFixtureBuffer(filename: string): Buffer {
  const filePath = getFixturePath(filename)
  return fs.readFileSync(filePath)
}

// Helper to create a large file for size limit testing
function createLargeFile(): Buffer {
  // Create > 10MB file
  const size = 11 * 1024 * 1024 // 11MB
  return Buffer.alloc(size, 'a')
}

const PDF_MIME = 'application/pdf'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

test.describe('CV Upload - File Type Validation', () => {
  test('should successfully upload and parse PDF file', async ({ request }) => {
    const file = getFixtureBuffer('sample-cv.pdf')

    const response = await request.post('/api/cv/upload', {
      multipart: {
        file: { name: 'sample-cv.pdf', mimeType: PDF_MIME, buffer: file },
      },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()

    // Response shape. `blobUrl` keeps its name for backward compatibility but is
    // whatever the configured storage provider returned — under
    // STORAGE_PROVIDER=local that is a site-relative /uploads/... path, not an
    // absolute https:// URL.
    expect(data).toMatchObject({
      blobUrl: expect.any(String),
      rawText: expect.any(String),
      filename: 'sample-cv.pdf',
      size: expect.any(Number),
      extractedLength: expect.any(Number),
      parseMethod: 'node_pdf',
      confidence: expect.any(Number),
      traceId: expect.stringMatching(/^[a-f0-9-]{36}$/),
    })
    expect(data.blobUrl).toMatch(/cvs\/anonymous\//i)

    // Text actually came out of the PDF.
    expect(data.rawText).toContain('John Doe')
    expect(data.rawText).toContain('john.doe@example.com')
    expect(data.extractedLength).toBeGreaterThan(50)

    // Standard PDF -> high confidence.
    expect(data.confidence).toBeGreaterThanOrEqual(0.9)
    expect(data.confidence).toBeLessThanOrEqual(1)
    expect(data.size).toBeGreaterThan(0)
  })

  test('should successfully upload and parse DOCX file', async ({ request }) => {
    const file = getFixtureBuffer('sample-cv.docx')

    const response = await request.post('/api/cv/upload', {
      multipart: {
        file: { name: 'sample-cv.docx', mimeType: DOCX_MIME, buffer: file },
      },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()

    expect(data).toHaveProperty('blobUrl')
    expect(data).toHaveProperty('filename', 'sample-cv.docx')
    expect(data.parseMethod).toBe('node_docx')

    // DOCX fixture is the Jane Smith CV.
    expect(data.rawText).toContain('Jane Smith')
    expect(data.rawText).toContain('jane.smith@example.com')
    expect(data.extractedLength).toBeGreaterThan(50)
    expect(data.confidence).toBeGreaterThanOrEqual(0.9)
  })

  test('should reject invalid file type', async ({ request }) => {
    // Create a fake executable file
    const file = Buffer.from('fake executable content')

    const response = await request.post('/api/cv/upload', {
      multipart: {
        file: {
          name: 'malware.exe',
          mimeType: 'application/x-msdownload',
          buffer: file,
        },
      },
    })

    expect(response.status()).toBe(400)
    const data = await response.json()

    expect(data).toHaveProperty('error')
    expect(data).toHaveProperty('code', 'file_invalid_type')
    expect(data.error).toMatch(/invalid file type/i)
  })

  test('should reject when no file provided', async ({ request }) => {
    // multipart with a non-"file" field: the route reads formData().get('file'),
    // so this exercises the missing-file branch with a well-formed body.
    const response = await request.post('/api/cv/upload', {
      multipart: { notAFile: 'x' },
    })

    expect(response.status()).toBe(400)
    const data = await response.json()

    expect(data).toHaveProperty('error', 'No file provided')
  })
})

test.describe('CV Upload - Security Checks', () => {
  test('should reject file larger than 10MB with a helpful message', async ({ request }) => {
    const largeFile = createLargeFile()

    const response = await request.post('/api/cv/upload', {
      multipart: {
        file: { name: 'large-cv.pdf', mimeType: PDF_MIME, buffer: largeFile },
      },
    })

    expect(response.status()).toBe(400)
    const data = await response.json()

    expect(data).toHaveProperty('code', 'file_too_large')
    // The message names both the actual size and the limit, e.g.
    // "File size 11534336 bytes exceeds maximum 10485760 bytes".
    expect(data.error).toMatch(/exceeds maximum/i)
    expect(data.error).toMatch(/10485760/)
    // Descriptive prose, not a bare code.
    expect(data.error.length).toBeGreaterThan(10)
  })

  // The repo has no macro-bearing DOCX. `sample-cv.docx` is a plain document, so
  // this test uploaded a clean file and asserted nothing unless it happened to be
  // rejected — it could never detect a macro-detection regression. Restore it by
  // committing a fixture whose zip contains word/vbaProject.bin.
  test('should reject DOCX with macros', async () => {
    test.skip(
      true,
      'No macro-bearing DOCX fixture in the repo: sample-cv.docx is a plain document, so this test uploaded a clean file and could never detect a macro-detection regression. Restore by committing a .docx whose zip contains word/vbaProject.bin.',
    )
  })

  test('should detect MIME type spoofing', async ({ request }) => {
    // Create a text file but claim it's a PDF
    const textFile = Buffer.from('This is plain text, not a PDF')

    const response = await request.post('/api/cv/upload', {
      multipart: {
        file: { name: 'fake.pdf', mimeType: PDF_MIME, buffer: textFile },
      },
    })

    // Should either reject (MIME mismatch) or parse with fallback
    const data = await response.json()

    if (!response.ok()) {
      // Real codes raised by securityCheck / the parser pipeline. The route has
      // no `file_mime_mismatch` — the MIME guard reports `mime_type_mismatch`.
      expect(['mime_type_mismatch', 'file_corrupted', 'file_empty']).toContain(data.code)
    }
  })
})

test.describe('CV Upload - OCR / metadata fallback', () => {
  test('should fall back for a scanned PDF with minimal text', async ({ request }) => {
    const file = getFixtureBuffer('scanned-cv.pdf')

    const response = await request.post('/api/cv/upload', {
      multipart: {
        file: { name: 'scanned-cv.pdf', mimeType: PDF_MIME, buffer: file },
      },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()

    // With ENABLE_OCR off (the e2e default) the pipeline lands on the metadata
    // fallback; with a Tesseract service reachable it would land on OCR.
    expect(['ocr_tesseract', 'metadata_fallback']).toContain(data.parseMethod)

    if (data.parseMethod === 'ocr_tesseract') {
      expect(data.confidence).toBeLessThan(0.9)
      expect(data.confidence).toBeGreaterThanOrEqual(0.7)
    }

    if (data.parseMethod === 'metadata_fallback') {
      expect(data.confidence).toBe(0)
      // The pipeline reports the post-OCR code here, not the bare `file_no_text`
      // the node stage raises.
      expect(data.warning).toMatchObject({
        code: 'file_no_text_after_ocr',
        message: expect.any(String),
      })
      // Metadata is still returned so the user gets something to edit.
      expect(data.rawText).toContain('Filename: scanned-cv')
    }
  })

  test('should gracefully handle empty PDF', async ({ request }) => {
    // Create minimal empty PDF
    const emptyPdf = Buffer.from(`%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj
2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj
3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
/Contents 4 0 R
>>
endobj
4 0 obj
<<
/Length 0
>>
stream
endstream
endobj
xref
0 5
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000236 00000 n
trailer
<<
/Size 5
/Root 1 0 R
>>
startxref
286
%%EOF
`)

    const response = await request.post('/api/cv/upload', {
      multipart: {
        file: { name: 'empty.pdf', mimeType: PDF_MIME, buffer: emptyPdf },
      },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()

    // Should fall back to metadata extraction
    expect(data.parseMethod).toBe('metadata_fallback')
    expect(data.confidence).toBe(0)
    expect(data).toHaveProperty('warning')
    expect(data.warning?.code).toMatch(/^file_no_text/)

    // Should still provide metadata
    expect(data.rawText).toContain('Filename: empty')
  })
})

test.describe('CV Upload - Error Handling', () => {
  test('should handle corrupted PDF gracefully', async ({ request }) => {
    const corruptedPdf = Buffer.from('This is not a valid PDF file content')

    const response = await request.post('/api/cv/upload', {
      multipart: {
        file: { name: 'corrupted.pdf', mimeType: PDF_MIME, buffer: corruptedPdf },
      },
    })

    // Should return error or fall back to metadata
    const data = await response.json()

    if (!response.ok()) {
      expect(data).toHaveProperty('error')
      expect(['file_corrupted', 'mime_type_mismatch', 'file_empty']).toContain(data.code)
    } else {
      expect(data.parseMethod).toBe('metadata_fallback')
      expect(data.confidence).toBe(0)
      // Every response carries a trace id for debugging.
      expect(data.traceId).toMatch(/^[a-f0-9-]{36}$/)
    }
  })
})

test.describe('CV Upload - Rate Limiting', () => {
  // Verifying the 10-per-5-minutes `upload` budget means deliberately exhausting
  // it, and because anonymous callers share one bucket per client IP that would
  // starve every other test in this file (and any other spec that uploads) for
  // the rest of the window. The endpoint's rate limiting is covered at the unit
  // level instead; re-enable this only if the e2e run gets its own origin IP or
  // a per-test bucket.
  test('should enforce rate limits on uploads', async () => {
    test.skip(
      true,
      'Exhausting the upload budget (10 per 5 min, bucketed per client IP for anonymous callers) starves every other upload test in the run, and NODE_ENV=production deliberately ignores DISABLE_RATE_LIMIT. Needs a per-test bucket or its own origin IP.',
    )
  })
})
