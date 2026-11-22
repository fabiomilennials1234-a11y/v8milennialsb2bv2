-- supabase/tests/desfecho_pre_filtro_test.sql
--
-- get_funil_desfecho_por_mes com pré-filtro (20280123000100) == a CTE antiga
-- sem pré-filtro (oráculo literal), por persona. Inclui card com negócio
-- ABERTO em etapa won (desfecho do deal = open ⇒ fora) e card com deal_id para
-- negócio apagado em etapa won (cai no papel da etapa ⇒ dentro).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(5);

CREATE FUNCTION pg_temp.oraculo(p_pipeline_id uuid, p_org_id uuid, p_tz text DEFAULT 'America/Sao_Paulo')
RETURNS TABLE(stage_key text, outcome text, month_key text, cnt bigint, total numeric) LANGUAGE sql STABLE AS $f$
  WITH card AS (
    SELECT pe.stage_key AS etapa,
      CASE WHEN d.id IS NOT NULL THEN d.outcome ELSE ps.stage_role::text END AS desfecho,
      COALESCE(d.outcome_at, pe.stage_changed_at, pe.entered_at, pe.created_at) AS fechado_em,
      COALESCE(d.value, CASE jsonb_typeof(pe.metadata -> 'sale_value')
          WHEN 'number' THEN (pe.metadata ->> 'sale_value')::numeric
          WHEN 'string' THEN CASE WHEN (pe.metadata ->> 'sale_value') ~ '^[[:space:]]*[+]?([0-9]{1,30}([.][0-9]{0,30})?|[.][0-9]{1,30})[[:space:]]*$'
                                  THEN btrim(pe.metadata ->> 'sale_value')::numeric END END) AS valor
    FROM public.pipeline_entries pe
    JOIN public.leads l ON l.id = pe.lead_id
    LEFT JOIN public.deals d ON d.id = pe.deal_id AND d.organization_id = pe.organization_id AND d.deleted_at IS NULL
    LEFT JOIN public.pipeline_stages ps ON ps.pipeline_id = pe.pipeline_id AND ps.stage_key = pe.stage_key
    WHERE pe.pipeline_id = p_pipeline_id AND pe.organization_id = p_org_id AND pe.lead_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.pipelines p WHERE p.id = p_pipeline_id AND p.organization_id = p_org_id))
  SELECT c.etapa, c.desfecho, COALESCE(to_char(c.fechado_em AT TIME ZONE p_tz, 'YYYY-MM'), 'sem-data'), count(*)::bigint,
         sum(CASE WHEN c.valor >= 0 THEN c.valor END)
  FROM card c WHERE c.desfecho IN ('won', 'lost') GROUP BY 1, 2, 3;
$f$;
GRANT EXECUTE ON FUNCTION pg_temp.oraculo(uuid, uuid, text) TO authenticated;

-- Casos de borda plantados (desfeitos pelo ROLLBACK):
--  * card com negócio ABERTO numa etapa won;
--  * card com deal_id de negócio APAGADO numa etapa won.
SET LOCAL session_replication_role = replica;
-- Papéis de etapa won/lost (em prod estes funis só têm 'open'; o pré-filtro
-- precisa ser provado com os dois caminhos de desfecho vivos).
UPDATE public.pipeline_stages SET stage_role = 'won' WHERE pipeline_id = 'fef4335d-c4c8-44eb-bc05-ac0805ab05f1' AND stage_key = 'vendido';
UPDATE public.pipeline_stages SET stage_role = 'lost' WHERE pipeline_id = 'fef4335d-c4c8-44eb-bc05-ac0805ab05f1' AND stage_key = 'perda';
UPDATE public.pipeline_stages SET stage_role = 'won' WHERE pipeline_id = '8106f2dc-e13b-4aaa-8058-05034c1e239a' AND stage_key = 'vendido';
-- Negócios com desfecho: 1 em cada 3 vira won, 1 em cada 5 lost.
UPDATE public.deals d SET outcome = CASE WHEN abs(hashtext(d.id::text)) % 3 = 0 THEN 'won' ELSE 'lost' END, outcome_at = d.created_at + interval '9 days'
 WHERE abs(hashtext(d.id::text)) % 3 = 0 OR abs(hashtext(d.id::text)) % 5 = 0;
WITH alvo AS (
  SELECT pe.id, row_number() OVER (ORDER BY pe.id) rn FROM public.pipeline_entries pe
   WHERE pe.pipeline_id = 'fef4335d-c4c8-44eb-bc05-ac0805ab05f1' AND pe.deal_id IS NOT NULL ORDER BY pe.id LIMIT 2)
UPDATE public.pipeline_entries pe
   SET stage_key = (SELECT s.stage_key FROM public.pipeline_stages s WHERE s.pipeline_id = 'fef4335d-c4c8-44eb-bc05-ac0805ab05f1' AND s.stage_role::text = 'won' LIMIT 1)
  FROM alvo WHERE alvo.id = pe.id;
UPDATE public.deals d SET outcome = 'open', outcome_at = NULL
 WHERE d.id = (SELECT pe.deal_id FROM public.pipeline_entries pe WHERE pe.pipeline_id = 'fef4335d-c4c8-44eb-bc05-ac0805ab05f1' AND pe.deal_id IS NOT NULL ORDER BY pe.id LIMIT 1);
UPDATE public.deals d SET deleted_at = now()
 WHERE d.id = (SELECT pe.deal_id FROM public.pipeline_entries pe WHERE pe.pipeline_id = 'fef4335d-c4c8-44eb-bc05-ac0805ab05f1' AND pe.deal_id IS NOT NULL ORDER BY pe.id OFFSET 1 LIMIT 1);
SET LOCAL session_replication_role = origin;

CREATE TEMP TABLE _d(caso text, novo text, antigo text, n int) ON COMMIT DROP;
GRANT ALL ON _d TO authenticated;
CREATE FUNCTION pg_temp.medir(p_caso text, p_pipe uuid, p_org uuid) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO _d SELECT p_caso,
    (SELECT md5(string_agg(x::text, '|' ORDER BY x::text)) FROM public.get_funil_desfecho_por_mes(p_pipe, p_org) x),
    (SELECT md5(string_agg(x::text, '|' ORDER BY x::text)) FROM pg_temp.oraculo(p_pipe, p_org) x),
    (SELECT count(*) FROM public.get_funil_desfecho_por_mes(p_pipe, p_org));
$f$;
GRANT EXECUTE ON FUNCTION pg_temp.medir(text, uuid, uuid) TO authenticated;

SELECT set_config('request.jwt.claims', '{"sub":"46c1b874-7492-4378-b609-fbb309ba1e87","role":"authenticated"}', true); SET LOCAL ROLE authenticated;
SELECT pg_temp.medir('admin 38f3', 'fef4335d-c4c8-44eb-bc05-ac0805ab05f1', '38f3bea4-44c6-4732-bb20-065f547a7ed8'); RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"8af3d7f4-4d68-4390-a2ae-f19c4e0a0896","role":"authenticated"}', true); SET LOCAL ROLE authenticated;
SELECT pg_temp.medir('membro Café', '8106f2dc-e13b-4aaa-8058-05034c1e239a', '4922638c-4909-494e-ba10-12282ec0b161'); RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"5ea2cb7f-4aa9-4d19-b66f-75e1925fdbb8","role":"authenticated"}', true); SET LOCAL ROLE authenticated;
SELECT pg_temp.medir('membro 7560', '86f27cec-4b40-4a89-9708-3ffbcb57e158', '75600b30-3332-4f25-b227-696380f5da4b'); RESET ROLE;

SELECT is(novo, antigo, '(E) ' || caso || ': md5 novo == antigo (' || n || ' linhas)') FROM _d ORDER BY caso;
SELECT ok((SELECT n FROM _d WHERE caso = 'admin 38f3') > 0, '(E0) CONTROLE: há ganho/perda no funil do admin');
SELECT is((SELECT proacl::text FROM pg_proc WHERE oid = 'public.get_funil_desfecho_por_mes(uuid,uuid,text)'::regprocedure),
  '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', '(S1) ACL preservada');

SELECT * FROM finish();
ROLLBACK;
