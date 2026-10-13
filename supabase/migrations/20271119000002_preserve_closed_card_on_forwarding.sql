-- Created by Supabase CLI as 20261013193304; ordered after the existing
-- future-dated merge helper prerequisite. No data cleanup or backfill.
-- Keep invoker security and all existing permissions.
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
  v_closed_after_transition timestamptz;
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
      -- The origin success-stage trigger may have just closed this card.
      -- Preserve that completed history and adopt the existing destination.
      -- Only cards that remain open may transfer dependents and be deleted.
      SELECT pe.closed_at INTO v_closed_after_transition
        FROM public.pipeline_entries pe WHERE pe.id = p_entry_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Negócio de origem não encontrado após a transição.'
          USING ERRCODE = 'no_data_found';
      END IF;

      IF v_closed_after_transition IS NULL THEN
        PERFORM public._repontar_dependentes_do_card(p_entry_id, v_existente);
      END IF;

      IF p_assigned_to IS NOT NULL THEN
        UPDATE public.pipeline_entries SET assigned_to = p_assigned_to
         WHERE id = v_existente AND assigned_to IS DISTINCT FROM p_assigned_to;
      END IF;

      IF v_closed_after_transition IS NULL THEN
        DELETE FROM public.pipeline_entries WHERE id = p_entry_id;
        IF NOT FOUND THEN
          -- RLS denied deletion: roll back the dependent transfers as well.
          RAISE EXCEPTION 'Sem permissão para unir este card ao que o lead já tem no funil de destino.'
            USING ERRCODE = 'insufficient_privilege';
        END IF;
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
