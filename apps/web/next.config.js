import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n.ts')

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  swcMinify: true,
  transpilePackages: ['@jobsphere/db'],

  images: {
    // `images.domains` is deprecated in Next 14 — the former entry ['jobsphere.com']
    // is folded into remotePatterns below with no change to the allowed host set.
    // Company logos are stored in Vercel Blob (public bucket) — allow next/image
    // to optimize them. The blob host is already whitelisted in the CSP img-src.
    remotePatterns: [
      { protocol: 'https', hostname: '*.public.blob.vercel-storage.com' },
      { protocol: 'https', hostname: 'jobsphere.com' },
    ],
    formats: ['image/avif', 'image/webp'],
  },

  async headers() {
    // These static headers are applied to all paths (including API routes and
    // _next/static assets). Page routes ALSO pass through middleware, which sets
    // its own Content-Security-Policy. The two CSP sources MUST agree on
    // `script-src` — when they disagree the browser combines them (most
    // restrictive wins), and a stray `'strict-dynamic'` here would override the
    // middleware's `'unsafe-inline'` on page documents, stripping the nonce-less
    // bootstrap scripts of permission to run → blank production app (SEC-005 / F2).
    //
    // SEC-005 is deferred: a correctly-propagated, preview-verified nonce policy
    // has not landed yet (next-intl middleware does not forward the per-request
    // nonce to the App Router render). Until it does, BOTH this header and
    // middleware.ts keep `'unsafe-inline'` for scripts in production. Do not
    // reintroduce `'strict-dynamic'` in only one of the two places.
    const isDev = process.env.NODE_ENV === 'development'
    const scriptSrc = isDev
      ? "'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://browser.sentry-cdn.com https://js.sentry-cdn.com https://accounts.google.com https://vercel.live"
      : "'self' 'unsafe-inline' https://js.stripe.com https://browser.sentry-cdn.com https://js.sentry-cdn.com https://accounts.google.com https://vercel.live"

    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              `script-src ${scriptSrc}`,
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com https://lh3.googleusercontent.com https://avatars.githubusercontent.com https://*.stripe.com",
              "font-src 'self' data: https://fonts.gstatic.com",
              "connect-src 'self' https://api.stripe.com https://api.anthropic.com https://api.openai.com https://api.voyageai.com https://*.sentry.io https://*.ingest.sentry.io https://vitals.vercel-insights.com https://graph.microsoft.com https://login.microsoftonline.com",
              "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://vercel.live",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              'upgrade-insecure-requests',
              'block-all-mixed-content',
            ].join('; '),
          },
        ],
      },
    ]
  },

  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
    // Rewrite barrel-file imports to deep per-module imports so only the icons /
    // helpers / chart pieces actually used end up in the client bundle.
    // lucide-react alone is imported at ~82 call sites.
    //
    // NOTE: on Next 14.2 all three of these are ALREADY in the framework's default
    // optimizePackageImports list (node_modules/next/dist/server/config.js:586-609),
    // and user entries are merged into that set — so this line currently changes
    // nothing measurable (verified: "First Load JS shared by all" is 87.7 kB with
    // and without it). It is kept as an explicit, version-independent declaration
    // so the optimization survives a future Next release trimming its defaults.
    optimizePackageImports: ['lucide-react', 'date-fns', 'recharts'],
  },

  webpack: (config, { isServer }) => {
    config.resolve.alias.canvas = false

    // Fix for pdf-parse and pdfjs-dist in Next.js
    if (isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        'pdfjs-dist': false,
      }
    }

    // Note: pdf-parse and canvas are handled via resolve.alias above.
    // Do NOT add them to config.externals — pdf-parse v2 is ESM-only
    // and externalizing it causes ERR_REQUIRE_ESM at runtime on Vercel.

    return config
  },
}

export default withNextIntl(nextConfig)
