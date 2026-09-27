import NextAuth, { NextAuthOptions } from 'next-auth'
import { PrismaAdapter } from '@next-auth/prisma-adapter'
import CredentialsProvider from 'next-auth/providers/credentials'
import GoogleProvider from 'next-auth/providers/google'
import AppleProvider from 'next-auth/providers/apple'
import { prisma } from './prisma'
import * as bcryptjs from 'bcryptjs'
import { getServerSession } from 'next-auth/next'
import { logger } from './logger'
import { deriveActiveContext, isMemberOfOrg, type OrgMembership } from './auth-context'

// UnauthorizedError — defined here to break circular dep with api-helpers.ts
// api-helpers.ts re-exports this class for backwards compatibility.
export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

/**
 * AUTH-001 — how often (ms) to re-check the DB sessionEpoch on a JWT refresh.
 * Bounds the revocation window: a banned/demoted user keeps access for at most
 * this long. Kept short (60s) because correctness matters more than the extra
 * read, and the read is a single indexed lookup. The JWT `updateAge` (1h) does
 * NOT trigger our callback often enough on its own, so we throttle here instead.
 */
const SESSION_EPOCH_CHECK_INTERVAL_MS = 60 * 1000

/**
 * NextAuth v4 Configuration
 * Downgraded from v5 beta.4 due to constructor bug on Vercel production
 */
export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60, // 24 hours
    updateAge: 60 * 60, // Refresh token every 1 hour
  },
  pages: {
    signIn: '/login',
  },
  providers: [
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          }),
        ]
      : []),
    // Apple Sign In — active only when configured. APPLE_ID = Service ID (client id),
    // APPLE_SECRET = the Apple client-secret JWT (generated from Team ID + Key ID + .p8).
    ...(process.env.APPLE_ID && process.env.APPLE_SECRET
      ? [
          AppleProvider({
            clientId: process.env.APPLE_ID,
            clientSecret: process.env.APPLE_SECRET,
          }),
        ]
      : []),
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        try {
          if (!credentials?.email || !credentials?.password) {
            return null
          }

          const normalizedEmail = credentials.email.toLowerCase()

          const user = await prisma.user.findUnique({
            where: {
              email: normalizedEmail,
            },
          })

          // SECURITY: Prevent timing attacks — always perform bcrypt comparison
          // even when user doesn't exist, to maintain constant response time
          // and prevent email enumeration via response time analysis
          if (!user || !user.password) {
            await bcryptjs.compare(
              credentials.password,
              '$2a$12$UGzP4Z0tFYfNO8YM6g3HE.lN0jC.ueAnEglJpgP.its5zuuMhc7Vm',
            )
            return null
          }

          // SECURITY: Check if account is locked
          if (user.lockedUntil && user.lockedUntil > new Date()) {
            const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000)
            logger.warn(`Account locked. Unlocks in ${minutesLeft} minutes`)
            return null
          }

          // If lock expired, reset failedAttempts
          if (user.lockedUntil && user.lockedUntil <= new Date()) {
            await prisma.user.update({
              where: { id: user.id },
              data: {
                failedAttempts: 0,
                lockedUntil: null,
              },
            })
          }

          const isPasswordValid = await bcryptjs.compare(credentials.password, user.password)

          if (!isPasswordValid) {
            // SECURITY: Increment failed attempts
            const newFailedAttempts = user.failedAttempts + 1
            const maxAttempts = 5
            const lockoutMinutes = 15

            if (newFailedAttempts >= maxAttempts) {
              // Lock account for 15 minutes
              const lockedUntil = new Date(Date.now() + lockoutMinutes * 60000)
              await prisma.user.update({
                where: { id: user.id },
                data: {
                  failedAttempts: newFailedAttempts,
                  lockedUntil,
                },
              })
              logger.warn(
                `🔒 Account locked for ${user.email} after ${maxAttempts} failed attempts. Locked until ${lockedUntil.toISOString()}`,
              )
            } else {
              // Just increment counter
              await prisma.user.update({
                where: { id: user.id },
                data: {
                  failedAttempts: newFailedAttempts,
                },
              })
              logger.warn(
                `⚠️  Failed login attempt ${newFailedAttempts}/${maxAttempts} for ${user.email}`,
              )
            }

            return null
          }

          // SECURITY: Email must be verified before login (production only).
          // A preview/demo deployment that has no email provider configured can
          // opt out with PREVIEW_SKIP_EMAIL_VERIFICATION=true so stakeholders can
          // sign up and log in without a verification email. NEVER set this in real
          // production — it disables the email-ownership check.
          const skipEmailVerification = process.env.PREVIEW_SKIP_EMAIL_VERIFICATION === 'true'
          if (
            !user.emailVerified &&
            process.env.NODE_ENV === 'production' &&
            !skipEmailVerification
          ) {
            throw new Error('EMAIL_NOT_VERIFIED')
          }

          // SECURITY: Successful login - reset failed attempts and update lastLoginAt
          await prisma.user.update({
            where: { id: user.id },
            data: {
              failedAttempts: 0,
              lockedUntil: null,
              lastLoginAt: new Date(),
            },
          })

          return {
            id: user.id,
            email: user.email!,
            name: user.name,
            image: user.avatar,
          }
        } catch (error) {
          // Re-throw known auth errors so NextAuth can expose them to the client
          if (error instanceof Error && error.message === 'EMAIL_NOT_VERIFIED') {
            throw error
          }
          // Re-throw infrastructure errors (DB down, bcrypt crash) so they surface
          // as 500 and get captured by Sentry rather than looking like wrong password
          const msg = error instanceof Error ? error.message : String(error)
          const isInfraError =
            msg.includes('connect') ||
            msg.includes('timeout') ||
            msg.includes('ECONNREFUSED') ||
            msg.includes('prepared statement')
          if (isInfraError) {
            logger.error('❌ Infrastructure error during auth:', error)
            throw error
          }
          logger.error('❌ Auth error:', error)
          return null
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      try {
        if (user?.id) {
          token.id = user.id

          // PR7 dual-role: load ALL memberships (not just the first), the global
          // admin flag, session epoch, the persisted active org, and existence of
          // candidate/freelancer identities.
          const [memberships, dbUser] = await Promise.all([
            prisma.userOrgRole.findMany({
              where: { userId: user.id, deletedAt: null },
              include: { organization: { select: { id: true, name: true } } },
              orderBy: { createdAt: 'asc' },
            }),
            prisma.user.findUnique({
              where: { id: user.id },
              select: {
                isGlobalAdmin: true,
                sessionEpoch: true,
                activeOrgId: true,
                freelancerProfile: { select: { id: true } },
                candidates: { select: { id: true }, take: 1 },
              },
            }),
          ])

          const orgs: OrgMembership[] = memberships.map((m) => ({
            orgId: m.orgId,
            orgName: m.organization?.name ?? null,
            role: m.role,
          }))
          token.orgs = orgs

          // Derive the flat role/orgId/orgName from the active org (falls back to
          // the first membership when the persisted activeOrgId is stale/invalid).
          // Keeps legacy `session.user.orgId`/`role` readers working unchanged.
          const ctx = deriveActiveContext(orgs, dbUser?.activeOrgId ?? null)
          token.activeOrgId = ctx.activeOrgId
          token.role = ctx.role
          token.orgId = ctx.orgId
          token.orgName = ctx.orgName

          token.isCandidate = (dbUser?.candidates?.length ?? 0) > 0
          token.isFreelancer = !!dbUser?.freelancerProfile
          token.isGlobalAdmin = dbUser?.isGlobalAdmin ?? false
          // AUTH-001: pin the session epoch at sign-in so we can detect revocation later
          token.sessionEpoch = dbUser?.sessionEpoch ?? 0
          token.epochCheckedAt = Date.now()
          token.invalid = false

          return token
        }

        // PR7 dual-role context switch. Triggered by useSession().update({ activeOrgId }).
        // switch-authz: apply the requested org ONLY when the user is truly a member
        // (guards against pointing the session at a foreign org). A foreign/unknown
        // id is ignored silently — the active context is left untouched.
        if (trigger === 'update' && session?.activeOrgId) {
          const orgs = (token.orgs ?? []) as OrgMembership[]
          if (isMemberOfOrg(orgs, session.activeOrgId)) {
            const ctx = deriveActiveContext(orgs, session.activeOrgId as string)
            token.activeOrgId = ctx.activeOrgId
            token.role = ctx.role
            token.orgId = ctx.orgId
            token.orgName = ctx.orgName
            // Persist so the next sign-in defaults to the chosen org.
            try {
              await prisma.user.update({
                where: { id: token.id as string },
                data: { activeOrgId: ctx.activeOrgId },
              })
            } catch (persistError) {
              logger.error('Failed to persist activeOrgId on context switch', persistError)
            }
          }
          return token
        }

        // AUTH-001 — Session revocation check on every refresh.
        // Re-read the user's current sessionEpoch (throttled) and if it no longer
        // matches the value pinned at sign-in, mark the token invalid so the
        // session callback strips the user identity (effectively logged out).
        if (token.id) {
          const lastChecked = (token.epochCheckedAt as number | undefined) ?? 0
          const shouldCheck = Date.now() - lastChecked >= SESSION_EPOCH_CHECK_INTERVAL_MS

          if (shouldCheck) {
            const current = await prisma.user.findUnique({
              where: { id: token.id as string },
              select: { sessionEpoch: true },
            })

            // User deleted, or epoch bumped (ban / demote / role change / password reset)
            if (!current || current.sessionEpoch !== (token.sessionEpoch ?? 0)) {
              token.invalid = true
            }

            token.epochCheckedAt = Date.now()
          }
        }

        return token
      } catch (error) {
        logger.error('❌ JWT Callback error:', error)
        logger.error('❌ JWT error stack:', error instanceof Error ? error.stack : 'No stack')
        throw error // Re-throw to let NextAuth handle it
      }
    },
    async session({ session, token }) {
      try {
        // AUTH-001: a revoked/stale token yields a session with no user identity,
        // so every downstream `auth()` / `requireAuth()` check fails closed.
        if (token.invalid) {
          if (session.user) {
            session.user.id = undefined as unknown as string
          }
          return session
        }

        if (session.user) {
          session.user.id = token.id as string
          session.user.role = token.role as string | undefined
          session.user.orgId = token.orgId as string | undefined
          session.user.orgName = token.orgName as string | undefined
          session.user.isGlobalAdmin = token.isGlobalAdmin as boolean | undefined
          // PR7 dual-role: expose the full membership list + active context so the
          // UI can render a context switcher.
          session.user.orgs = token.orgs
          session.user.activeOrgId = token.activeOrgId ?? null
          session.user.isCandidate = token.isCandidate
          session.user.isFreelancer = token.isFreelancer
        }
        return session
      } catch (error) {
        logger.error('❌ Session Callback error:', error)
        logger.error('❌ Session error stack:', error instanceof Error ? error.stack : 'No stack')
        throw error // Re-throw to let NextAuth handle it
      }
    },
  },
}

// Export NextAuth handler (default export for API route)
export default NextAuth(authOptions)

/**
 * Get session in server components
 * Use this instead of the v5 auth() function
 */
export const auth = () => getServerSession(authOptions)

/**
 * Require authentication - throws UnauthorizedError if not authenticated
 * Use this in API routes to ensure user is logged in
 */
export async function requireAuth() {
  const session = await auth()

  if (!session?.user?.id) {
    throw new UnauthorizedError('You must be logged in to access this resource')
  }

  return session
}

/**
 * Require a platform-wide superadmin (User.isGlobalAdmin).
 *
 * Shared guard for every /api/admin/* endpoint. Returns the session when the
 * caller is a global admin, otherwise returns null so the route can respond
 * with 403 (kept as a non-throwing sentinel to preserve the existing admin
 * route shape). A global admin is NOT scoped to any single organization, so
 * these endpoints intentionally bypass the per-org UserOrgRole check.
 */
export async function requireGlobalAdmin() {
  const session = await auth()
  if (!session?.user?.isGlobalAdmin) {
    return null
  }
  return session
}
