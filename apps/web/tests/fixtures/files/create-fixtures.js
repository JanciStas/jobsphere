/**
 * Regenerates the CV fixtures used by tests/e2e/cv-upload.spec.ts.
 *
 *   node apps/web/tests/fixtures/files/create-fixtures.js
 *
 * Why this script was rewritten
 * -----------------------------
 * The previous version hand-assembled a PDF with hard-coded xref offsets and a
 * DOCX that was never a real zip. Both committed fixtures were unparseable:
 *   sample-cv.pdf  -> pdf-parse: "bad XRef entry"
 *   sample-cv.docx -> mammoth:   "Corrupted zip: can't find end of central directory"
 * So every cv-upload assertion about extracted text was failing because of the
 * fixture, not the application. Hand-rolling a PDF that pdf-parse's bundled
 * pdf.js v1.10.100 accepts turned out to be more trouble than it is worth, so
 * the PDFs are now printed by Chromium (already installed for Playwright) and
 * the DOCX is built as a real OOXML zip with jszip. Neither is a new dependency.
 *
 * The generated files are committed; re-run this only if you change the content
 * below.
 */

const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')
const JSZip = require('jszip')

const outputDir = __dirname

const JOHN_DOE_CV = `
  <h1>John Doe</h1>
  <p>Senior Software Engineer</p>
  <p>john.doe@example.com</p>
  <p>+421 900 123 456</p>
  <p>Bratislava, Slovakia</p>
  <h2>Experience</h2>
  <p>Senior Software Engineer, Acme Corp (2020 - present).
     Built and operated distributed services in TypeScript and Go.</p>
  <p>Software Engineer, Globex (2017 - 2020).
     Developed customer facing web applications with React.</p>
  <h2>Education</h2>
  <p>MSc Computer Science, Slovak University of Technology, 2017</p>
  <h2>Skills</h2>
  <p>TypeScript, React, Node.js, PostgreSQL, Docker, Kubernetes</p>
`

// A page whose only text is one short word. pdf-parse reads it fine but returns
// well under the parser pipeline's 50-character threshold, which is what drives
// the OCR / metadata-fallback branch. (A genuinely text-free Chromium PDF comes
// out so small that pdf-parse's bundled pdf.js v1.10 rejects its xref outright,
// which would exercise the corrupted-file branch instead of the one we want.)
const SCANNED_PAGE = `
  <p>Scan</p>
`

const JANE_SMITH_CV = [
  'Jane Smith',
  'Product Designer',
  'jane.smith@example.com',
  '+421 911 654 321',
  'Kosice, Slovakia',
  '',
  'EXPERIENCE',
  'Lead Product Designer, Initech (2019 - present)',
  'Owned the end to end design system for a B2B SaaS product.',
  'Product Designer, Umbrella (2016 - 2019)',
  'Ran user research and shipped design work for mobile apps.',
  '',
  'EDUCATION',
  'BA Visual Communication, Technical University of Kosice, 2016',
  '',
  'SKILLS',
  'Figma, design systems, user research, prototyping, accessibility',
]

/** Print an HTML snippet to a real PDF using headless Chromium. */
async function buildPdf(browser, html) {
  const page = await browser.newPage()
  await page.setContent(`<body style="font-family: Helvetica, Arial, sans-serif">${html}</body>`)
  const buffer = await page.pdf({ format: 'A4', printBackground: true })
  await page.close()
  return buffer
}

/** Build a real OOXML .docx containing `lines` as paragraphs. */
async function buildDocx(lines) {
  const zip = new JSZip()

  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
  )

  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
  )

  const paragraphs = lines
    .map((line) => {
      const escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      return `<w:p><w:r><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`
    })
    .join('')

  zip.file(
    'word/document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body>${paragraphs}<w:sectPr/></w:body></w:document>`,
  )

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

async function main() {
  const browser = await chromium.launch()
  try {
    const samplePdf = await buildPdf(browser, JOHN_DOE_CV)
    fs.writeFileSync(path.join(outputDir, 'sample-cv.pdf'), samplePdf)

    const scannedPdf = await buildPdf(browser, SCANNED_PAGE)
    fs.writeFileSync(path.join(outputDir, 'scanned-cv.pdf'), scannedPdf)

    const sampleDocx = await buildDocx(JANE_SMITH_CV)
    fs.writeFileSync(path.join(outputDir, 'sample-cv.docx'), sampleDocx)

    console.log('sample-cv.pdf ', samplePdf.length, 'bytes')
    console.log('scanned-cv.pdf', scannedPdf.length, 'bytes')
    console.log('sample-cv.docx', sampleDocx.length, 'bytes')
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
