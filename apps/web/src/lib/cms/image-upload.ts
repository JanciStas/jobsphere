/**
 * Shared image upload for CMS content (admin pages/blog) and employer career pages.
 * JPEG/PNG/WEBP only, max 4 MB (Vercel's request body limit is 4.5 MB), verified by magic bytes (the browser-sent MIME type is
 * attacker-controlled). SVG is never accepted (inline scripts => stored XSS).
 */

import { put } from '@vercel/blob'

export const CMS_IMAGE_MAX_BYTES = 4 * 1024 * 1024
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'] as const
type AllowedType = (typeof ALLOWED)[number]

/** Detect the real image type from the first bytes; null when it is not JPEG/PNG/WEBP. */
export function sniffImageType(bytes: Uint8Array): AllowedType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) return 'image/png'
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to))
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  return null
}

export type ImageUploadResult =
  | { ok: true; url: string }
  | { ok: false; status: 400; code: 'no_file' | 'invalid_type' | 'too_large'; error: string }

/**
 * Validate `file` and store it publicly in Vercel Blob under `folder/`.
 * Throws only on storage failure (caller maps it to 500).
 */
export async function storeCmsImage(file: unknown, folder: string): Promise<ImageUploadResult> {
  if (!(file instanceof Blob) || file.size === 0) {
    return { ok: false, status: 400, code: 'no_file', error: 'No file provided' }
  }
  if (file.size > CMS_IMAGE_MAX_BYTES) {
    return { ok: false, status: 400, code: 'too_large', error: 'Image too large (max 4 MB).' }
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  const type = sniffImageType(bytes.subarray(0, 16))
  if (!type || !(ALLOWED as readonly string[]).includes(file.type)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_type',
      error: 'Invalid image type. Use JPG, PNG or WEBP.',
    }
  }
  const ext = type === 'image/jpeg' ? 'jpg' : type === 'image/png' ? 'png' : 'webp'
  const blob = await put(`${folder}/${Date.now()}.${ext}`, new Blob([bytes], { type }), {
    access: 'public',
    addRandomSuffix: true,
    contentType: type,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  })
  return { ok: true, url: blob.url }
}
