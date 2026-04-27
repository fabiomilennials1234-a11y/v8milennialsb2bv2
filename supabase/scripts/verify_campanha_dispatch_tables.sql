-- Verificação: tabelas e coluna de regras de envio por etapa
-- Execute no SQL Editor do Supabase (Database → SQL Editor).
-- Se retornar 3 linhas em (1) e 1 linha em (2), as migrations foram aplicadas.

-- (1) Tabelas existentes
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'campanha_dispatch_rules',
    'campanha_dispatch_rule_steps',
    'scheduled_campaign_messages'
  )
ORDER BY table_name;

-- (2) Coluna whatsapp_instance_id em campanhas
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'campanhas'
  AND column_name = 'whatsapp_instance_id';
