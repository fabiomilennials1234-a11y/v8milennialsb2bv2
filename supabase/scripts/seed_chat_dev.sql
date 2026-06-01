-- ============================================================================
-- seed_chat_dev.sql — dados FAKE de chat para visualizar o redesign no /chat
--
-- ONDE RODAR: SQL Editor do projeto SUPABASE DEV (bcfadphgsibjzivtbjvc).
--             NUNCA rodar em produção (jsjsmuncfkbsbzqzqhfq).
-- O SQL Editor roda como service_role → bypassa RLS (insere sem bloqueio).
--
-- Cria: 1 instância WhatsApp "connected" + 4 conversas + mensagens (incoming,
-- outgoing manual e 1 do copilot). Idempotente: re-rodar limpa o seed anterior.
--
-- Remoção: ver bloco "CLEANUP" no fim do arquivo.
-- ============================================================================

DO $$
DECLARE
  v_org      uuid;
  v_instance uuid;
  v_now      timestamptz := now();
  -- Email do SEU login no dev. Se a org não resolver, troque aqui OU
  -- defina v_org manualmente (ex.: Milennials '6030520a-2ca7-477d-be89-55758e2cd808').
  v_email    text := 'fabiomilennials1234@gmail.com';
BEGIN
  -- 1) Resolve a org a partir do team_member do usuário logado
  SELECT tm.organization_id INTO v_org
  FROM public.team_members tm
  JOIN auth.users u ON u.id = tm.user_id
  WHERE lower(u.email) = lower(v_email)
  ORDER BY tm.created_at NULLS LAST
  LIMIT 1;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Org não encontrada para % — ajuste v_email ou defina v_org manualmente.', v_email;
  END IF;

  -- 2) Instância de preview (reaproveita se já existir)
  SELECT id INTO v_instance
  FROM public.whatsapp_instances
  WHERE organization_id = v_org AND instance_name = 'WhatsApp Preview (seed)'
  LIMIT 1;

  IF v_instance IS NULL THEN
    INSERT INTO public.whatsapp_instances
      (organization_id, instance_name, status, provider, instance_id)
    VALUES
      (v_org, 'WhatsApp Preview (seed)', 'connected', 'uazapi', 'seed-preview-instance')
    RETURNING id INTO v_instance;
  END IF;

  -- 3) Idempotência: limpa seed anterior dessa instância
  DELETE FROM public.whatsapp_messages
   WHERE instance_id = v_instance AND message_id LIKE 'seed-%';
  DELETE FROM public.whatsapp_conversations
   WHERE instance_id = v_instance;

  -- 4) Conversas (metadata — habilita tags/arquivar)
  INSERT INTO public.whatsapp_conversations (organization_id, instance_id, phone_number) VALUES
    (v_org, v_instance, '5511999990001'),
    (v_org, v_instance, '5511999990002'),
    (v_org, v_instance, '5511999990003'),
    (v_org, v_instance, '5511999990004');

  -- 5) Mensagens (a lista de conversas é derivada daqui)
  INSERT INTO public.whatsapp_messages
    (organization_id, instance_id, phone_number, remote_jid, direction, message_id,
     content, push_name, message_type, status, sent_source, timestamp)
  VALUES
    -- Marina Lopes — termina com incoming (vira não-lida)
    (v_org, v_instance, '5511999990001', '5511999990001@s.whatsapp.net', 'incoming', 'seed-1-1',
     'Oi! Vi a apresentação ontem, adorei.', 'Marina Lopes', 'text', 'read', 'manual', v_now - interval '36 minutes'),
    (v_org, v_instance, '5511999990001', '5511999990001@s.whatsapp.net', 'outgoing', 'seed-1-2',
     'Que bom, Marina! Posso te mandar a proposta personalizada agora?', NULL, 'text', 'read', 'manual', v_now - interval '34 minutes'),
    (v_org, v_instance, '5511999990001', '5511999990001@s.whatsapp.net', 'incoming', 'seed-1-3',
     'Pode mandar sim! Vou analisar com o time hoje.', 'Marina Lopes', 'text', 'delivered', 'manual', v_now - interval '32 minutes'),

    -- Carlos Andrade — termina com outgoing
    (v_org, v_instance, '5511999990002', '5511999990002@s.whatsapp.net', 'incoming', 'seed-2-1',
     'Bom dia, fechei com vocês. Quais os próximos passos?', 'Carlos Andrade', 'text', 'read', 'manual', v_now - interval '3 hours'),
    (v_org, v_instance, '5511999990002', '5511999990002@s.whatsapp.net', 'outgoing', 'seed-2-2',
     'Perfeito, Carlos! Já te envio o contrato por aqui. 🙌', NULL, 'text', 'read', 'manual', v_now - interval '2 hours 58 minutes'),

    -- Felipe Souza
    (v_org, v_instance, '5511999990003', '5511999990003@s.whatsapp.net', 'incoming', 'seed-3-1',
     'Recebi a proposta, vou avaliar e te retorno.', 'Felipe Souza', 'text', 'read', 'manual', v_now - interval '5 hours'),
    (v_org, v_instance, '5511999990003', '5511999990003@s.whatsapp.net', 'outgoing', 'seed-3-2',
     'Combinado! Qualquer dúvida estou à disposição.', NULL, 'text', 'read', 'manual', v_now - interval '4 hours 55 minutes'),

    -- Patrícia Rocha — inclui mensagem do copilot (bolha roxa) + incoming final (não-lida)
    (v_org, v_instance, '5511999990004', '5511999990004@s.whatsapp.net', 'outgoing', 'seed-4-1',
     'Olá Patrícia! Sou o assistente da equipe e já adianto seu atendimento.', NULL, 'text', 'read', 'copilot', v_now - interval '1 hour 10 minutes'),
    (v_org, v_instance, '5511999990004', '5511999990004@s.whatsapp.net', 'incoming', 'seed-4-2',
     'Quando podemos marcar uma call?', 'Patrícia Rocha', 'text', 'delivered', 'manual', v_now - interval '1 hour');

  RAISE NOTICE 'Seed OK — org=% instance=%', v_org, v_instance;
END $$;

-- ============================================================================
-- CLEANUP — remove TODO o seed (rode o bloco abaixo quando quiser limpar)
-- ============================================================================
-- DO $$
-- DECLARE v_instance uuid;
-- BEGIN
--   SELECT id INTO v_instance FROM public.whatsapp_instances
--    WHERE instance_name = 'WhatsApp Preview (seed)' LIMIT 1;
--   IF v_instance IS NOT NULL THEN
--     DELETE FROM public.whatsapp_messages      WHERE instance_id = v_instance;
--     DELETE FROM public.whatsapp_conversations WHERE instance_id = v_instance;
--     DELETE FROM public.whatsapp_instances     WHERE id = v_instance;
--   END IF;
-- END $$;
