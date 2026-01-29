-- Migration: Google Calendar OAuth Integration Tables
-- Created: 2026-01-26
-- Description: Creates tables for storing Google Calendar OAuth tokens and sync logs

-- ============================================================================
-- Table: google_calendar_tokens
-- Purpose: Store encrypted OAuth tokens per user for Google Calendar access
-- ============================================================================

CREATE TABLE IF NOT EXISTS google_calendar_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id),

    -- Google account info (display only, not sensitive)
    google_email TEXT NOT NULL,
    google_account_id TEXT NOT NULL,

    -- Encrypted tokens (AES-256-GCM)
    encrypted_refresh_token TEXT NOT NULL,
    encryption_nonce TEXT NOT NULL,
    encryption_key_id TEXT NOT NULL,

    -- Token metadata
    access_token_expires_at TIMESTAMPTZ,
    scopes_granted TEXT[] NOT NULL DEFAULT '{}',

    -- Connection status
    is_active BOOLEAN DEFAULT true,
    last_sync_at TIMESTAMPTZ,
    last_error TEXT,

    -- Audit timestamps
    connected_at TIMESTAMPTZ DEFAULT now(),
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    -- Constraints
    CONSTRAINT unique_user_calendar UNIQUE(user_id),
    CONSTRAINT unique_google_account UNIQUE(google_account_id)
);

-- Indexes for quick lookups
CREATE INDEX IF NOT EXISTS idx_google_calendar_tokens_user
    ON google_calendar_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_google_calendar_tokens_org
    ON google_calendar_tokens(organization_id);
CREATE INDEX IF NOT EXISTS idx_google_calendar_tokens_active
    ON google_calendar_tokens(is_active) WHERE is_active = true;

-- Enable Row Level Security
ALTER TABLE google_calendar_tokens ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can view their own token info (but not the encrypted token itself)
CREATE POLICY "Users can view own connection status"
    ON google_calendar_tokens FOR SELECT
    USING (auth.uid() = user_id);

-- Only service role can insert/update/delete (microservice uses service role key)
CREATE POLICY "Service role full access"
    ON google_calendar_tokens FOR ALL
    USING (auth.role() = 'service_role');

-- ============================================================================
-- Table: google_calendar_sync_logs
-- Purpose: Audit trail for all calendar operations (for debugging and analytics)
-- ============================================================================

CREATE TABLE IF NOT EXISTS google_calendar_sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Operation details
    operation TEXT NOT NULL CHECK (operation IN (
        'create_event',
        'update_event',
        'delete_event',
        'sync',
        'token_refresh',
        'connection',
        'revocation'
    )),

    -- Google event reference
    google_event_id TEXT,

    -- Local entity reference (for linking to pipe_confirmacao, follow_ups, etc.)
    local_reference_id UUID,
    local_reference_type TEXT CHECK (local_reference_type IN (
        'pipe_confirmacao',
        'follow_up',
        'proposal',
        'lead',
        NULL
    )),

    -- Operation result
    status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'pending')),
    error_message TEXT,

    -- Request/response payloads for debugging
    request_payload JSONB,
    response_payload JSONB,

    -- Who initiated the operation
    initiated_by TEXT NOT NULL CHECK (initiated_by IN ('user', 'ai_agent', 'system')),
    agent_id UUID REFERENCES copilot_agents(id),

    -- Timestamp
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_calendar_sync_logs_user
    ON google_calendar_sync_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_sync_logs_operation
    ON google_calendar_sync_logs(operation);
CREATE INDEX IF NOT EXISTS idx_calendar_sync_logs_status
    ON google_calendar_sync_logs(status);
CREATE INDEX IF NOT EXISTS idx_calendar_sync_logs_created
    ON google_calendar_sync_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calendar_sync_logs_reference
    ON google_calendar_sync_logs(local_reference_type, local_reference_id);
CREATE INDEX IF NOT EXISTS idx_calendar_sync_logs_agent
    ON google_calendar_sync_logs(agent_id) WHERE agent_id IS NOT NULL;

-- Enable Row Level Security
ALTER TABLE google_calendar_sync_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own sync logs"
    ON google_calendar_sync_logs FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Service role full access on sync logs"
    ON google_calendar_sync_logs FOR ALL
    USING (auth.role() = 'service_role');

-- ============================================================================
-- Trigger: Update updated_at timestamp
-- ============================================================================

-- Ensure the trigger function exists (may already exist from other migrations)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to google_calendar_tokens
DROP TRIGGER IF EXISTS update_google_calendar_tokens_updated_at ON google_calendar_tokens;
CREATE TRIGGER update_google_calendar_tokens_updated_at
    BEFORE UPDATE ON google_calendar_tokens
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Comments for documentation
-- ============================================================================

COMMENT ON TABLE google_calendar_tokens IS
    'Stores encrypted OAuth refresh tokens for Google Calendar integration per user';

COMMENT ON COLUMN google_calendar_tokens.encrypted_refresh_token IS
    'AES-256-GCM encrypted refresh token - NEVER expose in API responses';

COMMENT ON COLUMN google_calendar_tokens.encryption_nonce IS
    'Nonce used for AES-GCM encryption - required for decryption';

COMMENT ON COLUMN google_calendar_tokens.encryption_key_id IS
    'Key version identifier for key rotation support';

COMMENT ON TABLE google_calendar_sync_logs IS
    'Audit trail for all Google Calendar operations for debugging and analytics';

COMMENT ON COLUMN google_calendar_sync_logs.initiated_by IS
    'Who triggered the operation: user (direct action), ai_agent (copilot), or system (automated)';
