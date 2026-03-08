-- =============================================================================
-- Migration: Integracao Nativa Meta (Facebook/Instagram)
-- Cria: channel_messages, meta_connections, meta_pages
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enum de canal
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE channel_type AS ENUM ('whatsapp', 'instagram', 'messenger');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Tabela channel_messages (substitui whatsapp_messages)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS channel_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Canal e origem
  channel channel_type NOT NULL DEFAULT 'whatsapp',
  instance_id UUID REFERENCES whatsapp_instances(id) ON DELETE SET NULL,  -- WhatsApp only
  page_id TEXT,  -- Meta page_id (Messenger/Instagram)

  -- Identificacao da mensagem
  external_id TEXT NOT NULL,  -- message_id da plataforma de origem
  remote_jid TEXT,  -- WhatsApp JID (mantido para compatibilidade)

  -- Contato
  phone_number TEXT,  -- Normalizado, para WhatsApp e match com leads
  sender_id TEXT,  -- PSID (Messenger) ou IGSID (Instagram)
  sender_name TEXT,  -- push_name (WhatsApp) ou nome do perfil (Meta)
  sender_profile_pic TEXT,  -- URL da foto do perfil (Meta)

  -- Conteudo
  direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  message_type TEXT NOT NULL DEFAULT 'text',  -- text, image, audio, video, document, sticker
  content TEXT,
  media_url TEXT,

  -- Status
  status TEXT DEFAULT 'received' CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'received', 'failed')),

  -- Associacao
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,

  -- Timestamps
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Dados completos
  raw_payload JSONB,

  -- Unique: external_id + channel + org (evita duplicatas)
  UNIQUE(external_id, channel, organization_id)
);

-- Indexes para performance
CREATE INDEX IF NOT EXISTS idx_channel_messages_org ON channel_messages(organization_id);
CREATE INDEX IF NOT EXISTS idx_channel_messages_org_channel ON channel_messages(organization_id, channel);
CREATE INDEX IF NOT EXISTS idx_channel_messages_phone ON channel_messages(phone_number);
CREATE INDEX IF NOT EXISTS idx_channel_messages_sender ON channel_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_channel_messages_lead ON channel_messages(lead_id);
CREATE INDEX IF NOT EXISTS idx_channel_messages_instance ON channel_messages(instance_id);
CREATE INDEX IF NOT EXISTS idx_channel_messages_timestamp ON channel_messages(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_channel_messages_direction ON channel_messages(organization_id, direction);
CREATE INDEX IF NOT EXISTS idx_channel_messages_conversation ON channel_messages(organization_id, phone_number, channel, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_channel_messages_meta_conversation ON channel_messages(organization_id, sender_id, channel, timestamp DESC);

-- RLS
ALTER TABLE channel_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "channel_messages_org_access" ON channel_messages
  FOR ALL USING (
    organization_id = public.get_user_organization_id()
  );

CREATE POLICY "channel_messages_service_role" ON channel_messages
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE channel_messages;

-- -----------------------------------------------------------------------------
-- 3. Tabela meta_connections (OAuth do usuario com Meta)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meta_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Dados do usuario Facebook
  facebook_user_id TEXT NOT NULL,
  facebook_user_name TEXT,

  -- Token de acesso (long-lived, ~60 dias)
  access_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,

  -- Status
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'expired', 'disconnected')),

  -- Timestamps
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(organization_id, facebook_user_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_connections_org ON meta_connections(organization_id);
CREATE INDEX IF NOT EXISTS idx_meta_connections_status ON meta_connections(status);
CREATE INDEX IF NOT EXISTS idx_meta_connections_expires ON meta_connections(token_expires_at);

-- RLS
ALTER TABLE meta_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meta_connections_org_access" ON meta_connections
  FOR ALL USING (
    organization_id = public.get_user_organization_id()
  );

CREATE POLICY "meta_connections_service_role" ON meta_connections
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Trigger updated_at
CREATE OR REPLACE FUNCTION update_meta_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_meta_connections_updated_at
  BEFORE UPDATE ON meta_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_meta_connections_updated_at();

-- -----------------------------------------------------------------------------
-- 4. Tabela meta_pages (paginas Facebook + contas Instagram conectadas)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meta_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meta_connection_id UUID NOT NULL REFERENCES meta_connections(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Dados da pagina Facebook
  page_id TEXT NOT NULL,
  page_name TEXT NOT NULL,
  page_access_token TEXT NOT NULL,  -- Page-level token

  -- Instagram Business (nullable - nem toda pagina tem)
  instagram_account_id TEXT,
  instagram_username TEXT,

  -- Controle
  is_active BOOLEAN DEFAULT true,
  webhook_subscribed BOOLEAN DEFAULT false,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(organization_id, page_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_pages_org ON meta_pages(organization_id);
CREATE INDEX IF NOT EXISTS idx_meta_pages_connection ON meta_pages(meta_connection_id);
CREATE INDEX IF NOT EXISTS idx_meta_pages_page_id ON meta_pages(page_id);
CREATE INDEX IF NOT EXISTS idx_meta_pages_instagram ON meta_pages(instagram_account_id);

-- RLS
ALTER TABLE meta_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meta_pages_org_access" ON meta_pages
  FOR ALL USING (
    organization_id = public.get_user_organization_id()
  );

CREATE POLICY "meta_pages_service_role" ON meta_pages
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Trigger updated_at
CREATE OR REPLACE FUNCTION update_meta_pages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_meta_pages_updated_at
  BEFORE UPDATE ON meta_pages
  FOR EACH ROW
  EXECUTE FUNCTION update_meta_pages_updated_at();

-- -----------------------------------------------------------------------------
-- 5. Tabela meta_leadgen_configs (config de acoes pos-captura de Lead Ads)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meta_leadgen_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  meta_page_id UUID NOT NULL REFERENCES meta_pages(id) ON DELETE CASCADE,

  -- Formulario especifico (nullable = aplica a todos da pagina)
  form_id TEXT,
  form_name TEXT,

  -- Acoes pos-captura (todas opcionais)
  assign_to_campaign_id UUID REFERENCES campanhas(id) ON DELETE SET NULL,
  assign_to_pipe TEXT,  -- pipe name
  assign_to_stage TEXT,  -- stage name
  notify_team BOOLEAN DEFAULT false,
  auto_tag TEXT[],  -- tags para aplicar automaticamente

  -- Controle
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meta_leadgen_configs_org ON meta_leadgen_configs(organization_id);
CREATE INDEX IF NOT EXISTS idx_meta_leadgen_configs_page ON meta_leadgen_configs(meta_page_id);

-- RLS
ALTER TABLE meta_leadgen_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meta_leadgen_configs_org_access" ON meta_leadgen_configs
  FOR ALL USING (
    organization_id = public.get_user_organization_id()
  );

CREATE POLICY "meta_leadgen_configs_service_role" ON meta_leadgen_configs
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
