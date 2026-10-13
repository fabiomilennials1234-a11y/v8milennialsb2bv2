-- ============================================================================
-- No máximo UM card aberto SEM negócio por lead em cada funil — garantido pelo
-- banco, não por 30 caminhos de escrita fazendo "lê, depois insere".
--
-- Sintoma: o mesmo lead aparece duas vezes na mesma etapa. Medido em prod
-- (13/10): 84 grupos (funil, lead) com 2+ cards abertos —
--   27 grupos com TODOS os cards sem negócio (29 cards a mais, 6 orgs; 8 deles
--      nascidos com < 5s de diferença: corrida webhook × workflow);
--   53 grupos com todos os cards COM negócio;
--    4 mistos (sem negócio + com negócio — o caso que o #2299 passou a adotar).
--
-- Causa: as três travas de (pipeline_id, lead_id) caíram de propósito em
-- 20270730000050 — recompra exige N negócios do mesmo lead no mesmo funil,
-- inclusive dois abertos ao mesmo tempo (ADR-0023 decisão 2). Nada as
-- substituiu para o card que NÃO é negócio. Todo dedupe virou leitura seguida
-- de insert na aplicação, e dois escritores concorrentes passam juntos.
--
-- A invariante deste arquivo é a parte de "um por lead" que o ADR NÃO revogou:
-- dois cards sem negócio do mesmo lead no mesmo funil não representam nada —
-- não há duas tentativas de venda, há uma pessoa duplicada no quadro, e as
-- automações andam nas duas. Os 53 grupos COM negócio ficam como estão: são
-- recompra pelo ADR, e não há como distingui-los de engano sem perguntar.
--
-- O que muda:
--   1. `_repontar_dependentes_do_card` — leva comentários, reuniões, execuções
--      de workflow, follow-ups, ações do dia, checklists e itens de proposta de
--      um card sem negócio para outro do MESMO lead. Única porta de fusão,
--      usada pela limpeza e pelo `mover_negocio`.
--   2. Limpeza dos 27 grupos: fica o card que andou por último
--      (stage_changed_at), os outros têm os dependentes re-apontados e são
--      apagados. Cópia integral em `backup.cards_sem_negocio_fundidos_20271119`.
--   3. Índice único parcial (pipeline_id, lead_id) WHERE closed_at IS NULL AND
--      deal_id IS NULL. Quem perder a corrida recebe 23505 — os chamadores
--      (pipeline-adapter, move-stage, front) tratam.
--   4. `mover_negocio`: card sem negócio indo para funil onde o lead JÁ tem card
--      aberto sem negócio é FUNDIDO no que já está lá (que mantém a etapa — o
--      mesmo critério do #2299: mover reabriria as automações de entrada), e a
--      função devolve o id que sobreviveu. Antes, o UPDATE de pipeline_id
--      plantava o duplicado.
--   5. `bulk_move_pipeline_entries`: confere o card pelo id que `mover_negocio`
--      devolveu (o original some na fusão).
--
-- Fora do índice, de propósito: card com negócio (recompra) e card fechado.
-- Corpos base de mover_negocio e bulk_move_pipeline_entries = prod (13/10).
-- ============================================================================

-- Transação explícita: o CLI NÃO embrulha o arquivo, e LOCK TABLE/SET LOCAL
-- exigem bloco (25P01 em banco novo). Em prod foi aplicada assim, à mão.
BEGIN;

SET LOCAL lock_timeout = '10s';


-- ── 1. Porta única de fusão ──────────────────────────────────────────────────
--
-- SECURITY DEFINER porque re-aponta tabelas (workflow_executions, meetings...)
-- que o vendedor não escreve sob RLS. O alcance é estreito de propósito: só
-- entre dois cards SEM negócio do MESMO lead na MESMA org, numa org do
-- chamador. O DELETE do card que sai NÃO mora aqui — fica com o chamador
-- (`mover_negocio` é invoker), para a RLS de pipeline_entries continuar valendo.
CREATE OR REPLACE FUNCTION public._repontar_dependentes_do_card(p_de uuid, p_para uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_de   public.pipeline_entries%ROWTYPE;
  v_para public.pipeline_entries%ROWTYPE;
  v_uid  uuid := auth.uid();
BEGIN
  SELECT * INTO v_de   FROM public.pipeline_entries WHERE id = p_de;
  SELECT * INTO v_para FROM public.pipeline_entries WHERE id = p_para;

  IF v_de.id IS NULL OR v_para.id IS NULL OR p_de = p_para THEN
    RAISE EXCEPTION 'Card de origem ou de destino da fusão não encontrado.'
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_de.organization_id <> v_para.organization_id
     OR v_de.lead_id IS DISTINCT FROM v_para.lead_id
     OR v_de.deal_id IS NOT NULL
     OR v_para.deal_id IS NOT NULL THEN
    RAISE EXCEPTION 'Só se funde card sem negócio em outro card sem negócio do mesmo lead.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Sem JWT (migration, service_role) passa; com JWT, a org tem de ser do
  -- chamador. anon nem chega aqui (sem EXECUTE).
  IF v_uid IS NOT NULL
     AND NOT public.is_master_user()
     AND v_de.organization_id NOT IN (SELECT public.get_my_organization_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a este card.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.follow_ups          SET pipeline_entry_id = p_para WHERE pipeline_entry_id = p_de;
  UPDATE public.workflow_executions SET pipeline_entry_id = p_para WHERE pipeline_entry_id = p_de;
  UPDATE public.acoes_do_dia        SET pipeline_entry_id = p_para WHERE pipeline_entry_id = p_de;
  UPDATE public.acoes_do_dia        SET proposta_id       = p_para WHERE proposta_id       = p_de;
  UPDATE public.acoes_do_dia        SET confirmacao_id    = p_para WHERE confirmacao_id    = p_de;
  UPDATE public.pipe_proposta_items SET pipe_proposta_id  = p_para WHERE pipe_proposta_id  = p_de;

  -- Três vínculos que o domínio NÃO deixa trocar de card. Ficam onde estão e,
  -- quando o card sai, o FK ON DELETE SET NULL solta só o link — o registro
  -- segue com lead, org e histórico (os gatilhos aceitam ir a NULL):
  --   comentário com anexo   — o caminho no storage carrega o id do card
  --                            (validate_deal_comment_documents);
  --   reunião de outro funil — guarda o funil em que foi marcada
  --                            (fn_meeting_bind_booking);
  --   comissão projetada     — imutável, ADR-0017 §6
  --                            (fn_commissions_protect_projection).
  UPDATE public.lead_comments SET pipeline_entry_id = p_para
   WHERE pipeline_entry_id = p_de
     AND attachments = '[]'::jsonb;
  UPDATE public.meetings SET pipeline_entry_id = p_para
   WHERE pipeline_entry_id = p_de
     AND (lead_id IS NULL
          OR (event_type IS NOT NULL AND event_type <> 'meeting')
          OR pipeline_id = v_para.pipeline_id);
  UPDATE public.commissions SET pipe_proposta_id = p_para
   WHERE pipe_proposta_id = p_de
     AND source IS DISTINCT FROM 'sale_event_projection';

  -- Únicos por card: só leva quando o destino ainda não tem. O que sobrar
  -- segue a FK do card que sai (CASCADE em checklists/tinyerp, SET NULL em
  -- upsell) — é a duplicata do que o destino já carrega.
  UPDATE public.checklists c SET pipeline_entry_id = p_para
   WHERE c.pipeline_entry_id = p_de
     AND (c.source_template_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM public.checklists w
           WHERE w.pipeline_entry_id = p_para AND w.source_template_id = c.source_template_id));
  UPDATE public.upsell_orders SET pipe_proposta_id = p_para
   WHERE pipe_proposta_id = p_de
     AND NOT EXISTS (SELECT 1 FROM public.upsell_orders WHERE pipe_proposta_id = p_para);
  UPDATE public.tinyerp_order_mappings SET pipe_proposta_id = p_para
   WHERE pipe_proposta_id = p_de
     AND NOT EXISTS (SELECT 1 FROM public.tinyerp_order_mappings WHERE pipe_proposta_id = p_para);
END;
$function$;

REVOKE ALL ON FUNCTION public._repontar_dependentes_do_card(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._repontar_dependentes_do_card(uuid, uuid) TO authenticated, service_role;


-- ── 2. Limpeza dos duplicados existentes ────────────────────────────────────
--
-- Trava de escrita na tabela ANTES de ler: sem ela, um card duplicado que um
-- webhook commitasse entre a limpeza e o CREATE INDEX derrubaria o arquivo.
-- SHARE ROW EXCLUSIVE deixa leitura passar e segura escrita por ~segundos.
LOCK TABLE public.pipeline_entries IN SHARE ROW EXCLUSIVE MODE;

CREATE SCHEMA IF NOT EXISTS backup;  -- existe em prod; banco novo depende de 20260916164400
CREATE TABLE IF NOT EXISTS backup.cards_sem_negocio_fundidos_20271119 (
  fundido_em  timestamptz NOT NULL DEFAULT now(),
  mantido_id  uuid        NOT NULL,
  card        jsonb       NOT NULL
);
REVOKE ALL ON backup.cards_sem_negocio_fundidos_20271119 FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE backup.cards_sem_negocio_fundidos_20271119 IS
  'Cards sem negócio duplicados apagados por 20271119000000 (linha inteira em `card`). Só operador; sem policies nem grants.';

DO $$
DECLARE
  r record;
  v_total integer := 0;
BEGIN
  FOR r IN
    WITH abertos AS (
      SELECT pe.id, pe.pipeline_id, pe.lead_id,
             first_value(pe.id) OVER w AS mantido_id,
             row_number()       OVER w AS rn
        FROM public.pipeline_entries pe
       WHERE pe.closed_at IS NULL AND pe.deal_id IS NULL AND pe.lead_id IS NOT NULL
      WINDOW w AS (PARTITION BY pe.pipeline_id, pe.lead_id
                   ORDER BY pe.stage_changed_at DESC NULLS LAST, pe.created_at, pe.id)
    )
    SELECT a.id, a.mantido_id FROM abertos a WHERE a.rn > 1 ORDER BY a.mantido_id, a.id
  LOOP
    INSERT INTO backup.cards_sem_negocio_fundidos_20271119 (mantido_id, card)
    SELECT r.mantido_id, to_jsonb(pe) FROM public.pipeline_entries pe WHERE pe.id = r.id;

    PERFORM public._repontar_dependentes_do_card(r.id, r.mantido_id);
    DELETE FROM public.pipeline_entries WHERE id = r.id;
    v_total := v_total + 1;
  END LOOP;

  RAISE NOTICE 'cards sem negócio duplicados fundidos: %', v_total;
END;
$$;


-- ── 3. A invariante ─────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_pipeline_entries_um_card_sem_negocio
  ON public.pipeline_entries (pipeline_id, lead_id)
  WHERE closed_at IS NULL AND deal_id IS NULL AND lead_id IS NOT NULL;

COMMENT ON INDEX public.uq_pipeline_entries_um_card_sem_negocio IS
  'Um card aberto SEM negócio por lead em cada funil. Card com negócio fica fora (recompra, ADR-0023 d2).';


-- ── 4. mover_negocio funde em vez de duplicar ───────────────────────────────
CREATE OR REPLACE FUNCTION public.mover_negocio(p_entry_id uuid, p_target_pipeline_id uuid, p_target_stage_key text, p_stage_origem text DEFAULT NULL::text, p_assigned_to uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_org        uuid;
  v_lead       uuid;
  v_deal       uuid;
  v_closed     timestamptz;
  v_pipe_atual uuid;
  v_stage_atual text;
  v_tipo_alvo  text;
  v_org_alvo   uuid;
  v_stage_key  text;
  v_existente  uuid;
BEGIN
  SELECT pe.organization_id, pe.lead_id, pe.deal_id, pe.closed_at, pe.pipeline_id, pe.stage_key
    INTO v_org, v_lead, v_deal, v_closed, v_pipe_atual, v_stage_atual
    FROM public.pipeline_entries pe
   WHERE pe.id = p_entry_id FOR UPDATE;

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

  IF p_target_stage_key IS NULL OR btrim(p_target_stage_key) = '' THEN
    RAISE EXCEPTION 'Etapa de destino é obrigatória.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_stage_key := btrim(p_target_stage_key);

  -- Etapa por uuid (qualquer destino) resolve para a key; por key, destino
  -- custom valida pertencimento. Um uuid que não é etapa do destino era, na
  -- prática antiga, gravado cru em stage_key — o bug do card invisível que o
  -- reparo 2b da SCRUM-617 teve que curar. Errar alto aqui evita a recaída.
  IF v_stage_key ~ v_uuid_re THEN
    SELECT ps.stage_key INTO v_stage_key
      FROM public.pipeline_stages ps
     WHERE ps.id = v_stage_key::uuid AND ps.pipeline_id = p_target_pipeline_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Etapa "%" não existe no funil %.', p_target_stage_key, p_target_pipeline_id
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.pipeline_stages ps
                    WHERE ps.pipeline_id = p_target_pipeline_id
                      AND ps.stage_key = v_stage_key) THEN
      RAISE EXCEPTION 'Etapa "%" não existe no funil %.', p_target_stage_key, p_target_pipeline_id
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END IF;

  IF v_pipe_atual = p_target_pipeline_id AND v_stage_atual = v_stage_key THEN
    IF p_assigned_to IS NOT NULL THEN
      UPDATE public.pipeline_entries SET assigned_to = p_assigned_to
       WHERE id = p_entry_id AND assigned_to IS DISTINCT FROM p_assigned_to;
    END IF;
    RETURN p_entry_id; -- retry da transferência não passa novamente pelo ganho
  END IF;
  IF NULLIF(btrim(p_stage_origem), '') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.pipeline_stages WHERE pipeline_id = v_pipe_atual
      AND stage_key = p_stage_origem AND organization_id = v_org
  ) THEN RAISE EXCEPTION 'Etapa de origem inválida.' USING ERRCODE = '22023'; END IF;

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

  -- ── Passo 2a: card sem negócio chegando onde o lead já tem um ───────────
  -- Mover plantaria o duplicado (e o índice uq_pipeline_entries_um_card_sem_negocio
  -- recusaria). O lead JÁ está no destino: o card de lá fica — com a etapa
  -- dele, como no #2299 — e recebe os dependentes deste, que é apagado.
  -- Devolve o id que sobreviveu; quem chama e usa o id precisa ler o retorno.
  IF v_pipe_atual <> p_target_pipeline_id AND v_deal IS NULL AND v_closed IS NULL THEN
    SELECT pe.id INTO v_existente
      FROM public.pipeline_entries pe
     WHERE pe.pipeline_id = p_target_pipeline_id
       AND pe.lead_id = v_lead
       AND pe.deal_id IS NULL
       AND pe.closed_at IS NULL
     FOR UPDATE;

    IF v_existente IS NOT NULL THEN
      PERFORM public._repontar_dependentes_do_card(p_entry_id, v_existente);

      IF p_assigned_to IS NOT NULL THEN
        UPDATE public.pipeline_entries SET assigned_to = p_assigned_to
         WHERE id = v_existente AND assigned_to IS DISTINCT FROM p_assigned_to;
      END IF;

      DELETE FROM public.pipeline_entries WHERE id = p_entry_id;
      IF NOT FOUND THEN
        -- RLS deixou ler e travar, mas não apagar: aborta tudo, inclusive o
        -- re-apontamento acima.
        RAISE EXCEPTION 'Sem permissão para unir este card ao que o lead já tem no funil de destino.'
          USING ERRCODE = 'insufficient_privilege';
      END IF;

      RETURN v_existente;
    END IF;
  END IF;

  -- ── Passo 2: a troca de funil ───────────────────────────────────────────
  -- `assigned_to` só é tocado quando veio explícito: `COALESCE` cegamente
  -- apagaria o responsável do card quando o chamador não informa nada.
  -- O espelho (trg_pe_stage_mirror) re-resolve stage_id ao ver o funil mudar.
  -- 23505 aqui = o card do destino existe mas a RLS do chamador não o mostra
  -- (visibilidade por vendedor), ou chegou por corrida depois da leitura acima.
  BEGIN
    UPDATE public.pipeline_entries
       SET pipeline_id = p_target_pipeline_id,
           stage_key   = v_stage_key,
           assigned_to = COALESCE(p_assigned_to, assigned_to)
     WHERE id = p_entry_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Este lead já tem um card sem negócio no funil de destino.'
      USING ERRCODE = 'unique_violation';
  END;

  RETURN p_entry_id;
END;
$function$;


-- ── 5. bulk_move confere o card que sobreviveu ──────────────────────────────
CREATE OR REPLACE FUNCTION public.bulk_move_pipeline_entries(p_entry_ids uuid[], p_source_pipeline_id uuid, p_target_pipeline_id uuid, p_target_stage_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_id uuid;
  v_res uuid;
  v_pipeline uuid;
  v_stage text;
  v_target_key text;
  v_count integer := 0;
BEGIN
  IF p_entry_ids IS NULL OR cardinality(p_entry_ids) = 0 OR cardinality(p_entry_ids) > 1000
    OR array_position(p_entry_ids, NULL) IS NOT NULL OR p_source_pipeline_id IS NULL THEN
    RAISE EXCEPTION 'Selecione de 1 a 1000 negócios de origem.' USING ERRCODE = '22023';
  END IF;
  SELECT s.stage_key INTO v_target_key FROM public.pipeline_stages s
    JOIN public.pipelines p ON p.id = s.pipeline_id
    WHERE s.id = p_target_stage_id AND p.id = p_target_pipeline_id AND p.is_active AND s.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Funil ou etapa de destino indisponível.' USING ERRCODE = '22023';
  END IF;
  -- Stable lock ordering avoids deadlocks between overlapping bulk selections.
  FOR v_id IN SELECT DISTINCT x FROM unnest(p_entry_ids) AS ids(x) ORDER BY x LOOP
    SELECT pipeline_id, stage_key INTO v_pipeline, v_stage
      FROM public.pipeline_entries WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Negócio não encontrado ou sem acesso.' USING ERRCODE = '42501';
    END IF;
    IF v_pipeline = p_target_pipeline_id AND v_stage = v_target_key THEN
      v_count := v_count + 1;
      CONTINUE; -- Retry after success must not move/close again.
    END IF;
    IF v_pipeline IS DISTINCT FROM p_source_pipeline_id THEN
      RAISE EXCEPTION 'O negócio mudou de funil. Atualize a seleção.' USING ERRCODE = 'PT409';
    END IF;
    v_res := public.mover_negocio(v_id, p_target_pipeline_id, p_target_stage_id::text);
    -- Fundido (v_res <> v_id): o card que ficou mantém a própria etapa.
    IF NOT EXISTS (SELECT 1 FROM public.pipeline_entries
      WHERE id = v_res AND pipeline_id = p_target_pipeline_id
        AND (v_res <> v_id OR stage_key = v_target_key)) THEN
      RAISE EXCEPTION 'Movimentação não autorizada.' USING ERRCODE = '42501';
    END IF;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

COMMIT;
