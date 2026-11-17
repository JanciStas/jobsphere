/**
 * Validate a post-login `callbackUrl`. Only same-origin, same-locale in-app paths
 * are accepted, so the login page can never be used as an open redirect.
 * Returns the (normalised) path when safe, otherwise null.
 */
export function safeCallbackPath(raw: unknown, locale: string): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return null
  // Control chars (CR/LF header injection) and backslashes (browser-normalised to "/")
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f || code === 0x5c) return null
  }
  // Must be a single-slash absolute path: blocks "//host" and "scheme:" URLs
  if (!raw.startsWith('/') || raw.startsWith('//')) return null

  // Resolve against a dummy origin so dot-segments ("/sk/../api", "/sk/%2e%2e/x") are
  // normalised exactly like the browser would, then validate the *resolved* path.
  const base = 'http://callback.invalid'
  let url: URL
  try {
    url = new URL(raw, base)
  } catch {
    return null
  }
  if (url.origin !== base) return null

  const path = url.pathname
  // Same locale only
  if (path !== `/${locale}` && !path.startsWith(`/${locale}/`)) return null
  // Never bounce back to the login page (loop)
  if (path === `/${locale}/login` || path.startsWith(`/${locale}/login/`)) return null

  return `${path}${url.search}${url.hash}`
}
