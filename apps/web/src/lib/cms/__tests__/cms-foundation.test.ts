import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@vercel/blob', () => ({
  put: vi.fn(async (path: string) => ({ url: `https://blob/${path}` })),
}))

import { renderMarkdown, markdownToPlainText } from '../markdown'
import { sniffImageType, storeCmsImage } from '../image-upload'
import { slugify, isSafeCmsLink, SLUG_REGEX, isCmsLocale } from '../constants'
import { isCmsTableMissing, cmsRead } from '../safe'

describe('renderMarkdown (XSS)', () => {
  it('renders basic Markdown', () => {
    const html = renderMarkdown('## Title\n\n**bold** and *it*\n\n- a\n- b')
    expect(html).toContain('<h2>Title</h2>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<li>a</li>')
  })
  it('drops raw script/iframe/event handlers', () => {
    const html = renderMarkdown(
      '<script>alert(1)</script>\n\n<img src="https://x/y.png" onerror="alert(1)">\n\n<iframe src="https://evil"></iframe>',
    )
    expect(html).not.toMatch(/<script|onerror|<iframe|alert\(1\)<\/script/i)
  })
  it('neutralises javascript: and data: links and images', () => {
    const html = renderMarkdown(
      '[x](javascript:alert(1)) [y](data:text/html,<b>) ![i](data:image/png;base64,AAA) ![h](http://insecure/img.png)',
    )
    expect(html).not.toMatch(/javascript:|data:/i)
    expect(html).not.toContain('src="http://insecure')
  })
  it('external links open safely, internal links stay plain', () => {
    const html = renderMarkdown('[ext](https://example.com) [int](/sk/jobs)')
    expect(html).toContain(
      '<a href="https://example.com" rel="noopener noreferrer nofollow" target="_blank">ext</a>',
    )
    expect(html).toContain('<a href="/sk/jobs">int</a>')
  })
  it('protocol-relative links are not treated as internal', () => {
    expect(renderMarkdown('[x](//evil.com)')).not.toContain('href="//evil.com"')
  })
  it('demotes h1 to h2 and allows https images', () => {
    const html = renderMarkdown('# Big\n\n![alt](https://cdn.example.com/a.png)')
    expect(html).toContain('<h2>Big</h2>')
    expect(html).toMatch(/<img [^>]*src="https:\/\/cdn\.example\.com\/a\.png"[^>]*>/)
    expect(html).toContain('alt="alt"')
    expect(html).toContain('loading="lazy"')
  })
  it('drops relative and protocol-relative image sources (no cookie-bearing GETs to our origin)', () => {
    const html = renderMarkdown('![a](/api/admin/x) <img src="x"> ![b](//evil.com/p.png)')
    expect(html).not.toMatch(/src="(\/|x"|\/\/)/)
  })
  it('returns empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('')
    expect(renderMarkdown(null)).toBe('')
  })
  it('plain-text excerpt strips markup and truncates', () => {
    expect(markdownToPlainText('## Hi\n\n**A & B** text', 200)).toBe('Hi A & B text')
    expect(markdownToPlainText('word '.repeat(100), 20).length).toBeLessThanOrEqual(20)
  })
})

describe('sniffImageType / storeCmsImage', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])
  const webp = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')
  const svg = new TextEncoder().encode('<svg onload="alert(1)">')

  it('detects real types by magic bytes', () => {
    expect(sniffImageType(jpeg)).toBe('image/jpeg')
    expect(sniffImageType(png)).toBe('image/png')
    expect(sniffImageType(webp)).toBe('image/webp')
    expect(sniffImageType(svg)).toBeNull()
  })
  it('rejects an SVG disguised as PNG', async () => {
    const file = new File([svg], 'x.png', { type: 'image/png' })
    expect(await storeCmsImage(file, 'cms')).toMatchObject({ ok: false, code: 'invalid_type' })
  })
  it('rejects missing and oversized files', async () => {
    expect(await storeCmsImage(null, 'cms')).toMatchObject({ ok: false, code: 'no_file' })
    const big = new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'b.jpg', { type: 'image/jpeg' })
    expect(await storeCmsImage(big, 'cms')).toMatchObject({ ok: false, code: 'too_large' })
  })
  it('stores a valid image under the folder with the sniffed extension', async () => {
    const file = new File([png], 'photo.png', { type: 'image/png' })
    const r = await storeCmsImage(file, 'cms')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.url).toMatch(/^https:\/\/blob\/cms\/\d+\.png$/)
  })
})

describe('constants', () => {
  it('slugify strips diacritics and punctuation', () => {
    expect(slugify('Ako napísať životopis? Tipy 2026!')).toBe('ako-napisat-zivotopis-tipy-2026')
    expect(slugify('Łódź straße')).toBe('lodz-strasse')
    expect(SLUG_REGEX.test(slugify('  --Ahoj--  '))).toBe(true)
  })
  it('isSafeCmsLink accepts http(s) and site paths only', () => {
    expect(isSafeCmsLink('https://jobsphere.eu')).toBe(true)
    expect(isSafeCmsLink('/sk/pricing')).toBe(true)
    expect(isSafeCmsLink('//evil.com')).toBe(false)
    expect(isSafeCmsLink('/' + String.fromCharCode(92) + 'evil.com')).toBe(false)
    expect(isSafeCmsLink('/sk/a' + String.fromCharCode(92) + 'b')).toBe(false)
    expect(isSafeCmsLink('javascript:alert(1)')).toBe(false)
  })
  it('isCmsLocale', () => {
    expect(isCmsLocale('sk')).toBe(true)
    expect(isCmsLocale('hu')).toBe(false)
  })
})

describe('safe CMS reads', () => {
  it('recognises missing tables but not other errors', () => {
    expect(isCmsTableMissing({ code: 'P2021' })).toBe(true)
    expect(isCmsTableMissing({ message: 'relation "BlogPost" does not exist' })).toBe(true)
    expect(isCmsTableMissing({ message: 'type "CmsStatus" does not exist' })).toBe(true)
    expect(isCmsTableMissing({ code: 'P2025', message: 'Record does not exist' })).toBe(false)
  })
  it('cmsRead falls back instead of throwing', async () => {
    const r = await cmsRead('x', async () => Promise.reject({ code: 'P2021' }), 'fallback')
    expect(r).toBe('fallback')
  })
})
