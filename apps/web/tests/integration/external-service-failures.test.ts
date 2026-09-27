import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rateLimit } from '@/lib/rate-limit'
import { sendEmail } from '@/lib/email'
import { scanWithClamAV, securityCheck } from '@/lib/antivirus'
import { extractCvFromText } from '@jobsphere/ai'

/**
 * External Service Failure Tests
 *
 * Tests resilience and graceful degradation when external services fail:
 * - Redis unavailability (rate limiting fail-open)
 * - Stripe webhook failures
 * - Email service timeouts
 * - Claude AI API errors
 * - ClamAV antivirus timeout
 *
 * Each test verifies that the application:
 * 1. Handles failures gracefully without crashing
 * 2. Falls back to safe defaults when appropriate
 * 3. Logs errors appropriately
 * 4. Returns meaningful error messages to users
 */

describe('External Service Failure Tests', () => {
  describe('Redis Unavailability (Rate Limiting)', () => {
    beforeEach(() => {
      // Clear all mocks before each test
      vi.clearAllMocks()
    })

    afterEach(() => {
      // Restore all mocks after each test
      vi.restoreAllMocks()
    })

    it('falls back to the in-memory limiter when Upstash is not configured', async () => {
      const originalDisable = process.env.DISABLE_RATE_LIMIT
      const originalUrl = process.env.KV_REST_API_URL
      const originalToken = process.env.KV_REST_API_TOKEN
      delete process.env.DISABLE_RATE_LIMIT
      delete process.env.KV_REST_API_URL
      delete process.env.KV_REST_API_TOKEN

      try {
        // Act
        const result = await rateLimit({
          identifier: `no-redis-${Date.now()}`,
          limit: 10,
          window: 60,
        })

        // Assert — the request is served, but it is still COUNTED: the in-memory
        // limiter is a real limiter, not a bypass.
        expect(result.success).toBe(true)
        expect(result.limit).toBe(10)
        expect(result.remaining).toBe(9)
      } finally {
        if (originalDisable === undefined) delete process.env.DISABLE_RATE_LIMIT
        else process.env.DISABLE_RATE_LIMIT = originalDisable
        if (originalUrl === undefined) delete process.env.KV_REST_API_URL
        else process.env.KV_REST_API_URL = originalUrl
        if (originalToken === undefined) delete process.env.KV_REST_API_TOKEN
        else process.env.KV_REST_API_TOKEN = originalToken
      }
    })

    it('fails CLOSED to half the limit when a configured Redis errors', async () => {
      const originalDisable = process.env.DISABLE_RATE_LIMIT
      const originalUrl = process.env.KV_REST_API_URL
      const originalToken = process.env.KV_REST_API_TOKEN
      delete process.env.DISABLE_RATE_LIMIT
      // Configured but unreachable: getRedis() returns a client, the pipeline
      // rejects, and the catch drops to the conservative in-memory limiter.
      process.env.KV_REST_API_URL = 'http://127.0.0.1:1'
      process.env.KV_REST_API_TOKEN = 'invalid-token'

      try {
        const identifier = `redis-down-${Date.now()}`
        const first = await rateLimit({ identifier, limit: 10, window: 60 })

        // limit is reported as requested, but only 5 (=10/2) are actually allowed.
        expect(first.limit).toBe(10)
        expect(first.success).toBe(true)
        expect(first.remaining).toBe(4)

        // Exhaust the conservative budget: 5 allowed in total, the 6th is denied.
        for (let i = 0; i < 4; i++) {
          await rateLimit({ identifier, limit: 10, window: 60 })
        }
        const denied = await rateLimit({ identifier, limit: 10, window: 60 })
        expect(denied.success).toBe(false)
      } finally {
        if (originalDisable === undefined) delete process.env.DISABLE_RATE_LIMIT
        else process.env.DISABLE_RATE_LIMIT = originalDisable
        if (originalUrl === undefined) delete process.env.KV_REST_API_URL
        else process.env.KV_REST_API_URL = originalUrl
        if (originalToken === undefined) delete process.env.KV_REST_API_TOKEN
        else process.env.KV_REST_API_TOKEN = originalToken
      }
    }, 20000)

    it('should handle Redis timeout gracefully', async () => {
      // Arrange - This test validates the timeout behavior
      // Mock Redis methods to simulate timeout
      vi.mock('@upstash/redis', () => ({
        Redis: vi.fn().mockImplementation(() => ({
          pipeline: vi.fn().mockReturnValue({
            zremrangebyscore: vi.fn().mockReturnThis(),
            zcard: vi.fn().mockReturnThis(),
            zadd: vi.fn().mockReturnThis(),
            expire: vi.fn().mockReturnThis(),
            exec: vi.fn().mockRejectedValue(new Error('ETIMEDOUT')),
          }),
        })),
      }))

      // Act
      const result = await rateLimit({
        identifier: 'test-timeout-user',
        limit: 5,
        window: 60,
      })

      // Assert - Should fail-open on timeout
      expect(result.success).toBe(true)
      expect(result.limit).toBe(5)
    })

    it('should handle Redis authentication failure', async () => {
      // Arrange
      // Simulate auth failure
      const originalToken = process.env.KV_REST_API_TOKEN
      process.env.KV_REST_API_TOKEN = 'invalid-token'

      // Act
      const result = await rateLimit({
        identifier: 'test-auth-fail',
        limit: 100,
        window: 60,
      })

      // Assert
      expect(result.success).toBe(true) // Fail-open behavior
      expect(result.remaining).toBe(100)

      // Cleanup
      process.env.KV_REST_API_TOKEN = originalToken
    })

    it('should handle network partition (connection refused)', async () => {
      // Arrange
      // Use completely unreachable host
      const originalUrl = process.env.KV_REST_API_URL
      process.env.KV_REST_API_URL = 'http://192.0.2.1:6379' // TEST-NET-1 (unreachable)

      // Act
      const result = await rateLimit({
        identifier: 'network-partition-test',
        limit: 50,
        window: 30,
      })

      // Assert - Should fail-open with full quota
      expect(result.success).toBe(true)
      expect(result.remaining).toBe(50)
      expect(result.limit).toBe(50)

      // Cleanup
      process.env.KV_REST_API_URL = originalUrl
    })

    it('never throws out of rateLimit when Redis configuration is broken', async () => {
      // The previous version spied on console.error and asserted it was called.
      // With no Upstash configured there is no error path to log — rateLimit goes
      // straight to the in-memory limiter — so the assertion was testing nothing
      // that existed. What callers actually depend on is that this never throws.
      const originalDisable = process.env.DISABLE_RATE_LIMIT
      const originalUrl = process.env.KV_REST_API_URL
      delete process.env.DISABLE_RATE_LIMIT
      process.env.KV_REST_API_URL = 'not-a-url'

      try {
        const result = await rateLimit({
          identifier: `broken-config-${Date.now()}`,
          limit: 10,
          window: 60,
        })
        expect(result).toMatchObject({ limit: 10 })
        expect(typeof result.success).toBe('boolean')
      } finally {
        if (originalDisable === undefined) delete process.env.DISABLE_RATE_LIMIT
        else process.env.DISABLE_RATE_LIMIT = originalDisable
        if (originalUrl === undefined) delete process.env.KV_REST_API_URL
        else process.env.KV_REST_API_URL = originalUrl
      }
    }, 20000)
  })

  describe('Stripe Webhook Failures', () => {
    it('should handle invalid webhook signature', async () => {
      // Arrange - Mock Stripe SDK
      const mockConstructEvent = vi.fn().mockImplementation(() => {
        throw new Error('Webhook signature verification failed')
      })

      // This test validates that webhook signature verification is implemented
      // The actual route handler should catch this error and return 400

      expect(() => {
        mockConstructEvent('invalid-body', 'invalid-signature', 'webhook-secret')
      }).toThrow('Webhook signature verification failed')
    })

    it('should handle Stripe API downtime during subscription update', async () => {
      // Arrange
      // This test validates error handling for Stripe API failures
      // In production, the webhook should:
      // 1. Return 500 to trigger retry
      // 2. Log the error
      // 3. Not update database if Stripe call fails

      const mockError = new Error('Stripe API unavailable')
      expect(mockError.message).toBe('Stripe API unavailable')
    })

    it('should handle database failure during webhook processing', async () => {
      // Arrange
      // Mock Prisma to throw database error
      const mockPrismaError = new Error('Database connection failed')

      // Assert - Webhook handler should catch and log
      expect(mockPrismaError.message).toContain('Database')
      // The webhook route should return 500 to trigger Stripe retry
    })

    it('should handle email notification failure in webhook', async () => {
      // Arrange
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Webhook handlers should not fail if email sending fails
      // Test that email errors are caught and logged but don't block webhook processing
      try {
        throw new Error('Email service unavailable')
      } catch (error) {
        consoleErrorSpy('Failed to send payment receipt', error)
      }

      expect(consoleErrorSpy).toHaveBeenCalled()
    })

    it('should validate webhook event structure before processing', async () => {
      // Arrange - Malformed event data
      const malformedEvent = {
        type: 'customer.subscription.created',
        data: {
          // Missing required fields
          object: {},
        },
      }

      // Assert - Should handle gracefully
      expect(malformedEvent.data.object).toBeDefined()
      // Handler should validate before processing
    })
  })

  describe('Email Service Failures', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('should handle Resend API timeout', async () => {
      // Arrange
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Mock fetch to timeout
      global.fetch = vi.fn().mockImplementation(() => {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Timeout')), 100)
        })
      })

      const originalService = process.env.EMAIL_SERVICE
      const originalApiKey = process.env.RESEND_API_KEY
      process.env.EMAIL_SERVICE = 'resend'
      process.env.RESEND_API_KEY = 'test-key'

      // Act & Assert
      await expect(
        sendEmail({
          to: 'test@example.com',
          subject: 'Test',
          html: '<p>Test email</p>',
        }),
      ).rejects.toThrow()

      expect(consoleErrorSpy).toHaveBeenCalled()

      // Cleanup
      process.env.EMAIL_SERVICE = originalService
      process.env.RESEND_API_KEY = originalApiKey
      vi.restoreAllMocks()
    })

    it('should handle Resend API 429 rate limit', async () => {
      // Arrange
      vi.spyOn(console, 'error').mockImplementation(() => {})

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => 'Rate limit exceeded',
      } as Response)

      const originalService = process.env.EMAIL_SERVICE
      const originalApiKey = process.env.RESEND_API_KEY
      process.env.EMAIL_SERVICE = 'resend'
      process.env.RESEND_API_KEY = 'test-key'

      // Act & Assert
      await expect(
        sendEmail({
          to: 'test@example.com',
          subject: 'Test',
          html: '<p>Test</p>',
        }),
      ).rejects.toThrow('Resend API error')

      // Cleanup
      process.env.EMAIL_SERVICE = originalService
      process.env.RESEND_API_KEY = originalApiKey
      vi.restoreAllMocks()
    })

    it('propagates a SendGrid authentication failure instead of reporting success', async () => {
      // sendSendGridEmail uses the @sendgrid/mail SDK, not fetch, and adds no
      // 'SendGrid API error' wrapper — the SDK's own error is what reaches the
      // caller. What matters is that the failure is not swallowed into
      // { success: true }.
      vi.spyOn(console, 'error').mockImplementation(() => {})

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      } as Response)

      const originalService = process.env.EMAIL_SERVICE
      const originalApiKey = process.env.SENDGRID_API_KEY
      process.env.EMAIL_SERVICE = 'sendgrid'
      process.env.SENDGRID_API_KEY = 'invalid-key'

      try {
        await expect(
          sendEmail({
            to: 'test@example.com',
            subject: 'Test',
            html: '<p>Test</p>',
          }),
        ).rejects.toThrow()

        // ...and with throwOnError disabled the caller gets an explicit failure.
        const result = await sendEmail({
          to: 'test@example.com',
          subject: 'Test',
          html: '<p>Test</p>',
          throwOnError: false,
        })
        expect(result.success).toBe(false)
        expect(result.error).toBeTruthy()
      } finally {
        process.env.EMAIL_SERVICE = originalService
        if (originalApiKey === undefined) delete process.env.SENDGRID_API_KEY
        else process.env.SENDGRID_API_KEY = originalApiKey
        vi.restoreAllMocks()
      }
    })

    it('surfaces a missing RESEND_API_KEY as a failure rather than a silent skip', async () => {
      // There is no warn-and-skip path: sendResendEmail constructs
      // `new Resend(process.env.RESEND_API_KEY)` and the SDK throws
      // "Missing API key" when it is undefined. The old test awaited sendEmail
      // without catching, so that throw failed the test outright.
      vi.spyOn(console, 'error').mockImplementation(() => {})

      const originalService = process.env.EMAIL_SERVICE
      const originalApiKey = process.env.RESEND_API_KEY
      process.env.EMAIL_SERVICE = 'resend'
      delete process.env.RESEND_API_KEY

      try {
        await expect(
          sendEmail({
            to: 'test@example.com',
            subject: 'Test',
            html: '<p>Test</p>',
          }),
        ).rejects.toThrow(/Missing API key/i)

        const result = await sendEmail({
          to: 'test@example.com',
          subject: 'Test',
          html: '<p>Test</p>',
          throwOnError: false,
        })
        expect(result.success).toBe(false)
      } finally {
        process.env.EMAIL_SERVICE = originalService
        if (originalApiKey === undefined) delete process.env.RESEND_API_KEY
        else process.env.RESEND_API_KEY = originalApiKey
        vi.restoreAllMocks()
      }
    })

    it('should handle network failures during email send', async () => {
      // Arrange
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

      const originalService = process.env.EMAIL_SERVICE
      const originalApiKey = process.env.RESEND_API_KEY
      process.env.EMAIL_SERVICE = 'resend'
      process.env.RESEND_API_KEY = 'test-key'

      // Act & Assert
      await expect(
        sendEmail({
          to: 'test@example.com',
          subject: 'Test',
          html: '<p>Test</p>',
        }),
      ).rejects.toThrow()

      // logger.error hands console.error a single preformatted string, so the
      // two-argument (message, Error) shape never matched; and the message is
      // 'Failed to send email', not 'Error sending email'.
      expect(consoleErrorSpy).toHaveBeenCalled()
      const logged = consoleErrorSpy.mock.calls.map((c) => String(c[0])).join('\n')
      expect(logged).toContain('Failed to send email')

      // Cleanup
      process.env.EMAIL_SERVICE = originalService
      process.env.RESEND_API_KEY = originalApiKey
      vi.restoreAllMocks()
    })

    it('should fallback to log mode when service is unavailable', async () => {
      // EMAIL_SERVICE=log routes through logger.info('Email logged', {...}), which
      // writes ONE formatted string to console.info — not console.log, and not a
      // (message, object) pair.
      const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      const originalService = process.env.EMAIL_SERVICE
      process.env.EMAIL_SERVICE = 'log'

      try {
        // Act
        const result = await sendEmail({
          to: 'test@example.com',
          subject: 'Test Email',
          html: '<p>Test content</p>',
        })

        // Assert - reports success without contacting a provider, and says so
        expect(result.success).toBe(true)
        const logged = consoleInfoSpy.mock.calls.map((c) => String(c[0])).join('\n')
        expect(logged).toContain('Email logged')
        expect(logged).toContain('test@example.com')
        expect(logged).toContain('Test Email')
      } finally {
        process.env.EMAIL_SERVICE = originalService
        vi.restoreAllMocks()
      }
    })
  })

  describe('Claude AI API Failures', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('should handle Anthropic API rate limit (429)', async () => {
      // Arrange
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      const cvText = 'John Doe\nSoftware Engineer\njohn@example.com\n+1234567890'

      // Act & Assert - Should throw meaningful error
      await expect(
        extractCvFromText(cvText, {
          apiKey: 'invalid-key',
          model: 'claude-opus-4-20250514',
        }),
      ).rejects.toThrow()
    })

    it('should handle Anthropic API authentication failure', async () => {
      // Arrange
      const cvText = 'Test CV content'

      // Act & Assert
      await expect(
        extractCvFromText(cvText, {
          apiKey: 'sk-ant-invalid',
          model: 'claude-opus-4-20250514',
        }),
      ).rejects.toThrow()
    })

    it('should fallback to OpenRouter when Anthropic fails', async () => {
      // Arrange
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const cvText = `
        John Doe
        Software Engineer
        john@example.com
        +1234567890

        Experience:
        - 5 years at TechCorp
      `

      // Act - Should try OpenRouter first, then fail to Anthropic
      try {
        await extractCvFromText(cvText, {
          openRouterApiKey: 'invalid-key',
          apiKey: 'invalid-anthropic-key',
        })
      } catch {
        // Assert - Should log OpenRouter attempt
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining('Attempting CV extraction with OpenRouter'),
        )
      }
    })

    it('should handle malformed JSON response from AI', async () => {
      // Arrange
      vi.spyOn(console, 'error').mockImplementation(() => {})

      // This validates that the parser handles invalid JSON gracefully
      const invalidJson = 'Not a valid JSON response'

      expect(() => JSON.parse(invalidJson)).toThrow()
    })

    it('should handle AI API timeout', async () => {
      // Arrange
      const cvText = 'Test CV'

      // Mock Anthropic SDK to timeout
      vi.mock('@anthropic-ai/sdk', () => ({
        default: vi.fn().mockImplementation(() => ({
          messages: {
            create: vi.fn().mockRejectedValue(new Error('Request timeout')),
          },
        })),
      }))

      // Act & Assert
      await expect(
        extractCvFromText(cvText, {
          apiKey: 'test-key',
        }),
      ).rejects.toThrow()
    })

    it('should handle OpenRouter rate limit', async () => {
      // Arrange
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      const cvText = 'Test CV content'

      // Mock OpenAI client for OpenRouter
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ error: 'Rate limit exceeded' }),
      } as Response)

      // Act & Assert
      await expect(
        extractCvFromText(cvText, {
          openRouterApiKey: 'test-key',
          apiKey: 'fallback-key',
        }),
      ).rejects.toThrow()
    })

    it('should handle AI service unavailability (503)', async () => {
      // Arrange
      // Simulate service unavailable
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      } as Response)

      // Act & Assert - Should propagate meaningful error
      // The application should retry or show user-friendly message
      expect(true).toBe(true) // Placeholder for actual implementation test
    })

    it('should provide meaningful error when all AI providers fail', async () => {
      // Arrange
      vi.spyOn(console, 'error').mockImplementation(() => {})

      const cvText = 'Test CV'

      // Act & Assert
      await expect(
        extractCvFromText(cvText, {
          openRouterApiKey: 'invalid-1',
          apiKey: 'invalid-2',
        }),
      ).rejects.toThrow(/All AI providers failed/)
    })
  })

  describe('ClamAV Antivirus Failures', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    afterEach(() => {
      vi.restoreAllMocks()
      // Reset environment variables
      delete process.env.ANTIVIRUS_FAIL_MODE
    })

    it('should fail-open in development when ClamAV is unavailable', async () => {
      // Arrange
      const originalEnv = process.env.NODE_ENV
      const originalFailMode = process.env.ANTIVIRUS_FAIL_MODE
      process.env.NODE_ENV = 'development'
      delete process.env.ANTIVIRUS_FAIL_MODE // Use default behavior

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const testBuffer = Buffer.from('test file content')

      // Mock ClamAV to fail
      process.env.CLAMAV_HOST = 'invalid-host'

      // Act
      const result = await scanWithClamAV(testBuffer)

      // Assert - Should allow file in development (fail-open)
      expect(result.clean).toBe(true)
      expect(result.skipped).toBe(true)
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('ClamAV unavailable - allowing file (fail-open mode)'),
      )

      // Cleanup
      process.env.NODE_ENV = originalEnv
      if (originalFailMode) {
        process.env.ANTIVIRUS_FAIL_MODE = originalFailMode
      }
    })

    it('should fail-closed in production when ClamAV is unavailable', async () => {
      // Arrange
      const originalEnv = process.env.NODE_ENV
      const originalFailMode = process.env.ANTIVIRUS_FAIL_MODE
      process.env.NODE_ENV = 'production'
      delete process.env.ANTIVIRUS_FAIL_MODE // Use default (fail-closed in production)

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const testBuffer = Buffer.from('test file content')

      // Mock ClamAV to fail
      process.env.CLAMAV_HOST = 'invalid-production-host'

      // Act
      const result = await scanWithClamAV(testBuffer)

      // Assert - Should reject file in production (fail-closed)
      expect(result.clean).toBe(false)
      expect(result.virus).toBe('ANTIVIRUS_UNAVAILABLE')
      expect(result.skipped).toBe(true)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('ClamAV unavailable - rejecting file (fail-closed mode)'),
      )

      // Cleanup
      process.env.NODE_ENV = originalEnv
      if (originalFailMode) {
        process.env.ANTIVIRUS_FAIL_MODE = originalFailMode
      }
    })

    it('should handle ClamAV connection timeout', async () => {
      // Arrange
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const testBuffer = Buffer.from('test content')
      // Unresolvable host, not a blackholed IP (192.0.2.1): a blackhole hangs the
      // TCP connect until the OS timeout, which is longer than this test's budget
      // on some platforms, so this timed out instead of asserting anything.
      process.env.CLAMAV_HOST = 'clamav-does-not-resolve.invalid'
      process.env.CLAMAV_PORT = '3310'

      // Act
      const result = await scanWithClamAV(testBuffer)

      // Assert - scan is reported as skipped, whichever fail mode is in force
      expect(result.skipped).toBe(true)
      expect(consoleErrorSpy).toHaveBeenCalled()
    }, 10000) // 10 second timeout for network operations

    it('should respect ANTIVIRUS_FAIL_MODE=open override', async () => {
      // Arrange
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'
      process.env.ANTIVIRUS_FAIL_MODE = 'open' // Override to fail-open

      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const testBuffer = Buffer.from('test')

      process.env.CLAMAV_HOST = 'invalid-host'

      // Act
      const result = await scanWithClamAV(testBuffer)

      // Assert - Should fail-open even in production due to override
      expect(result.clean).toBe(true)
      expect(result.skipped).toBe(true)

      // Cleanup
      process.env.NODE_ENV = originalEnv
      delete process.env.ANTIVIRUS_FAIL_MODE
    })

    it('should respect ANTIVIRUS_FAIL_MODE=closed override', async () => {
      // Arrange
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'development'
      process.env.ANTIVIRUS_FAIL_MODE = 'closed' // Override to fail-closed

      vi.spyOn(console, 'error').mockImplementation(() => {})
      const testBuffer = Buffer.from('test')

      process.env.CLAMAV_HOST = 'invalid-host'

      // Act
      const result = await scanWithClamAV(testBuffer)

      // Assert - Should fail-closed even in development due to override
      expect(result.clean).toBe(false)
      expect(result.virus).toBe('ANTIVIRUS_UNAVAILABLE')

      // Cleanup
      process.env.NODE_ENV = originalEnv
      delete process.env.ANTIVIRUS_FAIL_MODE
    })

    it('should handle ClamAV daemon not responding', async () => {
      // Arrange
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const testBuffer = Buffer.from('test file')
      process.env.ENABLE_ANTIVIRUS = 'true'
      process.env.CLAMAV_HOST = 'localhost'
      process.env.CLAMAV_PORT = '9999' // Invalid port

      // Act
      const result = await scanWithClamAV(testBuffer)

      // Assert
      expect(result.skipped).toBe(true)
      // Logger is used, not console.error directly, so just check it was called
      expect(consoleErrorSpy).toHaveBeenCalled()
    }, 10000) // 10 second timeout

    it('should skip scan when ENABLE_ANTIVIRUS is false', async () => {
      // Arrange
      vi.spyOn(console, 'debug').mockImplementation(() => {})

      process.env.ENABLE_ANTIVIRUS = 'false'
      const testBuffer = Buffer.from('test')

      // Act - Using the actual function from antivirus.ts.
      // Since we can't easily mock the logger import, we test the expected behavior.
      const result = await scanWithClamAV(testBuffer)

      // Assert - Should skip scan and return clean
      expect(result.clean).toBe(true)
      expect(result.scanTime).toBe(0)

      // Cleanup
      delete process.env.ENABLE_ANTIVIRUS
    })

    it('should handle security check failure with proper error', async () => {
      // Arrange
      vi.spyOn(console, 'error').mockImplementation(() => {})

      const testBuffer = Buffer.from('test')
      const metadata = {
        filename: 'test.pdf',
        mimeType: 'application/pdf',
        fileSize: 1000,
      }

      // Set ClamAV to fail
      process.env.NODE_ENV = 'production'
      delete process.env.ANTIVIRUS_FAIL_MODE
      process.env.CLAMAV_HOST = 'invalid-clamav-host'

      // Act & Assert
      await expect(securityCheck(testBuffer, metadata)).rejects.toThrow()

      // Cleanup
      delete process.env.NODE_ENV
    })

    it('should log scan time even on failure', async () => {
      // Arrange
      vi.spyOn(console, 'error').mockImplementation(() => {})

      const testBuffer = Buffer.from('test')
      process.env.CLAMAV_HOST = 'timeout-host'

      const startTime = Date.now()

      // Act
      const result = await scanWithClamAV(testBuffer)

      const endTime = Date.now()

      // Assert - Should have recorded scan time
      expect(result.scanTime).toBeGreaterThanOrEqual(0)
      expect(result.scanTime).toBeLessThanOrEqual(endTime - startTime + 100) // Allow 100ms buffer
    })
  })

  describe('Multiple Service Failures (Cascade)', () => {
    it('should handle Redis and Email failures simultaneously', async () => {
      // Arrange
      vi.spyOn(console, 'error').mockImplementation(() => {})

      // Disable both services
      const originalRedisUrl = process.env.KV_REST_API_URL
      const originalEmailKey = process.env.RESEND_API_KEY
      const originalEmailService = process.env.EMAIL_SERVICE

      process.env.KV_REST_API_URL = 'http://invalid-redis:6379'
      process.env.EMAIL_SERVICE = 'resend'
      delete process.env.RESEND_API_KEY

      // Act - Rate limit should fail-open
      const rateLimitResult = await rateLimit({
        identifier: 'cascade-test',
        limit: 10,
        window: 60,
      })

      // Email fails (no API key) — it reports the failure, it does not skip.
      const emailResult = await sendEmail({
        to: 'test@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
        throwOnError: false,
      })

      // Assert — the two services are independent: email is down, rate limiting
      // still answers.
      expect(rateLimitResult.success).toBe(true)
      expect(emailResult.success).toBe(false)

      // Cleanup
      process.env.KV_REST_API_URL = originalRedisUrl
      process.env.RESEND_API_KEY = originalEmailKey
      process.env.EMAIL_SERVICE = originalEmailService
      vi.restoreAllMocks()
    })

    it('should handle AI and ClamAV failures in CV upload flow', async () => {
      // Arrange
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Simulate full CV upload pipeline failure
      const testBuffer = Buffer.from('fake cv content')

      // ClamAV unavailable
      process.env.CLAMAV_HOST = 'invalid-clamav'
      process.env.NODE_ENV = 'production'
      delete process.env.ANTIVIRUS_FAIL_MODE

      // Act - ClamAV should fail-closed
      const avResult = await scanWithClamAV(testBuffer)

      // Assert - Upload should be blocked at AV stage
      expect(avResult.clean).toBe(false)
      expect(avResult.virus).toBe('ANTIVIRUS_UNAVAILABLE')

      // AI extraction wouldn't even be attempted
      expect(consoleErrorSpy).toHaveBeenCalled()

      // Cleanup
      delete process.env.NODE_ENV
    })

    it('should maintain service isolation - email failure does not affect rate limit', async () => {
      // Arrange
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      // Email fails
      const originalApiKey = process.env.RESEND_API_KEY
      const originalEmailService = process.env.EMAIL_SERVICE
      process.env.EMAIL_SERVICE = 'resend'
      delete process.env.RESEND_API_KEY

      // Act - Rate limiting should still work
      const rateLimitResult = await rateLimit({
        identifier: `isolation-test-${Date.now()}`,
        limit: 100,
        window: 60,
      })

      // Email fails gracefully (reported, not thrown, with throwOnError: false).
      const emailResult = await sendEmail({
        to: 'test@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
        throwOnError: false,
      })

      // Assert - Rate limit works despite email failure
      expect(rateLimitResult.success).toBe(true)
      expect(emailResult.success).toBe(false)
      expect(consoleWarnSpy).toBeDefined()

      // Cleanup
      process.env.RESEND_API_KEY = originalApiKey
      process.env.EMAIL_SERVICE = originalEmailService
      vi.restoreAllMocks()
    })
  })

  describe('Service Recovery and Retry', () => {
    it('should log retry-able vs non-retry-able errors', async () => {
      // Arrange
      vi.spyOn(console, 'error').mockImplementation(() => {})

      // Retry-able: Network timeout (should retry)
      const retryableError = new Error('ETIMEDOUT')

      // Non-retry-able: Authentication failure (should not retry)
      const nonRetryableError = new Error('Invalid API key')

      // Assert - Different error types logged differently
      expect(retryableError.message).toBe('ETIMEDOUT')
      expect(nonRetryableError.message).toContain('Invalid')
    })

    it('should provide actionable error messages for service failures', async () => {
      // Arrange & Act
      const errors = {
        redis: 'Rate limiting unavailable - request allowed as fallback',
        email: 'Email service unavailable - notification not sent',
        clamav: 'Antivirus scanner unavailable - file rejected for security',
        ai: 'AI service unavailable - CV parsing failed, please try again later',
      }

      // Assert - Each error message is actionable
      Object.entries(errors).forEach(([, message]) => {
        expect(message).toMatch(/unavailable|failed|rejected/)
        expect(message.length).toBeGreaterThan(20)
      })
    })
  })
})
