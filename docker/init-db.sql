-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- Create custom types
CREATE TYPE user_role AS ENUM ('ORG_ADMIN', 'RECRUITER', 'HIRING_MANAGER', 'AGENCY', 'CANDIDATE', 'SUPER_ADMIN');
CREATE TYPE job_status AS ENUM ('DRAFT', 'PUBLISHED', 'PAUSED', 'CLOSED', 'ARCHIVED');
CREATE TYPE application_stage AS ENUM ('NEW', 'SCREENING', 'PHONE', 'TECHNICAL', 'ONSITE', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN');
CREATE TYPE employment_type AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'FREELANCE', 'INTERNSHIP');
CREATE TYPE seniority_level AS ENUM ('ENTRY', 'MID', 'SENIOR', 'LEAD', 'PRINCIPAL', 'EXECUTIVE');
CREATE TYPE email_provider AS ENUM ('GRAPH', 'GMAIL', 'IMAP', 'SMTP');
CREATE TYPE subscription_status AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'UNPAID', 'INCOMPLETE');

-- Create audit function for timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create audit log table
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID,
    org_id UUID,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100),
    entity_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_audit_user_id (user_id),
    INDEX idx_audit_org_id (org_id),
    INDEX idx_audit_entity (entity_type, entity_id),
    INDEX idx_audit_created_at (created_at DESC)
);

-- Create function for RLS context
CREATE OR REPLACE FUNCTION current_user_id() RETURNS UUID AS $$
BEGIN
    RETURN current_setting('app.current_user_id', true)::UUID;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION current_org_id() RETURNS UUID AS $$
BEGIN
    RETURN current_setting('app.current_org_id', true)::UUID;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION current_user_role() RETURNS user_role AS $$
BEGIN
    RETURN current_setting('app.current_user_role', true)::user_role;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Enable Row Level Security for all tables (will be created by Prisma)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO PUBLIC;

-- Create helper function for org membership check
CREATE OR REPLACE FUNCTION is_org_member(check_org_id UUID, check_user_id UUID DEFAULT current_user_id())
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM user_org_roles
        WHERE org_id = check_org_id
        AND user_id = check_user_id
        AND deleted_at IS NULL
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create helper function for role check
CREATE OR REPLACE FUNCTION has_role(required_role user_role, check_org_id UUID DEFAULT current_org_id())
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM user_org_roles
        WHERE org_id = check_org_id
        AND user_id = current_user_id()
        AND role = required_role
        AND deleted_at IS NULL
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create helper function for feature entitlement check
CREATE OR REPLACE FUNCTION has_entitlement(feature_key VARCHAR, check_org_id UUID DEFAULT current_org_id())
RETURNS BOOLEAN AS $$
DECLARE
    entitlement_record RECORD;
BEGIN
    SELECT * INTO entitlement_record
    FROM entitlements
    WHERE org_id = check_org_id
    AND feature_key = feature_key
    AND (limit_int IS NULL OR remaining_int > 0)
    AND deleted_at IS NULL;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_gin_jobs_search ON jobs USING gin(
    to_tsvector('english', title || ' ' || COALESCE(description, ''))
);

CREATE INDEX IF NOT EXISTS idx_gin_candidates_search ON candidate_documents USING gin(
    to_tsvector('english', COALESCE(parsed_text, ''))
);

-- Create materialized view for application inbox
CREATE MATERIALIZED VIEW IF NOT EXISTS application_inbox AS
SELECT
    a.id,
    a.job_id,
    a.candidate_id,
    a.org_id,
    a.stage,
    a.score,
    a.assigned_to,
    a.tags,
    a.source,
    a.last_contact_at,
    a.created_at,
    a.updated_at,
    c.full_name as candidate_name,
    c.email as candidate_email,
    c.location as candidate_location,
    COALESCE(ms.score_0_to_100, 0) as match_percent,
    aa.status as assessment_status,
    aa.total_score as assessment_score,
    EXTRACT(YEAR FROM AGE(CURRENT_DATE, c.first_experience_date)) as years_of_experience
FROM applications a
LEFT JOIN candidates c ON c.id = a.candidate_id
LEFT JOIN match_scores ms ON ms.job_id = a.job_id AND ms.candidate_id = a.candidate_id
LEFT JOIN assessment_attempts aa ON aa.candidate_id = a.candidate_id AND aa.job_id = a.job_id
WHERE a.deleted_at IS NULL;

CREATE UNIQUE INDEX ON application_inbox (id);
CREATE INDEX ON application_inbox (job_id, stage);
CREATE INDEX ON application_inbox (org_id, created_at DESC);

-- Create function to refresh materialized view
CREATE OR REPLACE FUNCTION refresh_application_inbox()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY application_inbox;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT USAGE ON SCHEMA public TO PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO PUBLIC;