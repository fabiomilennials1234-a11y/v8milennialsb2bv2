-- ============================================================================
-- `mover_negocio` — avançar é MOVER, não copiar. Passo 5b do L2.
--
-- ADR-0023 decisão 4: o Negócio tem UMA posição, e alcançar a etapa de sucesso
-- de um funil o move para o próximo; não deixa gêmeo para trás. Hoje as três
-- páginas de funil fazem DUAS escritas — UPDATE na etapa do card de origem e
-- INSERT de um card novo no destino — e a origem nunca sai.
--
-- ── ESCOPO: SISTEMA → SISTEMA. O destino custom NÃO entra aqui. ────────────
-- `pipeline_entries` e `custom_pipe_entries` são espelho 1:1 por primary key, de
-- mão única: `sync_custom_pipe_to_entries` faz `ON CONFLICT (id) DO UPDATE` e
-- **nunca reescreve `pipeline_id`**. Atravessar a fronteira sistema↔custom não é
-- um UPDATE — obriga delete+insert, o card perde o id, e com ele a âncora de
-- histórico. Isso é decisão de modelo (passo 5c), não refactor. Esta função
-- RECUSA destino não-sistema em vez de fingir que resolve.
--
-- ── POR QUE DOIS UPDATE, E NÃO UM ─────────────────────────────────────────
-- Esta é a parte que não é óbvia, e ela existe para não quebrar métrica.
--
-- `fn_capture_meeting_event` produz `meeting_booked` e `meeting_held` a partir de
-- TRANSIÇÃO para etapas literais — `NEW.stage_key = 'agendado'` e
-- `NEW.stage_key = 'compareceu'`, com `OLD.stage_key IS DISTINCT FROM NEW.stage_key`
-- — mais um ramo `slug='confirmacao' AND TG_OP='INSERT'`.
--
-- Um move de uma tacada só (direto para o funil de destino, na etapa de destino)
-- destrói as três condições: o card nunca passa por 'agendado' nem por
-- 'compareceu', e não há INSERT. Resultado medido do que aconteceria: **71 orgs**
-- parariam de contar reunião marcada e realizada no dia do deploy. O ADR §4
-- afirma que "meeting counts read events, never column occupancy" — é o inverso:
-- os eventos são produzidos pela transição que o move eliminaria.
--
-- A saída não é remendar o gatilho, é mover em DOIS passos na MESMA linha:
--   1. `stage_key := <etapa final-positiva da origem>`  → os gatilhos disparam
--      exatamente como hoje, porque este UPDATE é o que já acontece hoje;
--   2. `pipeline_id, stage_key := <destino>`            → a troca de funil.
--
-- Continua sendo MOVE: nenhuma linha nova, o id do card sobrevive, o gêmeo não
-- nasce. E a contagem fica byte-a-byte igual — conferido nos dois caminhos que
-- somam 176 orgs:
--
--   whatsapp/agendado → confirmacao   hoje: booked no UPDATE da origem, e o
--     INSERT do destino cai no ramo de remarcação (mesmo lead, <30 dias) e só
--     atualiza a data. Total 1.   Depois: booked no passo 1; o passo 2 é UPDATE,
--     então o ramo `TG_OP='INSERT'` não abre. Total 1. Igual.
--
--   confirmacao/compareceu → propostas   hoje: held no UPDATE da origem; o
--     INSERT em propostas não casa nenhum ramo. Total 1.   Depois: held no passo
--     1; o passo 2 não casa nada. Total 1. Igual.
--
-- ── O QUE MELHORA DE GRAÇA ────────────────────────────────────────────────
-- `trg_pe_snapshot_responsibles` é BEFORE **INSERT**. Hoje o card do destino
-- nasce e recebe um snapshot novo de responsáveis; no move a linha é a mesma e
-- carrega os seus. Um dono a menos para se perder no caminho.
--
-- SECURITY INVOKER, como `abrir_negocio`: a permissão de mover continua sendo a
-- que a RLS já concede, e apertá-la depois é mexer em policy.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.mover_negocio(
  p_entry_id           uuid,
  p_target_pipeline_id uuid,
  p_target_stage_key   text,
  -- A etapa de sucesso da ORIGEM, por onde o card passa antes de sair. É ela que
  -- dispara `meeting_booked`/`meeting_held`. NULL pula o passo 1 — use só quando
  -- a origem já está na etapa certa, senão a métrica não sai.
  p_stage_origem       text DEFAULT NULL,
  p_assigned_to        uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_org        uuid;
  v_lead       uuid;
  v_pipe_atual uuid;
  v_stage_atual text;
  v_tipo_alvo  text;
  v_org_alvo   uuid;
BEGIN
  SELECT pe.organization_id, pe.lead_id, pe.pipeline_id, pe.stage_key
    INTO v_org, v_lead, v_pipe_atual, v_stage_atual
    FROM public.pipeline_entries pe
   WHERE pe.id = p_entry_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Negócio % não encontrado.', p_entry_id USING ERRCODE = 'no_data_found';
  END IF;

  SELECT p.type, p.organization_id INTO v_tipo_alvo, v_org_alvo
    FROM public.pipelines p WHERE p.id = p_target_pipeline_id;

  IF v_tipo_alvo IS NULL THEN
    RAISE EXCEPTION 'Funil de destino % não existe.', p_target_pipeline_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Cross-org pelo destino seria mover o negócio para fora da própria empresa. A
  -- RLS já esconderia o funil de outra org, mas mensagem própria vale mais que
  -- "não encontrado".
  IF v_org_alvo <> v_org THEN
    RAISE EXCEPTION 'Funil de destino pertence a outra organização.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_tipo_alvo <> 'system' THEN
    RAISE EXCEPTION
      'Destino não é funil de sistema. Mover para funil customizado atravessa de `pipeline_entries` para `custom_pipe_entries`, que são espelho por primary key e não trocam de `pipeline_id` — é o passo 5c, e ainda não tem decisão.'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  IF p_target_stage_key IS NULL OR btrim(p_target_stage_key) = '' THEN
    RAISE EXCEPTION 'Etapa de destino é obrigatória.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── Passo 1: passar pela etapa de sucesso da origem ─────────────────────
  -- É o UPDATE que já acontece hoje, e é dele que saem `meeting_booked` e
  -- `meeting_held`. Pular quando o card já está lá evita evento duplicado — os
  -- gatilhos exigem `OLD.stage_key IS DISTINCT FROM NEW.stage_key`, então
  -- reescrever o mesmo valor seria inerte de qualquer forma; a guarda aqui é
  -- para não gastar um UPDATE e um round de gatilhos à toa.
  IF p_stage_origem IS NOT NULL
     AND btrim(p_stage_origem) <> ''
     AND p_stage_origem IS DISTINCT FROM v_stage_atual THEN
    UPDATE public.pipeline_entries
       SET stage_key = p_stage_origem
     WHERE id = p_entry_id;
  END IF;

  -- ── Passo 2: a troca de funil ───────────────────────────────────────────
  -- `assigned_to` só é tocado quando veio explícito: `COALESCE` cegamente
  -- apagaria o responsável do card quando o chamador não informa nada.
  UPDATE public.pipeline_entries
     SET pipeline_id = p_target_pipeline_id,
         stage_key   = p_target_stage_key,
         assigned_to = COALESCE(p_assigned_to, assigned_to)
   WHERE id = p_entry_id;

  RETURN p_entry_id;
END;
$$;

COMMENT ON FUNCTION public.mover_negocio(uuid, uuid, text, text, uuid) IS
  'ADR-0023 decisão 4: avançar é MOVER. Dois UPDATE na MESMA linha — o primeiro passa pela etapa de sucesso da origem (é ele que produz meeting_booked/meeting_held), o segundo troca de funil. Só sistema→sistema; destino custom é o passo 5c e é recusado.';

REVOKE ALL     ON FUNCTION public.mover_negocio(uuid, uuid, text, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mover_negocio(uuid, uuid, text, text, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.mover_negocio(uuid, uuid, text, text, uuid) TO authenticated;

DO $$
DECLARE v_anon boolean; v_auth boolean; v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'mover_negocio';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FAIL: % assinatura(s) de mover_negocio — overload silencioso quebra o PostgREST por aridade.', v_n;
  END IF;

  SELECT has_function_privilege('anon',
    'public.mover_negocio(uuid, uuid, text, text, uuid)', 'EXECUTE') INTO v_anon;
  SELECT has_function_privilege('authenticated',
    'public.mover_negocio(uuid, uuid, text, text, uuid)', 'EXECUTE') INTO v_auth;

  IF v_anon THEN
    RAISE EXCEPTION 'FAIL: anon executa mover_negocio.';
  END IF;
  IF NOT v_auth THEN
    RAISE EXCEPTION 'FAIL: authenticated NAO executa mover_negocio.';
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: mover_negocio instalada, assinatura unica, negada a anon e concedida a authenticated. Comportamento provado em qa-seed/fatia2-move-metricas.sql.';
END$$;

COMMIT;
