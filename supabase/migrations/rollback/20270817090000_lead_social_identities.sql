-- Rollback de 20270817090000_lead_social_identities.sql
--
-- Devolve o inbox social ao estado "conversa sem dono": some a tabela de
-- identidade, somem as três RPCs de vínculo, e `get_social_conversation_list`
-- volta byte-a-byte à forma de 20270815104500 (8 colunas, `lead_id` lido de
-- `t.lid`).
--
-- ⚠️ ISTO DESTRÓI DADO, e não é dado recuperável de outro lugar.
--
--   `lead_social_identities` é a FONTE DA VERDADE do vínculo. Depois do DROP,
--   quem vinculou o quê a quem existe apenas em `lead_history`
--   (action='social_identity_linked', com channel_type/external_user_id/lead no
--   metadata) — que é trilha, não índice: reconstruir a partir dela exige script
--   e julgamento humano sobre desvínculos posteriores. NÃO existe backfill
--   automático de volta.
--
--   ⇒ ANTES DE RODAR, se houver qualquer vínculo em produção:
--        CREATE TABLE public.lead_social_identities_bkp_<data> AS
--          SELECT * FROM public.lead_social_identities;
--        REVOKE ALL ON public.lead_social_identities_bkp_<data> FROM PUBLIC, anon, authenticated;
--      O REVOKE não é zelo: tabela de backup criada em `public` neste repo já
--      nasceu LEGÍVEL POR ANON uma vez.
--
-- ⚠️ O QUE FICA MENTINDO DEPOIS DO ROLLBACK
--
--   `channel_messages.lead_id` NÃO é revertido por este arquivo, de propósito. As
--   linhas que o vínculo preencheu continuam apontando para o lead certo, e a
--   lista restaurada volta a lê-las (`t.lid`). O efeito é o defeito conhecido: o
--   vínculo aparece enquanto a última mensagem da thread for uma linha já
--   backfillada e SOME na próxima mensagem recebida, porque o writer grava nulo.
--   Zerar a coluna seria pior — apagaria também o único rastro utilizável para
--   reconstruir os vínculos depois.
--
-- ─── ORDEM ──────────────────────────────────────────────────────────────────
--
--   Este arquivo pode rodar com o `notificame-webhook` NOVO no ar: o resolve dele
--   é BEST-EFFORT (try/catch, tabela ausente ⇒ `null`) e a mensagem entra igual,
--   com `lead_id` nulo — que é exatamente o comportamento anterior à fatia. O que
--   NÃO pode ficar no ar é o FRONT novo: ele lê `lead_name` do retorno da RPC e
--   chama as três funções que este arquivo apaga. Ordem segura:
--     1º  reverter o deploy do front;
--     2º  este arquivo;
--     3º  (opcional) reverter o `notificame-webhook`.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. As três RPCs de vínculo.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.link_social_conversation_to_lead(uuid, uuid, text, uuid);
DROP FUNCTION IF EXISTS public.create_lead_from_social_conversation(uuid, uuid, text, text, text, text, text, text, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.unlink_social_conversation_from_lead(uuid, uuid, text);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. `get_social_conversation_list` volta à forma de 20270815104500.
--
--    DROP + CREATE de novo (o RETURNS TABLE encolhe de 9 para 8 colunas), e os
--    grants são reescritos logo abaixo pelo mesmo motivo de sempre: o DROP os
--    apaga e o CREATE reconcede EXECUTE a PUBLIC/anon.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_social_conversation_list(uuid, uuid, integer, timestamptz);

CREATE OR REPLACE FUNCTION public.get_social_conversation_list(
  p_org uuid,
  p_channel uuid,
  p_limit integer DEFAULT 50,
  p_before timestamptz DEFAULT NULL
)
RETURNS TABLE(
  contact_external_id text,
  sender_name text,
  sender_profile_pic text,
  last_message text,
  last_message_time timestamptz,
  last_message_direction text,
  unread_count integer,
  lead_id uuid
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 1000);
BEGIN
  IF p_org IS NULL
     OR (NOT EXISTS (
           SELECT 1 FROM public.get_my_organization_ids() AS g(org_id)
            WHERE g.org_id = p_org)
         AND NOT COALESCE(is_master_user(), false)) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;

  IF p_channel IS NULL THEN
    RAISE EXCEPTION 'channel required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.messaging_channels mc
     WHERE mc.id = p_channel AND mc.organization_id = p_org
  ) THEN
    RAISE EXCEPTION 'forbidden: channel not in org' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH thread AS (
    SELECT DISTINCT ON (m.contact_external_id)
           m.contact_external_id  AS cid,
           m.content              AS body,
           m."timestamp"          AS ts,
           m.direction            AS dir,
           m.lead_id              AS lid
      FROM public.channel_messages m
     WHERE m.organization_id      = p_org
       AND m.messaging_channel_id = p_channel
       AND m.contact_external_id IS NOT NULL
     ORDER BY m.contact_external_id, m."timestamp" DESC
  ),
  contact_identity AS (
    SELECT DISTINCT ON (m.contact_external_id)
           m.contact_external_id  AS cid,
           m.sender_name          AS s_name,
           m.sender_profile_pic   AS s_pic
      FROM public.channel_messages m
     WHERE m.organization_id      = p_org
       AND m.messaging_channel_id = p_channel
       AND m.contact_external_id IS NOT NULL
       AND m.direction            = 'incoming'
     ORDER BY m.contact_external_id, m."timestamp" DESC
  ),
  unread AS (
    SELECT m.contact_external_id AS cid, count(*)::integer AS cnt
      FROM public.channel_messages m
      LEFT JOIN public.conversation_read_state rs
             ON rs.organization_id  = p_org
            AND rs.user_id          = v_uid
            AND rs.conversation_key = 'instagram:' || p_channel::text || ':'
                                      || m.contact_external_id
     WHERE m.organization_id      = p_org
       AND m.messaging_channel_id = p_channel
       AND m.contact_external_id IS NOT NULL
       AND m.direction            = 'incoming'
       AND m."timestamp" > COALESCE(rs.last_read_at, now() - interval '7 days')
     GROUP BY m.contact_external_id
  )
  SELECT t.cid,
         ci.s_name,
         ci.s_pic,
         t.body,
         t.ts,
         t.dir,
         COALESCE(u.cnt, 0)::integer,
         t.lid
    FROM thread t
    LEFT JOIN contact_identity ci ON ci.cid = t.cid
    LEFT JOIN unread u ON u.cid = t.cid
   WHERE p_before IS NULL OR t.ts < p_before
   ORDER BY t.ts DESC
   LIMIT v_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_social_conversation_list(uuid, uuid, integer, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_social_conversation_list(uuid, uuid, integer, timestamptz)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_social_conversation_list(uuid, uuid, integer, timestamptz)
  TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. A tabela. POR ÚLTIMO — a lista restaurada (bloco 2) já não a referencia.
--
--    Sem CASCADE de propósito: se sobrou alguma dependência que este arquivo não
--    previu, é melhor levar 2BP01 e ler o nome dela do que apagar em silêncio o
--    que alguém construiu por cima.
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS public.lead_social_identities;
