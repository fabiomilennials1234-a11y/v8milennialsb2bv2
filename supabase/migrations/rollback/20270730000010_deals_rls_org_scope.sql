-- ROLLBACK de 20270730000010_deals_rls_org_scope.sql
--
-- SCRUM-248. A migration reescreve as 4 policies de `deals` para escopo
-- multi-org (`get_my_organization_ids()` + ramo de master), acrescenta guarda de
-- soft-delete no USING de SELECT/UPDATE/DELETE e no WITH CHECK do UPDATE, e tira
-- o grant de `anon`.
--
-- ── ESTE ARQUIVO É TRANSCRIÇÃO, NÃO INVENÇÃO ──────────────────────────────
-- O SQL abaixo estava escrito, completo e literal, no bloco comentado das linhas
-- 412-444 da própria migration. O que ele não era é EXECUTÁVEL: para reverter,
-- alguém teria de abrir um arquivo de 444 linhas, achar o bloco, tirar o `-- ` de
-- 20 linhas sem errar nenhuma, e rodar — no meio de um incidente. O dia de rodar
-- não é o dia de transcrever (a frase é do próprio repo,
-- `rollback/20270730000050_deal_por_lead_destrava.sql:5-6`).
--
-- Nada foi alterado na tradução, incluindo o `MAINTAIN` do GRANT — ver seção 3.
--
-- ── O QUE VOLTAR AQUI RE-INTRODUZ, NOMEADAMENTE ───────────────────────────
-- 🟠 Os três defeitos que a migration veio consertar. Não é regressão acidental,
-- é o preço declarado:
--
--   1. **primeira-org**: `get_user_organization_id()` devolve UMA organização —
--      a primeira. Admin que pertence a duas passa a enxergar `deals` só da
--      primeira, sem erro e sem aviso;
--   2. **master read-only**: o master volta a ler tudo por
--      `master_select_all_deals` e a NÃO poder escrever em org que não é a dele;
--   3. **anon com grant**: `GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN … TO anon`
--      volta. A RLS continua barrando as linhas, então não é vazamento por si —
--      é superfície que a migration fechou e que este arquivo reabre.
--
-- ── QUANDO PRECISA, E QUANDO NÃO ──────────────────────────────────────────
-- O cabeçalho da migration mede o custo: "grátis enquanto `deals` tiver 0
-- linhas" — nenhuma linha muda de visibilidade, só o catálogo. Isso vale HOJE.
-- Depois do backfill M4 e do da Carteira, `deals` tem dezenas de milhares de
-- linhas e voltar ao predicado de primeira-org ESCONDE dado de admin multi-org.
-- A seção 0 conta as linhas e avisa.
--
-- E o aviso que a própria migration dá: se o predicado novo quebrar algum
-- caminho, a correção certa é ajustar o predicado, não voltar para
-- `get_user_organization_id()`. Este arquivo é para o caso em que ajustar leva
-- tempo demais e a tela está quebrada agora.

BEGIN;

-- ── 0. Quanto custa reverter, medido no momento ────────────────────────────
DO $$
DECLARE v_deals bigint; v_multi bigint;
BEGIN
  SELECT count(*) INTO v_deals FROM public.deals;

  -- Usuários que pertencem a mais de uma org: exatamente quem perde visão ao
  -- voltar para o predicado de primeira-org.
  SELECT count(*) INTO v_multi FROM (
    SELECT user_id FROM public.team_members
     WHERE user_id IS NOT NULL AND COALESCE(is_active, true)
     GROUP BY user_id HAVING count(DISTINCT organization_id) > 1
  ) x;

  RAISE NOTICE 'ANTES DO ROLLBACK: % linha(s) em deals; % usuário(s) em mais de uma organização.', v_deals, v_multi;

  IF v_deals > 0 AND v_multi > 0 THEN
    RAISE WARNING
      'deals tem % linha(s) e há % usuário(s) multi-org. Voltar ao predicado de primeira-org vai ESCONDER negócios desses usuários — sem erro em tela. O cabeçalho da migration chamava o rollback de "grátis" quando deals tinha 0 linhas; não tem mais.',
      v_deals, v_multi;
  END IF;
END$$;

-- ── 1. As policies ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "deals_select" ON public.deals;
DROP POLICY IF EXISTS "deals_insert" ON public.deals;
DROP POLICY IF EXISTS "deals_update" ON public.deals;
DROP POLICY IF EXISTS "deals_delete" ON public.deals;
-- A de master pode ou não existir dependendo de por onde se está voltando; o
-- IF EXISTS cobre os dois casos e o CREATE abaixo a repõe no estado de 30/07.
DROP POLICY IF EXISTS "master_select_all_deals" ON public.deals;

CREATE POLICY "deals_select" ON public.deals FOR SELECT
  USING ((organization_id = (SELECT public.get_user_organization_id())) AND (deleted_at IS NULL));
CREATE POLICY "deals_insert" ON public.deals FOR INSERT
  WITH CHECK (organization_id = (SELECT public.get_user_organization_id()));
CREATE POLICY "deals_update" ON public.deals FOR UPDATE
  USING (organization_id = (SELECT public.get_user_organization_id()));
CREATE POLICY "deals_delete" ON public.deals FOR DELETE
  USING (organization_id = (SELECT public.get_user_organization_id()));
CREATE POLICY "master_select_all_deals" ON public.deals FOR SELECT TO authenticated
  USING ((SELECT public.is_master_user()));

COMMENT ON POLICY "master_select_all_deals" ON public.deals IS
  'Ghost master le esta tabela em qualquer org. Espelha master_select_all_leads. Escopo de org e feito pela query da app (.eq organization_id).';

-- ── 2. O ACL ────────────────────────────────────────────────────────────────
-- `MAINTAIN` (o `m` de `anon=rxtm/postgres`) faz parte do estado medido em prod
-- e está literal em `20260101000000_baseline_prod_schema.sql:44961`. Sem ele o
-- rollback deixaria um QUARTO estado — nem o anterior, nem o posterior — e um
-- `db diff` futuro acusaria drift de ACL sem causa aparente.
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON public.deals TO anon;

-- ── 3. Verificação ──────────────────────────────────────────────────────────
DO $$
DECLARE v_n int; v_master int; v_anon boolean;
BEGIN
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'deals'
     AND policyname IN ('deals_select','deals_insert','deals_update','deals_delete');
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'FAIL: esperava 4 policies de deals restauradas, achei %.', v_n;
  END IF;

  SELECT count(*) INTO v_master FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'deals' AND policyname = 'master_select_all_deals';
  IF v_master <> 1 THEN
    RAISE EXCEPTION 'FAIL: master_select_all_deals não foi restaurada.';
  END IF;

  SELECT has_table_privilege('anon', 'public.deals', 'SELECT') INTO v_anon;
  IF NOT v_anon THEN
    RAISE EXCEPTION 'FAIL: o GRANT de anon não foi reposto — o ACL ficaria diferente do estado de 2026-07-30 e apareceria como drift num db diff.';
  END IF;

  RAISE NOTICE
    'ROLLBACK OK: 4 policies de deals de volta ao predicado de primeira-org, master_select_all_deals reposta, anon com SELECT/REFERENCES/TRIGGER/MAINTAIN. Os três defeitos conhecidos (primeira-org, master read-only, grant de anon) estão de volta POR DESENHO.';
END$$;

COMMIT;
