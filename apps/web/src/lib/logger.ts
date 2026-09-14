/**
 * Simple logger utility with different log levels
 * In production, this can be extended to send logs to external services
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogContext {
  [key: string]: any
}

// Keys whose values must never be written to logs (case-insensitive substring).
const SENSITIVE_KEY_PATTERN = /token|secret|password|authorization/i

/**
 * Recursively redact values whose key looks sensitive so secrets/PII never
 * reach the log sink. Non-plain values (arrays, primitives) are returned as-is.
 */
function redactPii(value: unknown, seen = new WeakSet<object>()): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactPii(item, seen))
  }
  if (value && typeof value === 'object') {
    if (seen.has(value as object)) return value
    seen.add(value as object)
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : redactPii(val, seen)
    }
    return result
  }
  return value
}

/**
 * Non-Error throwables (Prisma/Zod issues, plain objects, strings) must still
 * say something useful. String(obj) says "[object Object]".
 */
function describeNonError(value: unknown): unknown {
  if (value === undefined || value === null) return String(value)
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>
    return {
      ...(typeof v.name === 'string' ? { name: v.name } : {}),
      ...(typeof v.message === 'string' ? { message: v.message } : {}),
      ...(typeof v.code === 'string' ? { code: v.code } : {}),
      ...(!('message' in v) ? { value: redactPii(v) } : {}),
    }
  }
  return String(value)
}

class Logger {
  private isDevelopment = process.env.NODE_ENV === 'development'

  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString()
    const contextStr = context ? `\n${JSON.stringify(redactPii(context), null, 2)}` : ''
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`
  }

  debug(message: string, context?: LogContext) {
    if (this.isDevelopment) {
      console.debug(this.formatMessage('debug', message, context))
    }
  }

  info(message: string, context?: LogContext) {
    console.info(this.formatMessage('info', message, context))
  }

  warn(message: string, context?: LogContext) {
    console.warn(this.formatMessage('warn', message, context))
  }

  error(message: string, error?: Error | unknown, context?: LogContext) {
    // Two call shapes exist in this codebase: logger.error(msg, err, ctx) and
    // logger.error(msg, { error: err, ...ctx }). The second one — 101 call sites
    // at the time of writing — used to hit String(object) and log every failure
    // as "[object Object]", which is how a month of failing embedding jobs stayed
    // undiagnosable from production logs. Detect it and unpack, rather than
    // touch 101 call sites.
    if (error && !(error instanceof Error) && typeof error === 'object' && 'error' in error) {
      const { error: inner, ...rest } = error as Record<string, unknown>
      context = { ...rest, ...context }
      error = inner
    }
    const errorContext = {
      ...context,
      ...(error instanceof Error
        ? {
            error: error.message,
            stack: error.stack,
          }
        : { error: describeNonError(error) }),
    }
    console.error(this.formatMessage('error', message, errorContext))

    // In production, send to external logging service
    if (!this.isDevelopment && process.env.NEXT_PUBLIC_SENTRY_DSN) {
      import('./monitoring/sentry')
        .then(({ captureException }) => {
          if (error instanceof Error) {
            captureException(error, { extra: { message, ...context } })
          } else {
            captureException(new Error(message), { extra: { error: String(error), ...context } })
          }
        })
        .catch((sentryError) => {
          console.error('Failed to send error to Sentry:', sentryError)
        })
    }
  }

  // API-specific logging
  apiRequest(method: string, path: string, userId?: string) {
    this.info(`API Request: ${method} ${path}`, { userId })
  }

  apiError(method: string, path: string, error: Error | unknown, userId?: string) {
    this.error(`API Error: ${method} ${path}`, error, { userId })
  }

  // Database-specific logging
  dbQuery(query: string, duration?: number) {
    if (this.isDevelopment) {
      this.debug('DB Query', { query, duration })
    }
  }

  dbError(query: string, error: Error | unknown) {
    this.error('DB Error', error, { query })
  }
}

export const logger = new Logger()
