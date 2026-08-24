-- ============================================================================
-- `abrir_negocio` passa a gravar a Procedência. (#1764, ADR-0030 §4)
--
-- ── CIRÚRGICO, NÃO REESCRITO ──────────────────────────────────────────────
-- O corpo abaixo é o de 20270803000020 com TRÊS edições: a assinatura ganha
-- `p_source`, entra a validação do vocabulário, e o INSERT em `deals` grava a
-- coluna. Nada mais mudou — em especial continuam intactos o despacho pelos
-- quatro funis (os de sistema entram pelas views legadas, com gatilho INSTEAD
-- OF, e só depois a posição é ligada ao Negócio), a recusa de `upsell` por esta
-- porta, e a checagem de dono de outra organização.
--
-- ── POR QUE DROP E NÃO SÓ REPLACE ─────────────────────────────────────────
-- `CREATE OR REPLACE` com lista de argumentos diferente NÃO substitui: cria uma
-- SEGUNDA função de mesmo nome. O PostgREST resolve RPC por nome + argumentos —
-- com overload, a chamada do front poderia cair na assinatura velha, que não
-- grava Procedência, em silêncio.
--
-- DROP + CREATE tem risco próprio já catalogado aqui: o EXECUTE volta para
-- PUBLIC/anon. Daí o REVOKE/GRANT explícito e a verificação no fim.
--
-- ── POR QUE O DEFAULT É NULL, E NÃO 'human' ───────────────────────────────
-- Default 'human' faria todo caminho que esquecesse de informar nascer rotulado
-- como gente — Negócio de robô com etiqueta de humano. Pior que vazio: vazio é
-- visível e o passo *contract* (#1765) encontra; mentira etiquetada, ninguém.
--
-- Chamada sem Procedência continua funcionando por ora. A obrigatoriedade é
-- #1765, e só entra depois que TODOS os caminhos gravarem — incluindo o
-- `POST /deals` (#1769).
-- ============================================================================
BEGIN;

DROP FUNCTION IF EXISTS public.abrir_negocio(uuid, text, text, uuid, numeric, timestamptz, text, text);

CREATE OR REPLACE FUNCTION public.abrir_negocio(
  p_lead_id     uuid,
  p_pipe        text,
  p_stage       text,
  p_owner_id    uuid    DEFAULT NULL,
  p_value       numeric DEFAULT NULL,
  p_meeting_date timestamptz DEFAULT NULL,
  p_notes       text    DEFAULT NULL,
  p_title       text    DEFAULT NULL,
  p_source      text    DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_org        uuid;
  v_tz         text;
  v_deal_id    uuid;
  v_entry_id   uuid := gen_random_uuid();
  v_title      text;
  v_custom_id  uuid;
  v_notes      text := NULLIF(btrim(COALESCE(p_notes, '')), '');
BEGIN
  -- A org vem do LEAD, nunca de parâmetro. Com RLS de invoker, um lead de outra
  -- organização simplesmente não é visível e a função aborta aqui — o chamador
  -- não consegue escolher em qual org escreve.
  SELECT l.organization_id INTO v_org
    FROM public.leads l
   WHERE l.id = p_lead_id AND l.deleted_at IS NULL;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Lead % não encontrado (ou está na lixeira).', p_lead_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- O CHECK da coluna também recusa, mas a mensagem dele fala de constraint.
  -- Esta diz o que fazer, e é a que o integrador lê.
  IF p_source IS NOT NULL
     AND p_source NOT IN ('human','workflow','api','import','backfill') THEN
    RAISE EXCEPTION 'Procedência inválida: %. Válidas: human, workflow, api, import, backfill.', p_source
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT o.timezone INTO v_tz FROM public.organizations o WHERE o.id = v_org;

  -- Dono de outra org é recusado aqui, e não só pela trava do M6: a mensagem
  -- daqui diz o que aconteceu, a do gatilho diz que uma constraint falhou.
  IF p_owner_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.team_members m
                      WHERE m.id = p_owner_id AND m.organization_id = v_org) THEN
    RAISE EXCEPTION 'Responsável % não pertence à organização deste lead.', p_owner_id
      USING ERRCODE = 'check_violation';
  END IF;

  v_title := COALESCE(
    NULLIF(btrim(COALESCE(p_title, '')), ''),
    public.fn_negocio_titulo_padrao(now(), v_tz)
  );

  INSERT INTO public.deals (organization_id, title, source_lead_id, owner_id, value, notes, created_by, source)
  VALUES (v_org, v_title, p_lead_id, p_owner_id, p_value, v_notes, auth.uid(), p_source)
  RETURNING id INTO v_deal_id;

  IF p_pipe LIKE 'custom:%' THEN
    v_custom_id := substring(p_pipe FROM 8)::uuid;

    INSERT INTO public.custom_pipe_entries
      (id, pipeline_id, lead_id, organization_id, stage_id, assigned_to, notes, deal_id)
    VALUES (v_entry_id, v_custom_id, p_lead_id, v_org, p_stage::uuid, p_owner_id, v_notes, v_deal_id);

  ELSIF p_pipe = 'whatsapp' THEN
    INSERT INTO public.pipe_whatsapp
      (id, lead_id, organization_id, status, responsible_id, sdr_id, notes)
    VALUES (v_entry_id, p_lead_id, v_org, p_stage, p_owner_id, p_owner_id, v_notes);

  ELSIF p_pipe = 'confirmacao' THEN
    INSERT INTO public.pipe_confirmacao
      (id, lead_id, organization_id, status, responsible_id, sdr_id, meeting_date, notes)
    VALUES (v_entry_id, p_lead_id, v_org, p_stage, p_owner_id, p_owner_id, p_meeting_date, v_notes);

  ELSIF p_pipe = 'propostas' THEN
    INSERT INTO public.pipe_propostas
      (id, lead_id, organization_id, status, responsible_id, closer_id, sale_value, notes)
    VALUES (v_entry_id, p_lead_id, v_org, p_stage, p_owner_id, p_owner_id, p_value, v_notes);

  ELSE
    -- `upsell` cai aqui de propósito: carteira entra por regra própria
    -- (ADR-0023 decisão 8), não por esta porta.
    RAISE EXCEPTION 'Funil % não abre negócio por esta porta.', p_pipe
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Liga a posição à identidade. Nos funis de sistema a linha nasceu pelo
  -- `INSTEAD OF` da view, que não conhece `deal_id`; no custom já nasceu ligada.
  IF p_pipe NOT LIKE 'custom:%' THEN
    UPDATE public.pipeline_entries SET deal_id = v_deal_id WHERE id = v_entry_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Card criado mas não encontrado para ligar ao negócio (entry %). Transação desfeita para não deixar negócio sem posição.', v_entry_id
        USING ERRCODE = 'internal_error';
    END IF;
  END IF;

  RETURN v_deal_id;
END;
$$;

-- O DROP zerou os grants. Repõe explicitamente.
REVOKE ALL ON FUNCTION public.abrir_negocio(uuid, text, text, uuid, numeric, timestamptz, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.abrir_negocio(uuid, text, text, uuid, numeric, timestamptz, text, text, text) TO authenticated, service_role;

DO $do$
DECLARE v_n int; v_anon boolean;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'abrir_negocio';
  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'FAIL: % assinatura(s) de abrir_negocio. Overload faria o PostgREST resolver a antiga, que nao grava Procedencia.', v_n;
  END IF;

  SELECT has_function_privilege('anon', p.oid, 'EXECUTE') INTO v_anon
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'abrir_negocio';
  IF v_anon THEN
    RAISE EXCEPTION 'FAIL: anon ficou com EXECUTE apos o DROP+CREATE.';
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: abrir_negocio com p_source, uma assinatura so, anon sem EXECUTE.';
END$do$;

COMMIT;
