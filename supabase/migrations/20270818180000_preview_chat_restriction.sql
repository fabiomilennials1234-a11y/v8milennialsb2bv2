-- ============================================================================
-- Previa da politica de isolamento de chat (PRD #1629, fatia #1636)
--
-- Ligar a politica numa org tira do inbox dos membros toda conversa sem
-- responsavel derivavel. Medido em producao, agregado: de 38.963 conversas
-- individuais, 33.816 (86,8%) ficariam so para admin. Nas duas orgs que
-- pediram a feature e pior -- Goletric Pinheiros 96,5%, Perdizes 99,86%.
--
-- Esse numero tem que estar na tela ANTES do clique. Nao e enfeite: e a
-- diferenca entre o admin decidir e o admin descobrir pelo chamado do time.
--
-- FONTE: whatsapp_conversation_summary -- uma linha por (org, chip, telefone),
-- 46.611 em producao. Varrer whatsapp_messages (2.472.395) travaria a tela
-- justamente na org grande, que e onde a decisao importa.
--
-- `conversas_restritas` conta o PIOR CASO para um membro: conversa cujo
-- telefone nao casa com lead nenhum, ou casa com lead sem responsavel nas
-- quatro colunas. Membro com leads.view_unassigned ainda alcanca as sem
-- responsavel -- por isso a UI rotula "sem responsavel", nao "invisiveis".
-- ============================================================================

CREATE OR REPLACE FUNCTION public.preview_chat_restriction(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total      integer;
  v_restritas  integer;
  v_leads_orfa integer;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'preview_chat_restriction: organizacao obrigatoria' USING ERRCODE = '22023';
  END IF;

  -- Mesma autorizacao da escrita da politica: quem nao pode ligar nao precisa
  -- da contagem, e a contagem descreve o tamanho da carteira da org.
  IF NOT (
    public.is_master_user()
    OR EXISTS (
      SELECT 1 FROM public.team_members
      WHERE user_id = auth.uid()
        AND organization_id = p_org_id
        AND role = 'admin'
        AND is_active = true
    )
  ) THEN
    RAISE EXCEPTION 'forbidden: apenas admin da organizacao ve a previa'
      USING ERRCODE = '42501';
  END IF;

  WITH conversas AS (
    SELECT DISTINCT s.normalized_phone
    FROM public.whatsapp_conversation_summary s
    WHERE s.organization_id = p_org_id
      AND s.is_group = false
      AND s.normalized_phone IS NOT NULL
  ),
  classificadas AS (
    SELECT c.normalized_phone,
           EXISTS (
             SELECT 1 FROM public.leads l
             WHERE l.organization_id = p_org_id
               AND l.deleted_at IS NULL
               AND l.normalized_phone = c.normalized_phone
               AND COALESCE(
                     l.pre_sale_responsible_id,
                     l.sale_responsible_id,
                     l.sdr_id,
                     l.closer_id
                   ) IS NOT NULL
           ) AS tem_dono
    FROM conversas c
  )
  SELECT count(*), count(*) FILTER (WHERE NOT tem_dono)
  INTO v_total, v_restritas
  FROM classificadas;

  SELECT count(*)
  INTO v_leads_orfa
  FROM public.leads l
  WHERE l.organization_id = p_org_id
    AND l.deleted_at IS NULL
    AND COALESCE(
          l.pre_sale_responsible_id,
          l.sale_responsible_id,
          l.sdr_id,
          l.closer_id
        ) IS NULL;

  RETURN jsonb_build_object(
    'conversas_total',       COALESCE(v_total, 0),
    'conversas_restritas',   COALESCE(v_restritas, 0),
    'leads_sem_responsavel', COALESCE(v_leads_orfa, 0)
  );
END;
$$;

COMMENT ON FUNCTION public.preview_chat_restriction(uuid) IS
  'Numeros que o admin ve antes de ligar a politica de isolamento de chat: conversas individuais da org, quantas ficariam sem responsavel derivavel, e quantos leads estao sem responsavel. Le de whatsapp_conversation_summary, nao de whatsapp_messages.';

REVOKE ALL ON FUNCTION public.preview_chat_restriction(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_chat_restriction(uuid) TO authenticated;
