/**
 * Markdown -> safe HTML for every CMS surface (pages, FAQ, blog, career pages).
 *
 * Authors write Markdown; raw HTML inside it is NOT trusted. `marked` renders, then
 * `sanitize-html` keeps only a fixed tag/attribute whitelist, http(s)/mailto/tel links
 * and https images. External links get rel="noopener noreferrer nofollow".
 * Server-side only (sanitize-html pulls in postcss).
 */

import { marked } from 'marked'
import sanitizeHtmlLib from 'sanitize-html'

/** Hard cap so a pasted novel cannot blow up a request. */
export const MAX_MARKDOWN_LENGTH = 100_000

const ALLOWED_TAGS = [
  'p',
  'br',
  'hr',
  'strong',
  'em',
  'del',
  's',
  'a',
  'ul',
  'ol',
  'li',
  'h2',
  'h3',
  'h4',
  'blockquote',
  'code',
  'pre',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'img',
]

function isInternalHref(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//')
}

export function renderMarkdown(markdown: string | null | undefined): string {
  if (!markdown || typeof markdown !== 'string') return ''
  const source = markdown.slice(0, MAX_MARKDOWN_LENGTH)
  const rawHtml = marked.parse(source, { async: false, gfm: true, breaks: false }) as string

  return sanitizeHtmlLib(rawHtml, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'title', 'rel', 'target'],
      img: ['src', 'alt', 'title', 'loading'],
      th: ['align'],
      td: ['align'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['https'] },
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    allowProtocolRelative: false,
    // h1 is the page title; demote any author h1 to h2 so a page has a single h1.
    transformTags: {
      h1: 'h2',
      a: (tagName, attribs) => {
        const href = attribs.href ?? ''
        if (isInternalHref(href)) return { tagName, attribs: { href } }
        return {
          tagName,
          attribs: {
            ...(href && { href }),
            ...(attribs.title && { title: attribs.title }),
            rel: 'noopener noreferrer nofollow',
            target: '_blank',
          },
        }
      },
      img: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, loading: 'lazy' },
      }),
    },
  }).trim()
}

/** Plain-text excerpt (for meta descriptions / list cards) from Markdown. */
export function markdownToPlainText(markdown: string | null | undefined, maxLength = 200): string {
  const html = renderMarkdown(markdown)
  const text = sanitizeHtmlLib(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text
}
