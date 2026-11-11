-- 20280102000000_numero_compartilhado_escolha_e_vinculo_anterior.sql
--
-- Número compartilhado entre cadastros: escolha explícita + vínculo anterior.
--
-- Regressão de 19/10 (20271128000000_telefone_nn_resolucao_por_negocio_aberto):
-- número em 2+ leads vivos só vincula a mensagem ao lead com NEGÓCIO ABERTO;
-- sem negócio, NENHUM. Na Café Jurerê o ERP Toth repete o mesmo telefone em
-- vários cadastros (PF + PJ, filiais, CNPJ duplicado). Quando o único negócio
-- fecha, a conversa que ESTAVA vinculada perde o lead e o chat mostra
-- "Nenhum lead vinculado" sem saída (caso Cliente Exemplo: 101 mensagens no lead
-- até 19/10 14:25 UTC, 144 órfãs desde 19/10 19:14).
--
-- Ordem nova de resolução por NÚMERO (idêntica no trigger, na borda
-- `supabase/functions/_shared/lead-by-phone.ts` e no front
-- `src/modules/communication/lib/leadByPhone.ts`):
--   1. 1 candidato vivo -> ele (inalterado).
--   2. 2+ candidatos:
--      a. ESCOLHA EXPLÍCITA do usuário para (org, número), se o lead escolhido
--         ainda é candidato vivo;
--      b. negócio aberto mais recente (regra de 19/10, inalterada);
--      c. VÍNCULO ANTERIOR: lead da mensagem vinculada mais recente do número
--         (mesma org, viva), se ainda é candidato;
--      d. nenhum (inalterado).
--
-- O que este arquivo cria:
--   * public.whatsapp_numero_lead_escolhido — a escolha. Leitura por RLS (membro
--     da org que vê a conversa, ou master); ESCRITA só pela RPC abaixo.
--   * private.leads_vivos_do_numero / private.ultimo_lead_vinculado_ao_numero /
--     private.lead_do_numero_ambiguo — peças da decisão, sem grant a ninguém.
--   * private.vinculo_de_lead_tem_efeito_externo(org) — org onde UPDATE de
--     lead_id em mensagem OUTGOING dispara efeito fora do chat (Riofix, ou
--     pipeline com first_human_outbound_stage ligado). Usada pela RPC e pelo
--     backfill avulso (supabase/ops/backfill-numero-compartilhado-vinculo-anterior.sql).
--   * public.escolher_lead_do_numero(org, telefone, lead) — DEFINER com gate
--     (assert_org_access + can_see_chat, o MESMO predicado da policy de UPDATE
--     de whatsapp_messages): grava a escolha e vincula as mensagens do número
--     que estão SEM lead. Mensagem já vinculada não é tocada. A ESCOLHA vale
--     para a org inteira (todas as caixas, mensagens futuras); o vínculo
--     RETROATIVO fica só nas caixas que o usuário lê (mesma regra da policy
--     RESTRICTIVE whatsapp_messages_instance_read_access).
--   * public.resolve_message_lead_id — CREATE OR REPLACE (grants preservados):
--     os 3 degraus passam a aplicar a > b > c no ramo ambíguo.
--
-- Custo no INSERT: só o ramo ambíguo (2+ candidatos) paga algo novo — um
-- lookup por PK na escolha e, sem escolha nem negócio, o vínculo anterior por
-- idx_whatsapp_msgs_org_phone_instance_ts (salto por caixa + LIMIT 1 por caixa;
-- varre só as órfãs desde o último vínculo). Medido em prod no caso Cliente Exemplo
-- (3 caixas, 144 órfãs): 8 ms frio; com o fix as órfãs param de acumular.
--
-- Efeito colateral do UPDATE de lead_id feito pela RPC (gatilhos de prod,
-- conferidos em 09/11): trg_first_human_outbound_stage (AFTER UPDATE OF lead_id,
-- só outgoing manual; avança etapa SÓ em pipeline com first_human_outbound_stage
-- ligado — 1 pipeline em prod, nenhum na Café Jurerê), riofix_proposal_message_update
-- (só org Riofix, só mensagem igual ao texto configurado) e
-- trg_resolve_message_lead_id_zz_cobranca (BEFORE; caixa de cobrança fica sem
-- lead — a RPC já exclui essas caixas). Nenhum aviso, webhook ou resumo de IA
-- dispara em UPDATE (todos são AFTER INSERT). Os dois primeiros só olham
-- OUTGOING: em org onde eles têm efeito (private.vinculo_de_lead_tem_efeito_externo)
-- a RPC revincula só INCOMING; as outgoing seguem sem lead.
--
-- Rollback: supabase/migrations/rollback/20280102000000_numero_compartilhado_escolha_e_vinculo_anterior.sql

BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE SCHEMA IF NOT EXISTS private;

-- ─── Escolha explícita ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.whatsapp_numero_lead_escolhido (
  organization_id  uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  -- Mesma normalização de whatsapp_messages.normalized_phone (normalize_brazilian_phone).
  normalized_phone text        NOT NULL CHECK (normalized_phone ~ '^[0-9]{8,15}$'),
  lead_id          uuid        NOT NULL REFERENCES public.leads (id) ON DELETE CASCADE,
  escolhido_por    uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  escolhido_em     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, normalized_phone)
);

COMMENT ON TABLE public.whatsapp_numero_lead_escolhido IS
  'Número de WhatsApp em 2+ cadastros: lead escolhido pelo usuário para receber as mensagens. Escrita só via escolher_lead_do_numero().';

-- FK de leads com ON DELETE CASCADE precisa de índice no lado filho.
CREATE INDEX IF NOT EXISTS idx_whatsapp_numero_lead_escolhido_lead
  ON public.whatsapp_numero_lead_escolhido (lead_id);

ALTER TABLE public.whatsapp_numero_lead_escolhido ENABLE ROW LEVEL SECURITY;

-- Grant nominal de service_role vem de ALTER DEFAULT PRIVILEGES: revogado à mão.
REVOKE ALL ON TABLE public.whatsapp_numero_lead_escolhido FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.whatsapp_numero_lead_escolhido TO authenticated, service_role;

DROP POLICY IF EXISTS whatsapp_numero_lead_escolhido_select ON public.whatsapp_numero_lead_escolhido;
-- Mesmo recorte da leitura de whatsapp_messages: membro ativo da org que vê a
-- conversa daquele número (can_see_chat respeita strict_lead_owner e
-- chat_restrict_to_owner), ou master.
CREATE POLICY whatsapp_numero_lead_escolhido_select
  ON public.whatsapp_numero_lead_escolhido
  FOR SELECT TO authenticated
  USING (
    (
      organization_id IN (SELECT public.get_my_organization_ids())
      AND public.can_see_chat(organization_id, normalized_phone)
    )
    OR (SELECT public.is_master_user())
  );

-- ─── Peças da decisão (private, sem grant) ──────────────────────────────────

-- Leads vivos que têm o número: principal (leads.normalized_phone) ou contato
-- (lead_phones vivo de lead vivo). Mesma definição de candidato da borda e do front.
CREATE OR REPLACE FUNCTION private.leads_vivos_do_numero(p_organization_id uuid, p_normalized_phone text)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT l.id
    FROM public.leads l
   WHERE l.organization_id = p_organization_id
     AND l.normalized_phone = p_normalized_phone
     AND l.deleted_at IS NULL
  UNION
  SELECT lp.lead_id
    FROM public.lead_phones lp
    JOIN public.leads l
      ON l.id = lp.lead_id
     AND l.organization_id = p_organization_id
     AND l.deleted_at IS NULL
   WHERE lp.organization_id = p_organization_id
     AND lp.normalized_phone = p_normalized_phone
     AND lp.deleted_at IS NULL;
$$;

-- Lead da mensagem VINCULADA mais recente do número na org (viva), em qualquer
-- caixa — inclusive caixa já removida de whatsapp_instances (caso Cliente Exemplo).
-- Salto por caixa no índice (organization_id, normalized_phone, instance_id,
-- timestamp DESC) e LIMIT 1 por caixa: o custo é o número de caixas mais as
-- órfãs desde o último vínculo, nunca o histórico inteiro do número.
CREATE OR REPLACE FUNCTION private.ultimo_lead_vinculado_ao_numero(p_organization_id uuid, p_normalized_phone text)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH RECURSIVE caixas AS (
    (SELECT w.instance_id
       FROM public.whatsapp_messages w
      WHERE w.organization_id = p_organization_id
        AND w.normalized_phone = p_normalized_phone
        AND w.deleted_at IS NULL
        AND w.instance_id IS NOT NULL
      ORDER BY w.instance_id
      LIMIT 1)
    UNION ALL
    SELECT (SELECT w.instance_id
              FROM public.whatsapp_messages w
             WHERE w.organization_id = p_organization_id
               AND w.normalized_phone = p_normalized_phone
               AND w.deleted_at IS NULL
               AND w.instance_id > c.instance_id
             ORDER BY w.instance_id
             LIMIT 1)
      FROM caixas c
     WHERE c.instance_id IS NOT NULL
  ), ultimas AS (
    SELECT u.lead_id, u."timestamp", u.created_at, u.id
      FROM caixas c
     CROSS JOIN LATERAL (
       SELECT w.lead_id, w."timestamp", w.created_at, w.id
         FROM public.whatsapp_messages w
        WHERE w.organization_id = p_organization_id
          AND w.normalized_phone = p_normalized_phone
          AND w.deleted_at IS NULL
          AND w.instance_id = c.instance_id
          AND w.lead_id IS NOT NULL
        ORDER BY w."timestamp" DESC
        LIMIT 1
     ) u
     WHERE c.instance_id IS NOT NULL
    UNION ALL
    (SELECT w.lead_id, w."timestamp", w.created_at, w.id
       FROM public.whatsapp_messages w
      WHERE w.organization_id = p_organization_id
        AND w.normalized_phone = p_normalized_phone
        AND w.deleted_at IS NULL
        AND w.instance_id IS NULL
        AND w.lead_id IS NOT NULL
      ORDER BY w."timestamp" DESC
      LIMIT 1)
  )
  SELECT lead_id
    FROM ultimas
   ORDER BY "timestamp" DESC NULLS LAST, created_at DESC, id DESC
   LIMIT 1;
$$;

-- Decisão do ramo ambíguo (2+ candidatos): escolha > negócio aberto > vínculo
-- anterior > nenhum. Candidato fora de p_candidatos nunca é devolvido.
CREATE OR REPLACE FUNCTION private.lead_do_numero_ambiguo(
  p_organization_id uuid,
  p_normalized_phone text,
  p_candidatos uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_lead uuid;
BEGIN
  IF p_candidatos IS NULL OR cardinality(p_candidatos) = 0 THEN
    RETURN NULL;
  END IF;
  IF cardinality(p_candidatos) = 1 THEN
    RETURN p_candidatos[1];
  END IF;

  -- a. Escolha explícita do usuário.
  IF p_normalized_phone IS NOT NULL THEN
    SELECT e.lead_id INTO v_lead
      FROM public.whatsapp_numero_lead_escolhido e
     WHERE e.organization_id = p_organization_id
       AND e.normalized_phone = p_normalized_phone
       AND e.lead_id = ANY (p_candidatos);
    IF v_lead IS NOT NULL THEN
      RETURN v_lead;
    END IF;
  END IF;

  -- b. Negócio aberto mais recente (regra de 19/10).
  SELECT d.source_lead_id INTO v_lead
    FROM public.deals d
   WHERE d.organization_id = p_organization_id
     AND d.source_lead_id = ANY (p_candidatos)
     AND d.closed_at IS NULL
     AND d.deleted_at IS NULL
   ORDER BY d.created_at DESC, d.id DESC
   LIMIT 1;
  IF v_lead IS NOT NULL THEN
    RETURN v_lead;
  END IF;

  -- c. Vínculo anterior, se o lead ainda é candidato.
  IF p_normalized_phone IS NOT NULL THEN
    v_lead := private.ultimo_lead_vinculado_ao_numero(p_organization_id, p_normalized_phone);
    IF v_lead = ANY (p_candidatos) THEN
      RETURN v_lead;
    END IF;
  END IF;

  -- d. Nenhum.
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.leads_vivos_do_numero(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.ultimo_lead_vinculado_ao_numero(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.lead_do_numero_ambiguo(uuid, text, uuid[]) FROM PUBLIC, anon, authenticated, service_role;

-- Org onde UPDATE de lead_id em mensagem OUTGOING tem efeito fora do chat:
--   * Riofix: riofix_proposal_message_update -> riofix_enqueue_workflow;
--   * pipeline ativo com config.first_human_outbound_stage.enabled:
--     trg_first_human_outbound_stage avança etapa.
-- Fonte única para a RPC (não revincula outgoing) e para o backfill avulso
-- (aborta). Novo gatilho com efeito em UPDATE de lead_id entra AQUI.
CREATE OR REPLACE FUNCTION private.vinculo_de_lead_tem_efeito_externo(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT p_organization_id = '36971ff5-fd73-4f30-a733-04bf8c90e5b6'::uuid  -- Riofix
      OR EXISTS (
           SELECT 1 FROM public.pipelines p
            WHERE p.organization_id = p_organization_id
              AND p.is_active
              AND p.config -> 'first_human_outbound_stage' -> 'enabled' = 'true'::jsonb);
$$;

REVOKE ALL ON FUNCTION private.vinculo_de_lead_tem_efeito_externo(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ─── Trigger de entrada: os 3 degraus com a > b > c no ramo ambíguo ─────────
-- CREATE OR REPLACE: mantém owner, grants e o trigger trg_resolve_message_lead_id.
-- trg_normalize_whatsapp_message_phone roda antes (ordem alfabética dos BEFORE),
-- então NEW.normalized_phone já está preenchido.

CREATE OR REPLACE FUNCTION public.resolve_message_lead_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  digits text;
  normalized text;
  cands uuid[];
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  digits := regexp_replace(COALESCE(NEW.phone_number, ''), '[^0-9]', '', 'g');
  IF digits = '' THEN
    RETURN NEW;
  END IF;

  -- Degrau 1: digitos exatos (leads.phone + lead_phones).
  SELECT array_agg(DISTINCT c.lead_id ORDER BY c.lead_id) INTO cands
    FROM (
      SELECT l.id AS lead_id
        FROM leads l
       WHERE l.organization_id = NEW.organization_id
         AND l.deleted_at IS NULL
         AND l.phone_digits = digits
         AND l.phone_digits != ''
      UNION
      SELECT lp.lead_id
        FROM lead_phones lp
        JOIN leads l ON l.id = lp.lead_id AND l.deleted_at IS NULL
       WHERE lp.organization_id = NEW.organization_id
         AND lp.deleted_at IS NULL
         AND lp.phone_digits = digits
    ) c;

  IF cardinality(cands) = 1 THEN
    NEW.lead_id := cands[1];
    RETURN NEW;
  ELSIF cardinality(cands) > 1 THEN
    -- numero compartilhado: escolha > negocio aberto > vinculo anterior > nenhum
    NEW.lead_id := private.lead_do_numero_ambiguo(NEW.organization_id, NEW.normalized_phone, cands);
    RETURN NEW;
  END IF;

  IF length(digits) >= 10 THEN
    -- Degrau 2: BR movel normalizado (9o digito), leads.phone + lead_phones.
    normalized := normalize_br_mobile(digits);

    SELECT array_agg(DISTINCT c.lead_id ORDER BY c.lead_id) INTO cands
      FROM (
        SELECT l.id AS lead_id
          FROM leads l
         WHERE l.organization_id = NEW.organization_id
           AND l.deleted_at IS NULL
           AND l.phone_digits != ''
           AND length(l.phone_digits) >= 10
           AND normalize_br_mobile(l.phone_digits) = normalized
        UNION
        SELECT lp.lead_id
          FROM lead_phones lp
          JOIN leads l ON l.id = lp.lead_id AND l.deleted_at IS NULL
         WHERE lp.organization_id = NEW.organization_id
           AND lp.deleted_at IS NULL
           AND length(lp.phone_digits) >= 10
           AND normalize_br_mobile(lp.phone_digits) = normalized
      ) c;

    IF cardinality(cands) = 1 THEN
      NEW.lead_id := cands[1];
      RETURN NEW;
    ELSIF cardinality(cands) > 1 THEN
      NEW.lead_id := private.lead_do_numero_ambiguo(NEW.organization_id, NEW.normalized_phone, cands);
      RETURN NEW;
    END IF;

    -- Degrau 3: sufixo de 11 digitos (internacional), so leads.phone como antes.
    SELECT array_agg(DISTINCT l.id ORDER BY l.id) INTO cands
      FROM leads l
     WHERE l.organization_id = NEW.organization_id
       AND l.deleted_at IS NULL
       AND l.phone_digits != ''
       AND length(l.phone_digits) >= 10
       AND right(l.phone_digits, 11) = right(digits, 11);

    IF cardinality(cands) = 1 THEN
      NEW.lead_id := cands[1];
    ELSIF cardinality(cands) > 1 THEN
      NEW.lead_id := private.lead_do_numero_ambiguo(NEW.organization_id, NEW.normalized_phone, cands);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ─── RPC: o usuário escolhe o lead do número ────────────────────────────────

CREATE OR REPLACE FUNCTION public.escolher_lead_do_numero(
  p_organization_id uuid,
  p_phone text,
  p_lead_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_phone       text;
  v_total       integer;
  v_todas_caixas boolean;
  v_caixas      uuid[];
  v_so_incoming boolean;
BEGIN
  -- Ação de usuário: sem sessão não há quem escolha (service_role nem tem grant).
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  -- Membro ATIVO da org (ou gestor de portfólio), ou master. Org por parâmetro
  -- só passa daqui se o usuário pertence a ela.
  PERFORM public.assert_org_access(p_organization_id);

  v_phone := public.normalize_brazilian_phone(p_phone);
  IF v_phone IS NULL OR v_phone !~ '^[0-9]{8,15}$' OR p_lead_id IS NULL THEN
    RAISE EXCEPTION 'numero_ou_lead_invalido' USING ERRCODE = '22023';
  END IF;

  -- Mesmo predicado da policy de UPDATE de whatsapp_messages: quem não vê a
  -- conversa não a revincula (strict_lead_owner, chat_restrict_to_owner).
  IF NOT COALESCE(public.can_see_chat(p_organization_id, v_phone), false) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  -- Só um cadastro VIVO deste número, nesta org.
  IF NOT EXISTS (
    SELECT 1
      FROM private.leads_vivos_do_numero(p_organization_id, v_phone) AS c(lead_id)
     WHERE c.lead_id = p_lead_id
  ) THEN
    -- Frase em PT chega ao toast como está (toAppError); DETAIL é o código estável.
    RAISE EXCEPTION 'Este cadastro não tem mais este número.'
      USING ERRCODE = 'P0001',
            DETAIL  = 'lead_nao_e_cadastro_do_numero',
            HINT    = 'Atualize a conversa e tente de novo.';
  END IF;

  INSERT INTO public.whatsapp_numero_lead_escolhido AS e
    (organization_id, normalized_phone, lead_id, escolhido_por, escolhido_em)
  VALUES (p_organization_id, v_phone, p_lead_id, v_uid, now())
  ON CONFLICT (organization_id, normalized_phone) DO UPDATE
    SET lead_id       = EXCLUDED.lead_id,
        escolhido_por = EXCLUDED.escolhido_por,
        escolhido_em  = EXCLUDED.escolhido_em;

  -- A ESCOLHA acima vale para a org inteira: o vínculo número↔lead é fato da
  -- org e rege os INSERTs futuros de TODAS as caixas (trigger, regra 2a).
  -- O vínculo RETROATIVO abaixo fica só nas caixas que o usuário LÊ — o mesmo
  -- recorte da policy RESTRICTIVE whatsapp_messages_instance_read_access:
  -- master ou admin ativo da org leem todas; os demais, só
  -- private.whatsapp_readable_message_instance_ids() (mensagem sem caixa fica
  -- de fora para eles, como na policy).
  v_todas_caixas := public.is_master_user()
    OR EXISTS (
         SELECT 1 FROM public.team_members tm
          WHERE tm.user_id = v_uid
            AND tm.organization_id = p_organization_id
            AND tm.is_active
            AND tm.role = 'admin');
  IF NOT v_todas_caixas THEN
    v_caixas := COALESCE(private.whatsapp_readable_message_instance_ids(), ARRAY[]::uuid[]);
  END IF;

  -- Org com efeito externo em UPDATE de lead_id de outgoing: só incoming.
  v_so_incoming := private.vinculo_de_lead_tem_efeito_externo(p_organization_id);

  -- Só mensagem SEM lead. Já vinculada fica como está. Caixa de cobrança fica
  -- sem lead por regra (cobranca_isolar_mensagem) e grupo não é do número.
  UPDATE public.whatsapp_messages m
     SET lead_id = p_lead_id
   WHERE m.organization_id = p_organization_id
     AND m.normalized_phone = v_phone
     AND m.lead_id IS NULL
     AND NOT COALESCE(m.is_group, false)
     AND (v_todas_caixas OR m.instance_id = ANY (v_caixas))
     AND (NOT v_so_incoming OR m.direction = 'incoming')
     AND NOT EXISTS (
       SELECT 1 FROM public.whatsapp_instances w
        WHERE w.id = m.instance_id AND w.reserved_for = 'collections');
  GET DIAGNOSTICS v_total = ROW_COUNT;

  -- A lista do inbox lê lead_id do resumo (fixado no 1º INSERT da conversa).
  UPDATE public.whatsapp_conversation_summary s
     SET lead_id = p_lead_id,
         updated_at = now()
   WHERE s.organization_id = p_organization_id
     AND s.normalized_phone = v_phone
     AND s.lead_id IS NULL
     AND NOT s.is_group
     AND (v_todas_caixas OR s.instance_id = ANY (v_caixas))
     AND NOT EXISTS (
       SELECT 1 FROM public.whatsapp_instances w
        WHERE w.id = s.instance_id AND w.reserved_for = 'collections');

  RETURN v_total;
END;
$$;

COMMENT ON FUNCTION public.escolher_lead_do_numero(uuid, text, uuid) IS
  'Número em 2+ cadastros: grava o lead escolhido (vale para a org inteira e rege as mensagens futuras de todas as caixas) e vincula a ele as mensagens do número que estão sem lead SÓ nas caixas que o usuário lê (master/admin: todas). Em org com efeito externo no UPDATE de lead_id (Riofix, first_human_outbound_stage) vincula só incoming. Retorna quantas mensagens vinculou.';

REVOKE ALL ON FUNCTION public.escolher_lead_do_numero(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.escolher_lead_do_numero(uuid, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.escolher_lead_do_numero(uuid, text, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.escolher_lead_do_numero(uuid, text, uuid) TO authenticated;

COMMIT;
