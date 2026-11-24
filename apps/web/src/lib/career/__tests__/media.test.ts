import { describe, it, expect } from 'vitest'
import {
  toVideoEmbedUrl,
  isHexColor,
  isHttpsUrl,
  readableTextColor,
  careerPagePath,
} from '../media'
import { careerPageInputSchema } from '../schema'

describe('toVideoEmbedUrl', () => {
  it.each([
    [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    ],
    [
      'https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    ],
    [
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    ],
    ['https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    ['https://vimeo.com/76979871', 'https://player.vimeo.com/video/76979871'],
    ['https://www.vimeo.com/76979871/', 'https://player.vimeo.com/video/76979871'],
  ])('%s → %s', (input, expected) => {
    expect(toVideoEmbedUrl(input)).toBe(expected)
  })

  it.each([
    'http://www.youtube.com/watch?v=dQw4w9WgXcQ', // not https
    'javascript:alert(1)',
    'https://evil.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/embed/dQw4w9WgXcQ', // only watch links accepted
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ"><script>',
    'https://youtu.be/dQw4w9WgXcQ/extra',
    'https://vimeo.com/channels/staffpicks/123',
    'https://vimeo.com/abc',
    'https://user:pw@vimeo.com/76979871',
    'https://vimeo.com:8443/76979871',
    'not a url',
    '',
    null,
    undefined,
    42,
  ])('rejects %s', (input) => {
    expect(toVideoEmbedUrl(input)).toBeNull()
  })
})

describe('color and url guards', () => {
  it('accepts only #RRGGBB', () => {
    expect(isHexColor('#1a2B3c')).toBe(true)
    expect(isHexColor('#fff')).toBe(false)
    expect(isHexColor('red')).toBe(false)
    expect(isHexColor('#1a2b3c;background:url(x)')).toBe(false)
    expect(isHexColor(null)).toBe(false)
  })
  it('accepts only https URLs without credentials', () => {
    expect(isHttpsUrl('https://x.public.blob.vercel-storage.com/a.png')).toBe(true)
    expect(isHttpsUrl('http://x.com/a.png')).toBe(false)
    expect(isHttpsUrl('javascript:alert(1)')).toBe(false)
    expect(isHttpsUrl('data:image/png;base64,AAA')).toBe(false)
    expect(isHttpsUrl('https://u:p@x.com/a.png')).toBe(false)
  })
  it('picks readable text color', () => {
    expect(readableTextColor('#ffffff')).toBe('#000000')
    expect(readableTextColor('#000000')).toBe('#ffffff')
    expect(readableTextColor('#2563eb')).toBe('#ffffff')
    expect(readableTextColor('#facc15')).toBe('#000000')
  })
  it('builds the public path', () => {
    expect(careerPagePath('sk', 'acme')).toBe('/sk/careers/acme')
  })
})

describe('careerPageInputSchema', () => {
  it('normalises empty strings to null and drops blank benefits', () => {
    const r = careerPageInputSchema.parse({
      headline: '  ',
      brandColor: '',
      videoUrl: '',
      benefits: ['  Home office ', '', '  '],
    })
    expect(r.headline).toBeNull()
    expect(r.brandColor).toBeNull()
    expect(r.videoUrl).toBeNull()
    expect(r.benefits).toEqual(['Home office'])
    expect(r.subheadline).toBeUndefined()
  })
  it('strips unknown keys such as orgId', () => {
    const r = careerPageInputSchema.parse({ orgId: 'other-org', headline: 'Hi' })
    expect(r).not.toHaveProperty('orgId')
  })
})
