-- Freelancer portfolio items (additive, idempotent).
-- Apply with `prisma db execute --file`, never `migrate deploy` / `db push` against production.
CREATE TABLE IF NOT EXISTS "PortfolioItem" (
  "id" TEXT NOT NULL,
  "freelancerId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "url" TEXT,
  "imageUrl" TEXT,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PortfolioItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PortfolioItem_freelancerId_idx" ON "PortfolioItem"("freelancerId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PortfolioItem_freelancerId_fkey'
  ) THEN
    ALTER TABLE "PortfolioItem"
      ADD CONSTRAINT "PortfolioItem_freelancerId_fkey"
      FOREIGN KEY ("freelancerId") REFERENCES "FreelancerProfile"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
