-- ============================================
-- Migração: Adicionar configuração de delay aleatório para envios WhatsApp
-- 
-- Objetivo: Evitar detecção de disparo em massa pela API não oficial do WhatsApp
-- adicionando delay aleatório entre 30 segundos e 1,5 minutos entre mensagens.
-- ============================================

-- Atualizar o valor padrão do whatsapp_rate_limit para incluir delay_min_ms e delay_max_ms
-- Nota: Isso não afeta organizações existentes que já têm valores configurados

COMMENT ON COLUMN public.organizations.whatsapp_rate_limit IS 
  'Limites de envio WhatsApp: max_per_hour, max_per_day, delay_min_ms (mínimo entre msgs), delay_max_ms (máximo entre msgs)';

-- Atualizar organizações existentes para incluir os novos campos de delay aleatório
-- Mantém os valores existentes de max_per_hour e max_per_day
UPDATE public.organizations
SET whatsapp_rate_limit = whatsapp_rate_limit || jsonb_build_object(
  'delay_min_ms', 30000,  -- 30 segundos mínimo
  'delay_max_ms', 90000   -- 90 segundos (1.5 minutos) máximo
)
WHERE whatsapp_rate_limit IS NOT NULL
  AND NOT (whatsapp_rate_limit ? 'delay_min_ms');

-- Para organizações que ainda não têm whatsapp_rate_limit configurado, 
-- definir o valor padrão completo
UPDATE public.organizations
SET whatsapp_rate_limit = '{
  "max_per_hour": 100,
  "max_per_day": 500,
  "delay_min_ms": 30000,
  "delay_max_ms": 90000
}'::jsonb
WHERE whatsapp_rate_limit IS NULL;

-- Alterar o valor DEFAULT da coluna para novos registros
ALTER TABLE public.organizations
ALTER COLUMN whatsapp_rate_limit SET DEFAULT '{
  "max_per_hour": 100,
  "max_per_day": 500,
  "delay_min_ms": 30000,
  "delay_max_ms": 90000
}'::jsonb;
