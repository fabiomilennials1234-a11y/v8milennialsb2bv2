-- ============================================================================
-- Resolucao do alvo para o gate de escrita do proxy (PRD #1629, fatia #1635)
--
-- O whatsapp-api-proxy valida a fronteira de ORG mas nao valida RESPONSAVEL.
-- As acoes aceitam telefone, message_id ou chat_jid direto, entao o gate de
-- leitura sozinho nao as cobre: o vendedor que perdeu o lead na transferencia
-- e guardou o numero continuava conseguindo agir sobre aquela conversa.
--
-- POR QUE A RESOLUCAO MORA AQUI, E NAO NO TYPESCRIPT:
--   1. normalizacao de telefone. leads.normalized_phone e produzida por
--      normalize_brazilian_phone(). Reimplementar isso no proxy cria duas
--      normalizacoes que divergem no primeiro DDD de 8 digitos.
--   2. o message_id precisa de uma leitura que o usuario NAO pode fazer --
--      ele nao enxerga a linha, e esse e justamente o ponto. SECURITY DEFINER
--      resolve; um client service_role no proxy resolveria tambem, mas ai a
--      decisao de autorizacao ficaria montada em dois lugares.
--   3. uma chamada em vez de tres.
--
-- can_see_chat_target devolve o veredito final. O proxy so passa o que tem.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.can_see_chat_target(
  p_org_id      uuid,
  p_lead_id     uuid    DEFAULT NULL,
  p_raw_phone   text    DEFAULT NULL,
  p_message_id  text    DEFAULT NULL,
  p_instance_id uuid    DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_id uuid := p_lead_id;
  v_phone   text;
BEGIN
  IF p_org_id IS NULL THEN RETURN false; END IF;

  -- Sem chave nenhuma: a acao nao toca conversa (getStatus, connectQR,
  -- logoutInstance, getMessageLimits...). Nao e o gate que decide isso, mas
  -- devolver true aqui e o comportamento correto: nao ha conversa a proteger.
  IF p_lead_id IS NULL AND p_raw_phone IS NULL AND p_message_id IS NULL THEN
    RETURN true;
  END IF;

  IF p_raw_phone IS NOT NULL THEN
    -- Aceita numero puro e JID (5511999990001@s.whatsapp.net / @g.us).
    v_phone := public.normalize_brazilian_phone(split_part(p_raw_phone, '@', 1));
  END IF;

  -- message_id sem telefone: markRead e downloadMedia mandam so o id. A linha
  -- e lida por SECURITY DEFINER de proposito -- o usuario nao a enxerga.
  IF v_phone IS NULL AND v_lead_id IS NULL AND p_message_id IS NOT NULL THEN
    SELECT m.normalized_phone, m.lead_id
      INTO v_phone, v_lead_id
    FROM public.whatsapp_messages m
    WHERE m.message_id = p_message_id
      AND m.organization_id = p_org_id
      AND (p_instance_id IS NULL OR m.instance_id = p_instance_id)
    LIMIT 1;

    -- message_id que nao existe nesta org: nao ha alvo legitimo. Fail-closed.
    IF v_phone IS NULL AND v_lead_id IS NULL THEN RETURN false; END IF;
  END IF;

  RETURN public.can_see_chat_scope(p_org_id, v_lead_id, v_phone);
END;
$$;

COMMENT ON FUNCTION public.can_see_chat_target(uuid, uuid, text, text, uuid) IS
  'Veredito do gate de escrita do chat a partir do que o chamador tem em maos: lead_id, telefone bruto (ou JID) ou message_id. Normaliza e resolve por dentro para nao duplicar a regra fora do banco. Fail-closed quando o message_id nao existe na org.';

REVOKE ALL ON FUNCTION public.can_see_chat_target(uuid, uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_chat_target(uuid, uuid, text, text, uuid) TO authenticated, service_role;
