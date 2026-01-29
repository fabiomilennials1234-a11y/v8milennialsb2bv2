-- ============================================
-- TABELA DE INSTÂNCIAS WHATSAPP (EVOLUTION API)
-- ============================================
-- Migration: Add WhatsApp Instances Support
-- Data: 2026-01-24
-- Descrição: Adiciona suporte para gerenciar instâncias WhatsApp via Evolution API

CREATE TABLE IF NOT EXISTS whatsapp_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  instance_name TEXT NOT NULL,
  instance_id TEXT, -- ID retornado pela Evolution API
  status TEXT NOT NULL DEFAULT 'disconnected' 
    CHECK (status IN ('disconnected', 'connecting', 'connected', 'error')),
  phone_number TEXT,
  qr_code TEXT, -- Base64 do QR code
  qr_code_expires_at TIMESTAMPTZ,
  last_connection_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb, -- Dados adicionais da Evolution API
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, instance_name)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_org ON whatsapp_instances(organization_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_status ON whatsapp_instances(status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_instance_name ON whatsapp_instances(instance_name);

-- Comentários
COMMENT ON TABLE whatsapp_instances IS 'Instâncias WhatsApp conectadas via Evolution API';
COMMENT ON COLUMN whatsapp_instances.instance_name IS 'Nome único da instância na Evolution API';
COMMENT ON COLUMN whatsapp_instances.status IS 'Status da conexão: disconnected, connecting, connected, error';
COMMENT ON COLUMN whatsapp_instances.qr_code IS 'QR code em base64 para conexão';
COMMENT ON COLUMN whatsapp_instances.qr_code_expires_at IS 'Data de expiração do QR code';

-- Trigger para updated_at
CREATE TRIGGER update_whatsapp_instances_updated_at
  BEFORE UPDATE ON whatsapp_instances
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Habilitar RLS
ALTER TABLE whatsapp_instances ENABLE ROW LEVEL SECURITY;

-- Políticas RLS
CREATE POLICY "Users can see WhatsApp instances from their organization"
  ON whatsapp_instances FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM team_members 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert WhatsApp instances in their organization"
  ON whatsapp_instances FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id 
      FROM team_members 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update WhatsApp instances in their organization"
  ON whatsapp_instances FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM team_members 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete WhatsApp instances in their organization"
  ON whatsapp_instances FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM team_members 
      WHERE user_id = auth.uid()
    )
  );
