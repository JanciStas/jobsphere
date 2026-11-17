/**
 * Mask an email for logging — keep first char + domain (GDPR: no full PII in logs).
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return '***'
  const at = email.lastIndexOf('@')
  if (at < 1) return '***'
  return `${email.slice(0, 1)}***@${email.slice(at + 1)}`
}
