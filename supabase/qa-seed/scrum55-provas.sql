-- ============================================================================
-- SCRUM-55 — as provas de comportamento que faltavam.
--
--   `inv:H3-05` (SCRUM-76) — o auto-seed decide POR ORG pela flag
--   `inv:H3-18` (SCRUM-91) — a limpeza cross-org tem guarda e faz backup
--
-- O rollback (`inv:H3-16`) roda em arquivo próprio, por último: ele derruba
-- colunas de que o M6 depende.
-- ============================================================================

DROP TABLE IF EXISTS public.qa_resultado_55;
CREATE TABLE public.qa_resultado_55 (caso text, esperado text, obtido text, passou boolean);

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ── H3-05 · flag DESLIGADA: o Negócio nasce sozinho, como sempre nasceu ───
DO $$
DECLARE v_entries int;
BEGIN
  INSERT INTO public.leads (id, organization_id, name, origin)
  VALUES ('55e10000-0000-0000-0000-0000000000aa', '55a00000-0000-0000-0000-0000000000aa',
          'Lead da org sem flag', 'outro');
  -- O gatilho é DEFERRABLE INITIALLY DEFERRED: a flag é lida no COMMIT, não no
  -- INSERT. Sem forçar, a medição abaixo leria o estado de antes do gatilho.
  SET CONSTRAINTS ALL IMMEDIATE;

  SELECT count(*) INTO v_entries FROM public.pipeline_entries
   WHERE lead_id = '55e10000-0000-0000-0000-0000000000aa';

  INSERT INTO public.qa_resultado_55 VALUES
    ('H3-05 · flag OFF: auto-seed CRIA o Negócio (comportamento histórico)', '1', v_entries::text, v_entries = 1);
END $$;

-- ── H3-05 · flag LIGADA: mesmo INSERT, nenhum Negócio ─────────────────────
DO $$
DECLARE v_entries int; v_lead int;
BEGIN
  INSERT INTO public.leads (id, organization_id, name, origin)
  VALUES ('55e20000-0000-0000-0000-0000000000bb', '55b00000-0000-0000-0000-0000000000bb',
          'Lead da org com flag', 'outro');
  SET CONSTRAINTS ALL IMMEDIATE;

  SELECT count(*) INTO v_entries FROM public.pipeline_entries
   WHERE lead_id = '55e20000-0000-0000-0000-0000000000bb';
  SELECT count(*) INTO v_lead FROM public.leads
   WHERE id = '55e20000-0000-0000-0000-0000000000bb';

  INSERT INTO public.qa_resultado_55 VALUES
    ('H3-05 · flag ON: auto-seed NÃO cria Negócio', '0', v_entries::text, v_entries = 0),
    ('H3-05 · flag ON: o LEAD entra na base do mesmo jeito', '1', v_lead::text, v_lead = 1);
END $$;

-- ── H3-05 · a decisão é POR ORG, não global ───────────────────────────────
DO $$
DECLARE v_a int; v_b int;
BEGIN
  SELECT count(*) INTO v_a FROM public.pipeline_entries pe
    JOIN public.leads l ON l.id = pe.lead_id
   WHERE l.organization_id = '55a00000-0000-0000-0000-0000000000aa';
  SELECT count(*) INTO v_b FROM public.pipeline_entries pe
    JOIN public.leads l ON l.id = pe.lead_id
   WHERE l.organization_id = '55b00000-0000-0000-0000-0000000000bb';

  INSERT INTO public.qa_resultado_55 VALUES
    ('H3-05 · as duas orgs na MESMA base decidem diferente', 'A>0 e B=0',
     format('A=%s B=%s', v_a, v_b), v_a > 0 AND v_b = 0);
END $$;

-- ── H3-18 · a guarda: com a trava do M6 no ar, a limpeza tem que RECUSAR ──
-- O bloco 0 do script existe porque, com o M6 ativo, todo UPDATE nas linhas
-- sujas falha — inclusive o da própria limpeza. Recusar é melhor que descobrir
-- pelo erro no meio da execução.
DO $$
DECLARE v_travas int;
BEGIN
  SELECT count(*) INTO v_travas
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  WHERE NOT t.tgisinternal
    AND t.tgname LIKE 'trg_assert_member_same_org%'
    AND t.tgenabled <> 'D';

  INSERT INTO public.qa_resultado_55 VALUES
    ('H3-18 · a trava do M6 está no ar (o que faz a guarda ser necessária)', '3',
     v_travas::text, v_travas = 3);
END $$;

-- ── H3-18 · a sujeira existe e está medida ────────────────────────────────
DO $$
DECLARE v_sujo int; v_limpo int;
BEGIN
  SELECT count(*) INTO v_sujo
  FROM public.leads l
  JOIN public.team_members tm ON tm.id = l.responsible_id
  WHERE tm.organization_id <> l.organization_id;

  SELECT count(*) INTO v_limpo
  FROM public.leads l
  JOIN public.team_members tm ON tm.id = l.responsible_id
  WHERE tm.organization_id = l.organization_id;

  INSERT INTO public.qa_resultado_55 VALUES
    ('H3-18 · fixture tem 1 lead com responsável de outra org', '1', v_sujo::text, v_sujo = 1),
    ('H3-18 · e 1 lead com responsável da própria org (que não pode ser tocado)', '1', v_limpo::text, v_limpo = 1);
END $$;

SELECT 'provas H3-05 e H3-18 (parte 1) registradas' AS etapa;
