-- ANTES — ensaio do passo 2 da SCRUM-674 contra PRODUÇÃO.
--
-- Escreve pelas views com os triggers VELHOS e guarda o retrato. O `-depois`
-- repete a MESMA escrita com os triggers novos e compara byte a byte. É a prova
-- mais forte disponível: mesmos insumos, código velho vs código novo.
--
-- Nunca rodar sozinho: o .sh monta este + a migration + o `-depois`, que aborta.

BEGIN;

CREATE TEMP TABLE _ensaio674 (
  chave  text PRIMARY KEY,
  valor  text
) ON COMMIT DROP;

DO $$
DECLARE
  v_org   uuid;
  v_lead  uuid;
  v_pre   uuid;
  v_sale  uuid;
  v_slug  text;
  v_id    uuid;
  v_recorte text := 'id,created_at,updated_at,entered_at,stage_changed_at';
BEGIN
  -- As funções do passo 1 TÊM que existir: este passo delega a elas.
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname LIKE 'fn_entrada_%') <> 4 THEN
    RAISE EXCEPTION 'ENSAIO ABORTADO: as 4 funções do passo 1 não estão em prod. Aplique a 20270930000000 antes.';
  END IF;

  SELECT p.organization_id INTO v_org
    FROM public.pipelines p
   WHERE p.type='system' AND p.slug IN ('whatsapp','confirmacao','propostas')
   GROUP BY p.organization_id
  HAVING count(DISTINCT p.slug)=3
     AND EXISTS (SELECT 1 FROM public.leads l WHERE l.organization_id=p.organization_id)
     AND (SELECT count(*) FROM public.team_members m WHERE m.organization_id=p.organization_id) >= 2
   ORDER BY p.organization_id LIMIT 1;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'ENSAIO ABORTADO: nenhuma org com os 3 funis, lead e 2+ membros. Sem dado real não mede.';
  END IF;

  SELECT id INTO v_lead FROM public.leads        WHERE organization_id=v_org LIMIT 1;
  SELECT id INTO v_pre  FROM public.team_members WHERE organization_id=v_org ORDER BY id LIMIT 1;
  SELECT id INTO v_sale FROM public.team_members WHERE organization_id=v_org AND id<>v_pre ORDER BY id LIMIT 1;

  INSERT INTO _ensaio674 VALUES
    ('org', v_org::text), ('lead', v_lead::text), ('pre', v_pre::text), ('sale', v_sale::text);

  -- ── INSERT pelas views, triggers VELHOS ────────────────────────────────
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

    INSERT INTO _ensaio674
    SELECT 'ins_'||v_slug, md5((to_jsonb(pe) - string_to_array(v_recorte,','))::text)
      FROM public.pipeline_entries pe WHERE pe.id = v_id;
  END LOOP;

  -- ── UPDATE pelas views, triggers VELHOS ────────────────────────────────
  FOREACH v_slug IN ARRAY ARRAY['whatsapp','confirmacao','propostas'] LOOP
    v_id := gen_random_uuid();
    EXECUTE format(
      'INSERT INTO public.pipe_%s (id, lead_id, organization_id) VALUES ($1,$2,$3)',
      v_slug) USING v_id, v_lead, v_org;
    EXECUTE format(
      'UPDATE public.pipe_%s SET responsible_id=$2, pre_sale_responsible_id=$3, sale_responsible_id=$4, notes=$5 WHERE id=$1',
      v_slug) USING v_id, v_sale, v_pre, v_sale, 'upd674';

    INSERT INTO _ensaio674
    SELECT 'upd_'||v_slug, md5((to_jsonb(pe) - string_to_array(v_recorte,','))::text)
      FROM public.pipeline_entries pe WHERE pe.id = v_id;
  END LOOP;

  RAISE NOTICE 'ANTES capturado: % retratos', (SELECT count(*) FROM _ensaio674 WHERE chave LIKE 'ins_%' OR chave LIKE 'upd_%');
END $$;
