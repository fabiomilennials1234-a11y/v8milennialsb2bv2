-- scripts/ensaio-1693-depois.sql — parte 3 do ensaio transacional do #1693.
-- Roda DEPOIS da migration, dentro da MESMA transação, e termina em ROLLBACK.
-- Ver o cabeçalho de scripts/ensaio-1693-antes.sql.

-- ─── VERDE: a nova definição sobre a mesma matriz ───────────────────────────
CREATE TEMP TABLE e_cand_fix_depois AS
SELECT x.id
FROM e_param p
CROSS JOIN LATERAL public.find_leads_no_reply(p.org_fixture, p.cutoff, 1000000) AS x(id);

CREATE TEMP TABLE e_fix_depois AS
SELECT f.tag, f.lead_id, f.esperado_antes, f.esperado_depois, f.porque,
       (f.lead_id IN (SELECT id FROM e_cand_fix_depois)) AS presente
FROM e_fix f;

DO $ensaio$
DECLARE
  v_erros text;
BEGIN
  SELECT string_agg(tag || ' (esperado=' || esperado_depois || ', obtido=' || presente || ')', '; ')
    INTO v_erros
  FROM e_fix_depois
  WHERE presente IS DISTINCT FROM esperado_depois;

  IF v_erros IS NOT NULL THEN
    RAISE EXCEPTION 'ENSAIO 1693 / VERDE FALHOU: %', v_erros;
  END IF;
END
$ensaio$;

-- ─── DEPOIS, no universo inteiro ────────────────────────────────────────────
CREATE TEMP TABLE e_depois AS
SELECT g.org_id, f.id AS lead_id
FROM e_orgs g, e_param p
CROSS JOIN LATERAL public.find_leads_no_reply(g.org_id, p.cutoff, 1000000) AS f(id);

-- Os leads plantados não existiam quando o ANTES foi medido; compará-los aqui
-- misturaria o efeito da mudança com o efeito do fixture.
CREATE TEMP TABLE e_diff AS
SELECT
  g.org_id,
  g.org_name,
  g.cm_total,
  (SELECT count(*) FROM e_antes a  WHERE a.org_id = g.org_id
     AND a.lead_id NOT IN (SELECT lead_id FROM e_fix))                          AS antes,
  (SELECT count(*) FROM e_depois d WHERE d.org_id = g.org_id
     AND d.lead_id NOT IN (SELECT lead_id FROM e_fix))                          AS depois,
  (SELECT count(*) FROM e_antes a  WHERE a.org_id = g.org_id
     AND a.lead_id NOT IN (SELECT lead_id FROM e_fix)
     AND NOT EXISTS (SELECT 1 FROM e_depois d
                     WHERE d.org_id = a.org_id AND d.lead_id = a.lead_id))      AS saiu,
  (SELECT count(*) FROM e_depois d WHERE d.org_id = g.org_id
     AND d.lead_id NOT IN (SELECT lead_id FROM e_fix)
     AND NOT EXISTS (SELECT 1 FROM e_antes a
                     WHERE a.org_id = d.org_id AND a.lead_id = d.lead_id))      AS entrou
FROM e_orgs g;

DO $ensaio$
DECLARE
  v_orgs_chip        int;
  v_cands_chip       int;
  v_orgs_chip_sujas  text;
  v_grants           text;
BEGIN
  -- Controle positivo do eixo do chip: a prova de "idêntico" só vale alguma
  -- coisa se houver candidato para ser diferente. Suíte sem sujeito é verde
  -- por ausência.
  SELECT count(*), coalesce(sum(antes), 0) INTO v_orgs_chip, v_cands_chip
  FROM e_diff WHERE cm_total = 0 AND antes > 0;

  IF v_orgs_chip = 0 OR v_cands_chip = 0 THEN
    RAISE EXCEPTION 'ENSAIO 1693 / CONTROLE VAZIO: nenhuma organizacao so-chip tem candidato hoje; a prova de inercia seria vacua';
  END IF;

  -- O eixo do chip: conjunto idêntico, não contagem parecida.
  SELECT string_agg(org_name || ' (saiu=' || saiu || ', entrou=' || entrou || ')', '; ')
    INTO v_orgs_chip_sujas
  FROM e_diff WHERE cm_total = 0 AND (saiu > 0 OR entrou > 0);

  IF v_orgs_chip_sujas IS NOT NULL THEN
    RAISE EXCEPTION 'ENSAIO 1693 / REGRESSAO NO EIXO DO CHIP: %', v_orgs_chip_sujas;
  END IF;

  -- A mudança só pode TIRAR candidato (quem respondeu). Nunca acrescentar.
  IF EXISTS (SELECT 1 FROM e_diff WHERE entrou > 0) THEN
    RAISE EXCEPTION 'ENSAIO 1693 / CANDIDATO NOVO: a guarda so pode remover quem respondeu, nunca incluir';
  END IF;

  -- Grants: CREATE OR REPLACE preserva o ACL, mas isso é para ser PROVADO.
  SELECT string_agg(r || '=' || has_function_privilege(r, oid, 'EXECUTE')::text, ' ')
    INTO v_grants
  FROM (SELECT unnest(ARRAY['anon','authenticated','service_role']) AS r) rr,
       (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'find_leads_no_reply') pp;

  IF has_function_privilege('anon', (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='find_leads_no_reply'), 'EXECUTE')
     OR has_function_privilege('authenticated', (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='find_leads_no_reply'), 'EXECUTE')
     OR NOT has_function_privilege('service_role', (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='find_leads_no_reply'), 'EXECUTE')
  THEN
    RAISE EXCEPTION 'ENSAIO 1693 / GRANT ERRADO: %', v_grants;
  END IF;
END
$ensaio$;

-- ─── Relatório ──────────────────────────────────────────────────────────────
SELECT jsonb_pretty(jsonb_build_object(
  'corte',                     (SELECT cutoff::text FROM e_param),
  'orgs_avaliadas',            (SELECT count(*) FROM e_orgs),
  'orgs_so_chip',              (SELECT count(*) FROM e_orgs WHERE cm_total = 0),
  'orgs_com_canal_oficial',    (SELECT count(*) FROM e_orgs WHERE cm_total > 0),
  'candidatos_antes',          (SELECT coalesce(sum(antes), 0)  FROM e_diff),
  'candidatos_depois',         (SELECT coalesce(sum(depois), 0) FROM e_diff),
  'eixo_chip', jsonb_build_object(
     'orgs_com_candidato',     (SELECT count(*) FROM e_diff WHERE cm_total = 0 AND antes > 0),
     'candidatos_antes',       (SELECT coalesce(sum(antes), 0)  FROM e_diff WHERE cm_total = 0),
     'candidatos_depois',      (SELECT coalesce(sum(depois), 0) FROM e_diff WHERE cm_total = 0),
     'leads_que_sairam',       (SELECT coalesce(sum(saiu), 0)   FROM e_diff WHERE cm_total = 0),
     'leads_que_entraram',     (SELECT coalesce(sum(entrou), 0) FROM e_diff WHERE cm_total = 0)
  ),
  'eixo_canal_oficial', (SELECT coalesce(jsonb_agg(jsonb_build_object(
       'org', org_name, 'msgs_canal', cm_total,
       'antes', antes, 'depois', depois, 'saiu', saiu, 'entrou', entrou)), '[]'::jsonb)
     FROM e_diff WHERE cm_total > 0),
  'matriz_de_casos', (SELECT jsonb_agg(jsonb_build_object(
       'caso', a.tag, 'porque', a.porque,
       'candidato_antes', a.presente, 'candidato_depois', d.presente,
       'esperado_depois', a.esperado_depois) ORDER BY a.tag)
     FROM e_fix_antes a JOIN e_fix_depois d USING (tag)),
  'grants_find_leads_no_reply', (
     SELECT jsonb_object_agg(r, has_function_privilege(r, pp.oid, 'EXECUTE'))
     FROM (SELECT unnest(ARRAY['anon','authenticated','service_role']) AS r) rr,
          (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'find_leads_no_reply') pp)
)) AS relatorio_ensaio_1693;

ROLLBACK;
