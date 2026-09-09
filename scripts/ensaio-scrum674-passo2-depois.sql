-- DEPOIS — asserções do ensaio do passo 2 da SCRUM-674.
-- Repete as MESMAS escritas com os triggers novos e compara com o retrato do
-- `antes`. Aborta com ENSAIO_OK. Nada é gravado.

DO $$
DECLARE
  v_org   uuid := (SELECT valor::uuid FROM _ensaio674 WHERE chave='org');
  v_lead  uuid := (SELECT valor::uuid FROM _ensaio674 WHERE chave='lead');
  v_pre   uuid := (SELECT valor::uuid FROM _ensaio674 WHERE chave='pre');
  v_sale  uuid := (SELECT valor::uuid FROM _ensaio674 WHERE chave='sale');
  v_slug  text;
  v_id    uuid;
  v_novo  text;
  v_velho text;
  v_divergs int := 0;
  v_relato  text := '';
  v_recorte text := 'id,created_at,updated_at,entered_at,stage_changed_at';
BEGIN
  -- Controle de que a migration REALMENTE trocou os corpos. Sem isto, um
  -- arquivo vazio passaria verde comparando o velho com o velho.
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public'
         AND p.proname IN ('pipe_whatsapp_insert_fn','pipe_whatsapp_update_fn',
                           'pipe_confirmacao_insert_fn','pipe_confirmacao_update_fn',
                           'pipe_propostas_insert_fn','pipe_propostas_update_fn',
                           'custom_pipe_entries_insert_fn','custom_pipe_entries_update_fn')
         AND p.prosrc ~* 'fn_entrada_(sistema|custom)_(criar|atualizar)') <> 8 THEN
    RAISE EXCEPTION 'ENSAIO ABORTADO: os 8 triggers não estão delegando. A migration não fez efeito — comparar agora mediria velho contra velho.';
  END IF;

  -- ── INSERT pelas views, triggers NOVOS, MESMOS insumos ─────────────────
  FOREACH v_slug IN ARRAY ARRAY['whatsapp','confirmacao','propostas'] LOOP
    v_id := gen_random_uuid();
    EXECUTE format(
      -- Só as colunas COMUNS às três views: whatsapp não tem closer_id nem
      -- metrics_period_at, propostas não tem sdr_id. O que precisa ser provado é
      -- que a delegação é byte-idêntica, e o conjunto comum já exercita a
      -- derivação de assigned_to (responsible_id é o primeiro de todo COALESCE)
      -- e o par.
      'INSERT INTO public.pipe_%s (id, lead_id, organization_id, responsible_id, pre_sale_responsible_id, sale_responsible_id, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      v_slug) USING v_id, v_lead, v_org, v_pre, v_pre, v_sale, 'ensaio674';

    SELECT md5((to_jsonb(pe) - string_to_array(v_recorte,','))::text) INTO v_novo
      FROM public.pipeline_entries pe WHERE pe.id = v_id;
    SELECT valor INTO v_velho FROM _ensaio674 WHERE chave = 'ins_'||v_slug;

    IF v_novo IS DISTINCT FROM v_velho THEN
      v_divergs := v_divergs + 1;
      v_relato := v_relato || format(E'\n  INSERT %s diverge\n    novo=%s',
        v_slug, (SELECT (to_jsonb(pe) - string_to_array(v_recorte,','))::text
                   FROM public.pipeline_entries pe WHERE pe.id=v_id));
    ELSE
      RAISE NOTICE '  OK insert % idêntico ao trigger velho', v_slug;
    END IF;
  END LOOP;

  -- ── UPDATE pelas views, triggers NOVOS, MESMOS insumos ─────────────────
  FOREACH v_slug IN ARRAY ARRAY['whatsapp','confirmacao','propostas'] LOOP
    v_id := gen_random_uuid();
    EXECUTE format(
      'INSERT INTO public.pipe_%s (id, lead_id, organization_id) VALUES ($1,$2,$3)',
      v_slug) USING v_id, v_lead, v_org;
    EXECUTE format(
      'UPDATE public.pipe_%s SET responsible_id=$2, pre_sale_responsible_id=$3, sale_responsible_id=$4, notes=$5 WHERE id=$1',
      v_slug) USING v_id, v_sale, v_pre, v_sale, 'upd674';

    SELECT md5((to_jsonb(pe) - string_to_array(v_recorte,','))::text) INTO v_novo
      FROM public.pipeline_entries pe WHERE pe.id = v_id;
    SELECT valor INTO v_velho FROM _ensaio674 WHERE chave = 'upd_'||v_slug;

    IF v_novo IS DISTINCT FROM v_velho THEN
      v_divergs := v_divergs + 1;
      v_relato := v_relato || format(E'\n  UPDATE %s diverge\n    novo=%s',
        v_slug, (SELECT (to_jsonb(pe) - string_to_array(v_recorte,','))::text
                   FROM public.pipeline_entries pe WHERE pe.id=v_id));
    ELSE
      RAISE NOTICE '  OK update % idêntico ao trigger velho', v_slug;
    END IF;
  END LOOP;

  IF v_divergs > 0 THEN
    RAISE EXCEPTION 'ENSAIO REPROVOU: % operação(ões) mudaram de comportamento. O passo 2 tinha que ser inerte.%', v_divergs, v_relato;
  END IF;

  -- ── CONTROLE POSITIVO ───────────────────────────────────────────────────
  -- Insumo diferente TEM que dar md5 diferente. Sem isto, o md5 poderia estar
  -- comparando duas coisas constantes e passando verde por construção.
  v_id := gen_random_uuid();
  INSERT INTO public.pipe_whatsapp (id, lead_id, organization_id, responsible_id,
                                    pre_sale_responsible_id, sale_responsible_id, notes)
  VALUES (v_id, v_lead, v_org, v_sale, v_sale, v_pre, 'controle');
  SELECT md5((to_jsonb(pe) - string_to_array(v_recorte,','))::text) INTO v_novo
    FROM public.pipeline_entries pe WHERE pe.id=v_id;
  IF v_novo = (SELECT valor FROM _ensaio674 WHERE chave='ins_whatsapp') THEN
    RAISE EXCEPTION 'CONTROLE POSITIVO FALHOU: insumo diferente deu o MESMO md5. O ensaio não mede nada.';
  END IF;
  RAISE NOTICE '  OK controle positivo (insumo diferente diverge, como deve)';

  -- ── custom_pipe_entries: stage_key tem que continuar sendo derivado ─────
  DECLARE
    v_pipe uuid; v_st uuid; v_sk text; v_org_c uuid; v_lead_c uuid; v_gravado text;
  BEGIN
    SELECT p.id, p.organization_id, s.id, s.stage_key INTO v_pipe, v_org_c, v_st, v_sk
      FROM public.pipelines p JOIN public.pipeline_stages s ON s.pipeline_id=p.id
     WHERE p.type='custom' AND p.is_active
       AND EXISTS (SELECT 1 FROM public.leads l WHERE l.organization_id=p.organization_id)
     LIMIT 1;
    IF v_pipe IS NULL THEN
      RAISE EXCEPTION 'ENSAIO ABORTADO: nenhum funil custom com etapa e lead.';
    END IF;
    SELECT id INTO v_lead_c FROM public.leads WHERE organization_id=v_org_c LIMIT 1;

    v_id := gen_random_uuid();
    INSERT INTO public.custom_pipe_entries (id, organization_id, pipeline_id, lead_id, stage_id)
    VALUES (v_id, v_org_c, v_pipe, v_lead_c, v_st);

    SELECT stage_key INTO v_gravado FROM public.pipeline_entries WHERE id=v_id;
    IF v_gravado IS DISTINCT FROM v_sk THEN
      RAISE EXCEPTION 'REPROVOU: escrita pela view custom parou de derivar stage_key (esperado=%, gravado=%). Os AFTER OF stage_key ficariam mudos.', v_sk, v_gravado;
    END IF;
    RAISE NOTICE '  OK custom_pipe_entries ainda deriva stage_key (%)', v_gravado;
  END;

  RAISE EXCEPTION 'ENSAIO_OK SCRUM-674 passo 2 — os 8 triggers delegam e o comportamento é byte-idêntico. Abortando; nada foi gravado.';
END $$;

ROLLBACK;
