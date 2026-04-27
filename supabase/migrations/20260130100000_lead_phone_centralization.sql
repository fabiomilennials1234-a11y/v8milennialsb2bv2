-- Migration: Centralização de Leads por Telefone Normalizado
-- Objetivo: Evitar duplicatas de leads quando o mesmo número vem de instâncias diferentes

-- =====================================================
-- FASE 1: Função de Normalização de Telefone Brasileiro
-- =====================================================

CREATE OR REPLACE FUNCTION normalize_brazilian_phone(phone TEXT)
RETURNS TEXT AS $$
DECLARE
  cleaned TEXT;
BEGIN
  -- Se nulo ou vazio, retornar nulo
  IF phone IS NULL OR phone = '' THEN
    RETURN NULL;
  END IF;

  -- Remove tudo que não é dígito
  cleaned := regexp_replace(phone, '\D', '', 'g');

  -- Se vazio após limpeza, retornar nulo
  IF cleaned = '' THEN
    RETURN NULL;
  END IF;

  -- Remover prefixo internacional +55 ou 55 se presente (12+ dígitos)
  IF length(cleaned) >= 12 AND left(cleaned, 2) = '55' THEN
    cleaned := substring(cleaned from 3);
  END IF;

  -- Adicionar 9 se número celular de 8 dígitos (DDD + 8 dígitos = 10 dígitos)
  -- Celulares brasileiros: DDD(2) + 9(1) + número(8) = 11 dígitos
  IF length(cleaned) = 10 THEN
    -- Inserir 9 após o DDD
    cleaned := left(cleaned, 2) || '9' || substring(cleaned from 3);
  END IF;

  -- Formato final: 11 dígitos (DDD + 9 + 8 dígitos) para celular brasileiro
  -- Ou 10 dígitos para fixo (DDD + 8 dígitos)
  RETURN cleaned;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION normalize_brazilian_phone IS 'Normaliza telefone brasileiro removendo formatação e padronizando para 11 dígitos (celular) ou 10 (fixo)';

-- =====================================================
-- FASE 2: Adicionar Coluna de Telefone Normalizado
-- =====================================================

-- Adicionar coluna de telefone normalizado (se não existir)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leads' AND column_name = 'normalized_phone'
  ) THEN
    ALTER TABLE leads ADD COLUMN normalized_phone TEXT;
  END IF;
END $$;

-- =====================================================
-- FASE 3: Trigger para Auto-Normalizar
-- =====================================================

-- Função do trigger
CREATE OR REPLACE FUNCTION trigger_normalize_lead_phone()
RETURNS TRIGGER AS $$
BEGIN
  -- Sempre normaliza quando phone é inserido ou atualizado
  NEW.normalized_phone := normalize_brazilian_phone(NEW.phone);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Remove trigger existente (se houver) e cria novo
DROP TRIGGER IF EXISTS leads_normalize_phone_trigger ON leads;

CREATE TRIGGER leads_normalize_phone_trigger
BEFORE INSERT OR UPDATE OF phone ON leads
FOR EACH ROW
EXECUTE FUNCTION trigger_normalize_lead_phone();

-- =====================================================
-- FASE 4: Popular Dados Existentes
-- =====================================================

-- Normalizar telefones de leads existentes
UPDATE leads
SET normalized_phone = normalize_brazilian_phone(phone)
WHERE phone IS NOT NULL AND normalized_phone IS NULL;

-- =====================================================
-- FASE 5: Índice para Busca Eficiente
-- =====================================================

-- Índice composto para busca rápida (organization_id + normalized_phone)
CREATE INDEX IF NOT EXISTS idx_leads_org_normalized_phone
ON leads(organization_id, normalized_phone)
WHERE normalized_phone IS NOT NULL;

-- =====================================================
-- FASE 6: Tabela de Auditoria de Duplicatas
-- =====================================================

-- Criar tabela para registrar duplicatas encontradas (para revisão manual)
CREATE TABLE IF NOT EXISTS _lead_duplicates_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id),
  normalized_phone TEXT NOT NULL,
  lead_ids UUID[] NOT NULL,
  lead_names TEXT[] NOT NULL,
  lead_created_dates TIMESTAMPTZ[] NOT NULL,
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT
);

-- Identificar e registrar duplicatas existentes
INSERT INTO _lead_duplicates_audit (organization_id, normalized_phone, lead_ids, lead_names, lead_created_dates)
SELECT
  organization_id,
  normalized_phone,
  array_agg(id ORDER BY created_at),
  array_agg(name ORDER BY created_at),
  array_agg(created_at ORDER BY created_at)
FROM leads
WHERE normalized_phone IS NOT NULL
GROUP BY organization_id, normalized_phone
HAVING COUNT(*) > 1
ON CONFLICT DO NOTHING;

-- Log de quantas duplicatas encontradas
DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM _lead_duplicates_audit WHERE resolved_at IS NULL;
  IF dup_count > 0 THEN
    RAISE NOTICE '[LEAD CENTRALIZATION] Found % phone duplicates for manual review. Query _lead_duplicates_audit table.', dup_count;
  ELSE
    RAISE NOTICE '[LEAD CENTRALIZATION] No phone duplicates found. Safe to enable UNIQUE constraint.';
  END IF;
END $$;

-- =====================================================
-- FASE 7: Constraint UNIQUE (COMENTADO - habilitar após resolver duplicatas)
-- =====================================================

-- IMPORTANTE: Só descomente após resolver todas as duplicatas na tabela _lead_duplicates_audit
--
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_org_phone_unique
-- ON leads(organization_id, normalized_phone)
-- WHERE normalized_phone IS NOT NULL;

-- =====================================================
-- VERIFICAÇÃO FINAL
-- =====================================================

-- Mostrar estatísticas
DO $$
DECLARE
  total_leads INTEGER;
  leads_with_phone INTEGER;
  leads_normalized INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_leads FROM leads;
  SELECT COUNT(*) INTO leads_with_phone FROM leads WHERE phone IS NOT NULL;
  SELECT COUNT(*) INTO leads_normalized FROM leads WHERE normalized_phone IS NOT NULL;

  RAISE NOTICE '[LEAD CENTRALIZATION] Migration complete:';
  RAISE NOTICE '  - Total leads: %', total_leads;
  RAISE NOTICE '  - Leads with phone: %', leads_with_phone;
  RAISE NOTICE '  - Leads normalized: %', leads_normalized;
END $$;
