-- Migration: SZ.chat (Alamaster) Integration Tables
-- These tables are used exclusively by edge functions via service_role.
-- RLS is enabled with NO policies, which means all access is denied to
-- regular roles; only service_role (which bypasses RLS) can read/write.

-- ---------------------------------------------------------------------------
-- Table 1: sz_chat_config
-- Stores SZ.chat API configuration per organization (one row per org).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sz_chat_config (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  api_url              TEXT        NOT NULL DEFAULT 'https://alamaster.sz.chat/api/v4',
  api_token            TEXT,
  channel_id           TEXT,
  whatsapp_instance_id UUID        REFERENCES public.whatsapp_instances(id) ON DELETE SET NULL,
  team_mappings        JSONB       DEFAULT '{}',
  webhook_secret       TEXT,
  is_active            BOOLEAN     DEFAULT true,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now(),
  UNIQUE(organization_id)
);

-- ---------------------------------------------------------------------------
-- Table 2: sz_chat_sessions
-- Tracks active SZ.chat sessions mapped to our leads.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sz_chat_sessions (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sz_chat_session_id    TEXT        NOT NULL,
  lead_id               UUID        REFERENCES public.leads(id) ON DELETE SET NULL,
  phone_number          TEXT        NOT NULL,
  contact_name          TEXT,
  sz_chat_contact_id    TEXT,
  sz_chat_channel_id    TEXT,
  sz_chat_platform      TEXT        DEFAULT 'WhatsApp',
  status                TEXT        DEFAULT 'active'
                                    CHECK (status IN ('active', 'finished', 'transferred_back')),
  transferred_from_team TEXT,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE(sz_chat_session_id, organization_id)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX idx_sz_chat_config_org      ON public.sz_chat_config(organization_id);
CREATE INDEX idx_sz_chat_sessions_org    ON public.sz_chat_sessions(organization_id);
CREATE INDEX idx_sz_chat_sessions_lead   ON public.sz_chat_sessions(lead_id);
CREATE INDEX idx_sz_chat_sessions_phone  ON public.sz_chat_sessions(phone_number);
CREATE INDEX idx_sz_chat_sessions_session ON public.sz_chat_sessions(sz_chat_session_id);
-- Partial index: fast lookup of sessions that are still active
CREATE INDEX idx_sz_chat_sessions_active ON public.sz_chat_sessions(status) WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- Row Level Security
-- Enabled with NO policies → only service_role (bypasses RLS) can access.
-- ---------------------------------------------------------------------------
ALTER TABLE public.sz_chat_config    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sz_chat_sessions  ENABLE ROW LEVEL SECURITY;
