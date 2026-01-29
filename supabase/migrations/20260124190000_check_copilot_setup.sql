-- Script de Diagnóstico do Copilot
-- Execute este SQL no Supabase Dashboard → SQL Editor para verificar a configuração

-- 1. Verificar se existe agente ativo e padrão
SELECT 
  'AGENTES COPILOT' as categoria,
  id,
  name,
  is_active,
  is_default,
  template_type,
  CASE 
    WHEN is_active = true AND is_default = true THEN '✅ OK - Pronto para uso'
    WHEN is_active = true AND is_default = false THEN '⚠️ Ativo mas não é padrão'
    WHEN is_active = false AND is_default = true THEN '⚠️ Padrão mas desativado'
    ELSE '❌ Desativado'
  END as status
FROM copilot_agents;

-- 2. Verificar se a tabela conversations existe
SELECT 
  'TABELA CONVERSATIONS' as categoria,
  CASE 
    WHEN EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'conversations') 
    THEN '✅ Existe' 
    ELSE '❌ NÃO EXISTE - Execute a migração!' 
  END as status;

-- 3. Verificar se a tabela conversation_messages existe
SELECT 
  'TABELA CONVERSATION_MESSAGES' as categoria,
  CASE 
    WHEN EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'conversation_messages') 
    THEN '✅ Existe' 
    ELSE '❌ NÃO EXISTE - Execute a migração!' 
  END as status;

-- 4. Contar leads existentes
SELECT 
  'LEADS' as categoria,
  COUNT(*) as total,
  CASE WHEN COUNT(*) > 0 THEN '✅ Tem leads' ELSE '⚠️ Nenhum lead' END as status
FROM leads;

-- 5. Verificar instâncias WhatsApp conectadas
SELECT 
  'INSTANCIAS WHATSAPP' as categoria,
  id,
  instance_name,
  connection_state,
  CASE 
    WHEN connection_state = 'open' THEN '✅ Conectada'
    ELSE '⚠️ ' || COALESCE(connection_state, 'desconhecido')
  END as status
FROM whatsapp_instances;

-- 6. Últimas mensagens recebidas
SELECT 
  'ULTIMAS MENSAGENS' as categoria,
  id,
  phone_number,
  direction,
  LEFT(content, 50) as conteudo_resumido,
  created_at
FROM whatsapp_messages
ORDER BY created_at DESC
LIMIT 5;
