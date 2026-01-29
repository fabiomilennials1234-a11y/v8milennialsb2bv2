-- WhatsApp Messages Table
-- Armazena histórico de mensagens do WhatsApp

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  instance_id UUID REFERENCES whatsapp_instances(id) ON DELETE SET NULL,

  -- Identificação da mensagem
  message_id TEXT NOT NULL,
  remote_jid TEXT NOT NULL,
  phone_number TEXT NOT NULL,

  -- Conteúdo
  direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  message_type TEXT NOT NULL DEFAULT 'text',
  content TEXT,
  media_url TEXT,

  -- Info do remetente
  push_name TEXT,

  -- Status
  status TEXT DEFAULT 'received' CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'received', 'failed')),

  -- Associação com lead
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,

  -- Timestamps
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Payload completo
  raw_payload JSONB,

  -- Evitar duplicados
  UNIQUE(message_id, instance_id)
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_org ON whatsapp_messages(organization_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_phone ON whatsapp_messages(phone_number);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_lead ON whatsapp_messages(lead_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_instance ON whatsapp_messages(instance_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_direction ON whatsapp_messages(direction, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_timestamp ON whatsapp_messages(timestamp DESC);

-- RLS
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;

-- Policy: Usuários podem ver mensagens da sua organização
CREATE POLICY "Users can view messages from their organization"
  ON whatsapp_messages FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id
      FROM team_members
      WHERE user_id = auth.uid()
    )
  );

-- Policy: Usuários podem inserir mensagens na sua organização
CREATE POLICY "Users can insert messages in their organization"
  ON whatsapp_messages FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id
      FROM team_members
      WHERE user_id = auth.uid()
    )
  );

-- Policy: Usuários podem atualizar mensagens da sua organização
CREATE POLICY "Users can update messages in their organization"
  ON whatsapp_messages FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id
      FROM team_members
      WHERE user_id = auth.uid()
    )
  );

-- Policy: Service role pode fazer tudo (para webhooks)
CREATE POLICY "Service role full access"
  ON whatsapp_messages FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Habilitar realtime para atualizações em tempo real
ALTER PUBLICATION supabase_realtime ADD TABLE whatsapp_messages;

-- Comentários
COMMENT ON TABLE whatsapp_messages IS 'Histórico de mensagens do WhatsApp via Evolution API';
COMMENT ON COLUMN whatsapp_messages.direction IS 'incoming = recebida, outgoing = enviada';
COMMENT ON COLUMN whatsapp_messages.message_type IS 'text, image, audio, video, document';
COMMENT ON COLUMN whatsapp_messages.status IS 'pending, sent, delivered, read, received, failed';
