-- 20280111000000_vincular_numero_a_lead.sql
--
-- "Vincular a cliente existente" no chat (Café Jurerê, 10/11).
--
-- ── O defeito ────────────────────────────────────────────────────────────
-- A conversa só se liga a um lead PELO TELEFONE. Cliente do ERP que escreve de
-- um número que não está no cadastro dele fica com a conversa solta, e a ficha
-- do chat ("Criar ou vincular lead") só oferece CRIAR um lead novo — não há
-- como apontar o cadastro que já existe. Medido em prod (30 dias): 251 de 1.744
-- conversas da org sem lead; 227 delas com número que não está em lead nenhum.
--
-- ── O conserto ───────────────────────────────────────────────────────────
-- `vincular_numero_a_lead(org, telefone, lead)`: o número da conversa passa a
-- ser um telefone do lead escolhido (`lead_phones`, source 'crm') e a conversa
-- é religada a ele. Com o número no cadastro, as próximas mensagens chegam
-- ligadas sozinhas (`resolve_message_lead_id`).
--
-- Compõe sobre o que já existe, sem DEFINER novo:
--   1. INSERT em `lead_phones` como o USUÁRIO (INVOKER): a policy
--      `lead_phones_insert` decide (org do usuário, source 'crm', lead visível
--      pela RLS de `leads`). O gatilho `trg_lead_phones_adopt_orphan_messages`
--      religa mensagens e resumo quando nenhum outro lead vivo tem o número.
--   2. `escolher_lead_do_numero` (DEFINER, auditada no #2470): grava a escolha
--      do número para a org e religa mensagens SEM lead e o resumo nas caixas
--      que o usuário lê — cobre o número compartilhado, que o gatilho pula.
--
-- 🔴 Depende de `escolher_lead_do_numero` (migration 20280102000000, PR #2470):
-- em prod desde 09/11; este arquivo precisa entrar DEPOIS dela na main.
--
-- Rollback: supabase/migrations/rollback/20280111000000_vincular_numero_a_lead.sql

CREATE OR REPLACE FUNCTION public.vincular_numero_a_lead(
  p_organization_id uuid,
  p_phone text,
  p_lead_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_phone text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_org_access(p_organization_id);

  v_phone := public.normalize_brazilian_phone(p_phone);
  IF v_phone IS NULL OR v_phone !~ '^[0-9]{8,15}$' OR p_lead_id IS NULL THEN
    RAISE EXCEPTION 'numero_ou_lead_invalido' USING ERRCODE = '22023';
  END IF;

  -- Quem não vê a conversa não a vincula (mesma regra de escolher_lead_do_numero).
  IF NOT COALESCE(public.can_see_chat(p_organization_id, v_phone), false) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  -- O cadastro tem que ser desta org, vivo e visível para quem vincula (a RLS
  -- de `leads` recorta: o que o usuário não vê, aqui não existe).
  IF NOT EXISTS (
    SELECT 1 FROM public.leads l
     WHERE l.id = p_lead_id
       AND l.organization_id = p_organization_id
       AND l.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Cliente não encontrado.'
      USING ERRCODE = 'P0002', DETAIL = 'lead_nao_encontrado';
  END IF;

  -- O número vira telefone do cadastro (idempotente: se já é, não duplica).
  IF NOT EXISTS (
    SELECT 1 FROM public.lead_phones lp
     WHERE lp.lead_id = p_lead_id
       AND lp.normalized_phone = v_phone
       AND lp.deleted_at IS NULL
  ) THEN
    INSERT INTO public.lead_phones (organization_id, lead_id, phone, source, is_primary, created_by)
    VALUES (p_organization_id, p_lead_id, v_phone, 'crm', false, v_uid);
  END IF;

  -- Escolha do número + religar conversa e mensagens sem lead.
  RETURN public.escolher_lead_do_numero(p_organization_id, v_phone, p_lead_id);
END;
$function$;

COMMENT ON FUNCTION public.vincular_numero_a_lead(uuid, text, uuid) IS
  'Chat: vincula a conversa de um número a um cliente que já existe — o número entra em lead_phones e a conversa é religada (escolher_lead_do_numero). INVOKER.';

REVOKE ALL ON FUNCTION public.vincular_numero_a_lead(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vincular_numero_a_lead(uuid, text, uuid) TO authenticated, service_role;
