-- Index the Task -> Candidate foreign key.
--
-- Task.candidateId is `ON DELETE CASCADE`, so deleting (or GDPR-erasing) a
-- candidate has to find that candidate's tasks. With no index it sequentially
-- scanned the whole Task table for every deleted candidate.
--
-- Idempotent: production takes schema through `db push`, so the index may
-- already exist. Apply with `prisma db execute --file`, never `migrate deploy`.
CREATE INDEX IF NOT EXISTS "Task_candidateId_idx" ON "Task"("candidateId");
