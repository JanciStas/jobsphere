-- CMS: static pages, FAQ, text overrides, blog, announcements, career pages (additive, idempotent).
-- Apply with `prisma db execute --file` or paste into the Neon SQL editor.
-- Never `migrate deploy` / `db push` against production. Safe to run more than once.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CmsStatus') THEN
    CREATE TYPE "CmsStatus" AS ENUM ('DRAFT', 'PUBLISHED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "CmsPage" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "locale" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "seoTitle" TEXT,
  "seoDescription" TEXT,
  "status" "CmsStatus" NOT NULL DEFAULT 'DRAFT',
  "publishedAt" TIMESTAMP(3),
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CmsPage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CmsPage_slug_locale_key" ON "CmsPage"("slug", "locale");
CREATE INDEX IF NOT EXISTS "CmsPage_status_idx" ON "CmsPage"("status");

CREATE TABLE IF NOT EXISTS "CmsFaqItem" (
  "id" TEXT NOT NULL,
  "locale" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'general',
  "question" TEXT NOT NULL,
  "answer" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "published" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CmsFaqItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CmsFaqItem_locale_published_sortOrder_idx" ON "CmsFaqItem"("locale", "published", "sortOrder");

CREATE TABLE IF NOT EXISTS "CmsText" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "locale" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CmsText_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CmsText_key_locale_key" ON "CmsText"("key", "locale");

CREATE TABLE IF NOT EXISTS "BlogCategory" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "names" JSONB NOT NULL DEFAULT '{}',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BlogCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "BlogCategory_slug_key" ON "BlogCategory"("slug");

CREATE TABLE IF NOT EXISTS "BlogPost" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "locale" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "excerpt" TEXT,
  "body" TEXT NOT NULL,
  "coverImage" TEXT,
  "categoryId" TEXT,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "seoTitle" TEXT,
  "seoDescription" TEXT,
  "status" "CmsStatus" NOT NULL DEFAULT 'DRAFT',
  "publishedAt" TIMESTAMP(3),
  "authorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BlogPost_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "BlogPost_slug_locale_key" ON "BlogPost"("slug", "locale");
CREATE INDEX IF NOT EXISTS "BlogPost_locale_status_publishedAt_idx" ON "BlogPost"("locale", "status", "publishedAt");
CREATE INDEX IF NOT EXISTS "BlogPost_categoryId_idx" ON "BlogPost"("categoryId");

CREATE TABLE IF NOT EXISTS "SiteAnnouncement" (
  "id" TEXT NOT NULL,
  "message" JSONB NOT NULL DEFAULT '{}',
  "linkUrl" TEXT,
  "linkLabel" JSONB NOT NULL DEFAULT '{}',
  "variant" TEXT NOT NULL DEFAULT 'info',
  "audience" TEXT NOT NULL DEFAULT 'all',
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT false,
  "dismissible" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SiteAnnouncement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SiteAnnouncement_active_idx" ON "SiteAnnouncement"("active");

CREATE TABLE IF NOT EXISTS "CareerPage" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "published" BOOLEAN NOT NULL DEFAULT false,
  "headline" TEXT,
  "subheadline" TEXT,
  "about" TEXT,
  "benefits" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "coverImage" TEXT,
  "brandColor" TEXT,
  "videoUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CareerPage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CareerPage_orgId_key" ON "CareerPage"("orgId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BlogPost_categoryId_fkey') THEN
    ALTER TABLE "BlogPost"
      ADD CONSTRAINT "BlogPost_categoryId_fkey"
      FOREIGN KEY ("categoryId") REFERENCES "BlogCategory"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CareerPage_orgId_fkey') THEN
    ALTER TABLE "CareerPage"
      ADD CONSTRAINT "CareerPage_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
