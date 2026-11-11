-- 20280111000500_mapa_uf_acesso_pela_regra_da_plataforma.sql
--
-- Mapa de clientes (aba Mapa do Comando + card "Mapa de clientes" do Estúdio).
--
-- ── O defeito ────────────────────────────────────────────────────────────
-- get_uf_heatmap e get_leads_by_uf resolviam a org por resolve_org_for_rpc,
-- que só aceita linha em team_members. Master (master_users) e gestor de
-- portfólio (gestor_organizations, ADR-0021) não têm essa linha: recebiam ZERO
-- linhas, em silêncio, e o mapa pintava o Brasil inteiro de cinza com
-- "0 leads mapeados". Medido em prod em 11/11 (Café Jurerê): a admin Carolini
-- recebe 26 UFs em 140 ms; o master, 0 linhas. E o membro DESATIVADO
-- continuava lendo — resolve_org_for_rpc não olha is_active.
--
-- ── A correção ───────────────────────────────────────────────────────────
-- A org pedida (sem ela, a 1ª de quem chama — como antes) passa por
-- assert_org_access, a regra da plataforma: membro ATIVO, gestor de portfólio
-- da org ou master. Qualquer outro recebe access_denied, e a tela mostra o
-- erro em vez de um mapa vazio.
--
-- ── Cirúrgica de propósito ───────────────────────────────────────────────
-- Os corpos de PROD não são os do repo: leem private.leads e
-- private.negocio_projetado e barram o escopo por funil da JRTex
-- (private.jrtex_pipeline_scoped), objetos que nenhuma migration do repo cria.
-- Recriar a função a partir do texto do repo apagaria isso em prod. Então esta
-- migration lê o corpo VIVO (pg_get_functiondef), troca SÓ as duas linhas de
-- resolução da org e reaplica: em prod preserva private.* e a trava JRTex; num
-- banco novo, preserva o corpo do repo. Assinatura, SECURITY DEFINER,
-- search_path e ACL ficam como estão (CREATE OR REPLACE mantém os GRANTs).
--
-- Falha fechada: corpo sem as linhas esperadas (alguém mudou a função) aborta.
-- Idempotente: corpo já migrado só avisa.
--
-- ROLLBACK: supabase/migrations/rollback/20280111000500_mapa_uf_acesso_pela_regra_da_plataforma.sql

DO $migra$
DECLARE
  v_sig regprocedure;
  v_def text;
  c_antigo constant text :=
    E'  v_org_id := resolve_org_for_rpc(p_org_id);\n'
    || '  IF v_org_id IS NULL THEN RETURN; END IF;';
  c_novo constant text :=
    E'  -- Org pela regra da plataforma (20280111000500): membro ATIVO, gestor de\n'
    || E'  -- portfólio ou master. Sem org explícita, a 1ª de quem chama, como antes.\n'
    || E'  v_org_id := COALESCE(p_org_id, resolve_org_for_rpc(NULL));\n'
    || E'  PERFORM public.assert_org_access(v_org_id);\n'
    || '  IF v_org_id IS NULL THEN RETURN; END IF;';
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.get_uf_heatmap(uuid)'::regprocedure,
    'public.get_leads_by_uf(character,integer,uuid)'::regprocedure
  ] LOOP
    v_def := pg_get_functiondef(v_sig);
    IF position('PERFORM public.assert_org_access(v_org_id);' IN v_def) > 0 THEN
      RAISE NOTICE '% já usa assert_org_access — nada a fazer', v_sig;
      CONTINUE;
    END IF;
    IF position(c_antigo IN v_def) = 0 THEN
      RAISE EXCEPTION '% não tem as linhas esperadas de resolve_org_for_rpc — o corpo mudou; revise antes de aplicar', v_sig;
    END IF;
    EXECUTE replace(v_def, c_antigo, c_novo);
  END LOOP;
END
$migra$;

-- Prova: as duas usam a regra nova e continuam SECURITY DEFINER.
DO $verify$
DECLARE
  v_sig regprocedure;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.get_uf_heatmap(uuid)'::regprocedure,
    'public.get_leads_by_uf(character,integer,uuid)'::regprocedure
  ] LOOP
    IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_sig) THEN
      RAISE EXCEPTION '% deixou de ser SECURITY DEFINER', v_sig;
    END IF;
    IF position('PERFORM public.assert_org_access(v_org_id);' IN pg_get_functiondef(v_sig)) = 0
       OR position('resolve_org_for_rpc(p_org_id)' IN pg_get_functiondef(v_sig)) > 0 THEN
      RAISE EXCEPTION '% não ficou com a regra nova', v_sig;
    END IF;
  END LOOP;
END
$verify$;

NOTIFY pgrst, 'reload schema';
