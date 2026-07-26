-- 20260724100100_seed_default_dashboard.sql
--
-- ISSUE #1207 (épico #1194 · ADR-0023) — casca da TV, fatia DB 2/2.
-- Painel padrão SEMEADO da derivação — ninguém acorda com tela vazia.
--
-- ⚠ ACHADO QUE MUDA A DECISÃO 2 DO ARQUITETO — a derivação do quiz está MORTA
-- ---------------------------------------------------------------------------
-- A decisão (A) do arquiteto (.specs/project/decisao-1207-celula-legada-e-semeadura.md)
-- pressupunha que `org_onboarding.answers` existisse e fosse legível em SQL.
-- NÃO EXISTE. Verificado por TRÊS fontes independentes:
--   1. baseline de prod (provado 1:1 com prod): não há tabela `org_onboarding`;
--      só `org_onboarding_progress` (checklist de passos — sem coluna `answers`)
--      e `onboarding_{automation,pipeline}_templates`.
--   2. `src/integrations/supabase/types.ts`, AUTO-GERADO DE PROD: idem.
--   3. nenhuma tabela do schema tem coluna `answers`.
--
-- Consequência: `useOnboarding()` consulta uma tabela inexistente e faz `throw`
-- no erro → `onboarding` fica undefined → `generateTVConfig(undefined)` devolve
-- `DEFAULT_CONFIG`. Ou seja, EM PRODUÇÃO A DERIVAÇÃO DO QUIZ NUNCA RODOU: toda
-- org recebe hoje, na prática, exatamente a configuração padrão.
--
-- Portanto "semear da derivação atual" = semear a COMPOSIÇÃO PADRÃO, porque é o
-- que a derivação atual produz para todas as orgs. Ler os 4 sinais seria
-- implementar um comportamento que a TV de hoje NÃO tem — isso não seria migrar
-- a derivação, seria inventar uma nova, e sem fonte de dado para alimentá-la.
--
-- A opção (B) do arquiteto (painel estático) é a correta — não por preferência,
-- mas porque o insumo de (A) não existe. A variação por quiz volta como fatia
-- própria SE e QUANDO houver uma fonte de respostas: a função abaixo já é o
-- ponto único onde ela entraria.
--
-- GATILHO (a AC "ninguém acorda com tela vazia"): semear NÃO pode ser lazy-on-read
-- — escrita disparada por leitura da TV é o vício da opção (C), que fere o
-- mandamento de segurança. São dois pontos, ambos aqui:
--   1. quando a flag de rollout LIGA para a org (é o instante em que a TV
--      montável passa a existir para ela — gatilho melhor que a conclusão do
--      onboarding, que sequer tem tabela);
--   2. backfill por migration para as orgs que já estão com a flag ON.
--
-- "SEMEADO DA DERIVAÇÃO" = mesma DECISÃO DE COMPOSIÇÃO, não os mesmos 6 KPIs
-- legados (decisão 3 do arquiteto). Mapeia fielmente o que mapeia e DESCARTA o que
-- não mapeia, em vez de mis-mapear:
--   ✅ conversão → razão num_vendas/leads_criados · reuniões → marcadas/realizadas
--      leads novos → leads_criados · leads p/ trabalhar → leads_na_etapa
--   ❌ no-show (exige (a−b)/a; a razão do catálogo é prof-1 com 2 filhos)
--   ❌ propostas enviadas (é FLUXO de entrada em etapa; o catálogo só tem ESTADO)
--   ❌ ticket MRR vs Projeto (o corte recorrência/projeto não existe; stream é
--      novo_negocio/carteira)
-- Conflar estado com fluxo é o defeito que a própria spec aponta como "leitura
-- errada acontecendo em produção agora" (§4.2). Não inventar medida.
--
-- ORÇAMENTO DE LAYOUT (§8.4.6): grid 12×6 = 72 células/página. Os 2 `pinned`
-- legados custam 20 células em TODA página (28% permanente). As duas páginas
-- semeadas ficam bem abaixo do teto de 12 widgets e nenhuma usa --tv-hero,
-- então o teto de 8 não dispara.
--
-- ROLLBACK pareado: rollback/20260724100100_seed_default_dashboard.sql

-- ===========================================================================
-- 1. _fn_seed_default_dashboard_unchecked — o CORPO, sem gate de usuário
-- ===========================================================================
-- SEPARAÇÃO DE AUTORIZAÇÃO E EXECUÇÃO (achados 4a e 4b do revisor).
--
-- Esta função NÃO autoriza — ela executa. É chamada por dois caminhos de
-- SISTEMA, ambos sem usuário no contexto:
--   · o trigger do flip da flag (o próprio flip é o evento de autorização);
--   · o backfill da migration (roda como postgres, SEM JWT).
--
-- Por que o gate de usuário NÃO pode viver aqui (achado 4b): em contexto de
-- migration não há JWT, então auth.role() é NULL — diferente de 'service_role' —
-- e auth.uid() é NULL. `assert_org_access` levantaria access_denied em TODA
-- iteração do backfill, o erro seria engolido pelo EXCEPTION do laço, e a
-- migration reportaria sucesso tendo semeado ZERO. Era exatamente o estado
-- anterior desta fatia, e ele falharia justo na única org com a flag ON.
--
-- REVOKE de authenticated/anon: nenhum usuário chama esta diretamente. Quem
-- autoriza é o wrapper público logo abaixo.
CREATE OR REPLACE FUNCTION public._fn_seed_default_dashboard_unchecked(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_page1 uuid;
  v_page2 uuid;
  v_created int := 0;
BEGIN
  -- Gate de rollout: sem a flag, não existe painel montável para semear.
  IF NOT public.fn_composable_metrics_enabled(p_org_id) THEN
    RETURN jsonb_build_object('seeded', false, 'reason', 'flag_off');
  END IF;

  -- IDEMPOTENTE: org que já tem painel não é tocada. Semear duas vezes
  -- duplicaria a parede, e esta função é chamada por trigger e por backfill.
  IF EXISTS (SELECT 1 FROM public.dashboard_pages WHERE organization_id = p_org_id AND surface = 'tv') THEN
    RETURN jsonb_build_object('seeded', false, 'reason', 'already_exists');
  END IF;

  -- ── A composição PADRÃO ──────────────────────────────────────────────────
  -- Sem leitura de quiz: a fonte de respostas não existe (ver cabeçalho), e a
  -- derivação atual devolve DEFAULT_CONFIG para toda org. Reproduz-se aqui a
  -- MESMA decisão de composição do DEFAULT_CONFIG legado, com o que o catálogo
  -- de 7 medidas expressa:
  --   reuniões → reunioes_marcadas/realizadas · conversão → razão vendas/leads
  --   ticket   → razão receita/vendas         · leads p/ trabalhar → leads_na_etapa
  --   funil    → leads_na_etapa por etapa     · ranking → receita por closer
  -- DESCARTADOS por não existirem no catálogo (decisão 3 do arquiteto — não
  -- mis-mapear): no-show (exige (a−b)/a), propostas enviadas (é fluxo, não
  -- estado), e o corte MRR-vs-Projeto do ticket (stream é novo_negocio/carteira).

  -- ── Página 1 — Fechamento ────────────────────────────────────────────────
  INSERT INTO public.dashboard_pages (organization_id, surface, title, position, rotation_seconds)
  VALUES (p_org_id, 'tv', 'Fechamento', 0, 20)
  RETURNING id INTO v_page1;

  -- Os 2 congelados: célula RESERVADA, pinned, mesma posição em toda página.
  INSERT INTO public.dashboard_widgets
    (organization_id, page_id, measure_kind, renderer_id, weight, pinned, grid_col, grid_row, grid_w, grid_h, position)
  VALUES
    (p_org_id, v_page1, 'legacy', 'legacy:thermometer',        'primary', true, 0, 0, 3, 4, 0),
    (p_org_id, v_page1, 'legacy', 'legacy:closer-performance', 'primary', true, 3, 0, 4, 2, 1);
  v_created := v_created + 2;

  -- Números de fechamento.
  INSERT INTO public.dashboard_widgets
    (organization_id, page_id, measure_kind, measure_id, recorte_id, format_id, weight, grid_col, grid_row, grid_w, grid_h, position)
  VALUES
    (p_org_id, v_page1, 'leaf', 'receita',    'total', 'currency_brl', 'primary', 7, 0, 2, 1, 2),
    (p_org_id, v_page1, 'leaf', 'num_vendas', 'total', 'integer',      'primary', 9, 0, 2, 1, 3);
  v_created := v_created + 2;

  -- Razões: conversão e ticket médio (presets do catálogo).
  INSERT INTO public.dashboard_widgets
    (organization_id, page_id, measure_kind, num_measure_id, den_measure_id, recorte_id, format_id, weight, grid_col, grid_row, grid_w, grid_h, position)
  VALUES
    (p_org_id, v_page1, 'ratio', 'num_vendas', 'leads_criados', 'total', 'percent_1',    'primary', 7, 1, 2, 1, 4),
    (p_org_id, v_page1, 'ratio', 'receita',    'num_vendas',    'total', 'currency_brl', 'primary', 9, 1, 2, 1, 5);
  v_created := v_created + 2;

  -- Receita por closer (ranking) e leads por etapa (funil).
  INSERT INTO public.dashboard_widgets
    (organization_id, page_id, measure_kind, measure_id, recorte_id, format_id, weight, grid_col, grid_row, grid_w, grid_h, position)
  VALUES
    (p_org_id, v_page1, 'leaf', 'receita',        'closer', 'currency_brl', 'secondary', 3, 2, 3, 2, 6),
    (p_org_id, v_page1, 'leaf', 'leads_na_etapa', 'etapa',  'integer',      'secondary', 7, 2, 5, 3, 7);
  v_created := v_created + 2;

  -- Carteira NÃO entra por padrão: o DEFAULT_CONFIG legado tem showCarteira=false,
  -- e não há fonte para saber quem quer. Quando entrar, é com recorte por `stream`
  -- — receita de recompra explícita, nunca somada em silêncio (ADR §Riscos).

  -- ── Página 2 — Time e topo de funil ──────────────────────────────────────
  INSERT INTO public.dashboard_pages (organization_id, surface, title, position, rotation_seconds)
  VALUES (p_org_id, 'tv', 'Time e topo de funil', 1, 20)
  RETURNING id INTO v_page2;

  -- Os pinned custam de novo: uma vez POR PÁGINA (§6.4), não uma vez no painel.
  INSERT INTO public.dashboard_widgets
    (organization_id, page_id, measure_kind, renderer_id, weight, pinned, grid_col, grid_row, grid_w, grid_h, position)
  VALUES
    (p_org_id, v_page2, 'legacy', 'legacy:thermometer',        'primary', true, 0, 0, 3, 4, 0),
    (p_org_id, v_page2, 'legacy', 'legacy:closer-performance', 'primary', true, 3, 0, 4, 2, 1);
  v_created := v_created + 2;

  -- Topo de funil — sempre.
  INSERT INTO public.dashboard_widgets
    (organization_id, page_id, measure_kind, measure_id, recorte_id, format_id, weight, grid_col, grid_row, grid_w, grid_h, position)
  VALUES
    (p_org_id, v_page2, 'leaf', 'leads_criados', 'total',  'integer', 'primary',   7, 0, 2, 1, 2),
    (p_org_id, v_page2, 'leaf', 'leads_criados', 'origem', 'integer', 'secondary', 7, 2, 3, 2, 3);
  v_created := v_created + 2;

  -- Reuniões e comparecimento — o DEFAULT_CONFIG legado inclui Reuniões.
  INSERT INTO public.dashboard_widgets
    (organization_id, page_id, measure_kind, measure_id, recorte_id, format_id, weight, grid_col, grid_row, grid_w, grid_h, position)
  VALUES
    (p_org_id, v_page2, 'leaf', 'reunioes_marcadas',   'total', 'integer', 'primary',   9, 0, 2, 1, 4),
    (p_org_id, v_page2, 'leaf', 'reunioes_realizadas', 'total', 'integer', 'primary',   9, 1, 2, 1, 5),
    (p_org_id, v_page2, 'leaf', 'reunioes_marcadas',   'sdr',   'integer', 'secondary', 3, 2, 3, 2, 6);
  v_created := v_created + 3;

  -- Comparecimento (preset de razão do catálogo). No-show NÃO é expressível:
  -- exige (marcadas − realizadas)/marcadas, e a razão é prof-1 com 2 filhos.
  INSERT INTO public.dashboard_widgets
    (organization_id, page_id, measure_kind, num_measure_id, den_measure_id, recorte_id, format_id, weight, grid_col, grid_row, grid_w, grid_h, position)
  VALUES
    (p_org_id, v_page2, 'ratio', 'reunioes_realizadas', 'reunioes_marcadas', 'total', 'percent_1', 'primary', 7, 1, 2, 1, 7);
  v_created := v_created + 1;

  -- Leads p/ trabalhar (KPI_LEADS do default) — estado atual.
  INSERT INTO public.dashboard_widgets
    (organization_id, page_id, measure_kind, measure_id, recorte_id, format_id, weight, grid_col, grid_row, grid_w, grid_h, position)
  VALUES
    (p_org_id, v_page2, 'leaf', 'leads_na_etapa', 'total', 'integer', 'primary', 11, 0, 1, 1, 8);
  v_created := v_created + 1;

  RETURN jsonb_build_object('seeded', true, 'pages', 2, 'widgets', v_created);
END;
$$;

COMMENT ON FUNCTION public._fn_seed_default_dashboard_unchecked(uuid) IS
  'CORPO da semeadura do painel padrão da TV montável (#1207). NÃO autoriza — '
  'executa. Chamada só por caminhos de sistema (trigger do flip da flag e '
  'backfill de migration), onde não há usuário no contexto. Idempotente '
  '(criar-se-ausente, nunca reseta) + gate de flag. Autorização é do wrapper '
  'público fn_seed_default_dashboard.';

REVOKE EXECUTE ON FUNCTION public._fn_seed_default_dashboard_unchecked(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public._fn_seed_default_dashboard_unchecked(uuid) TO service_role;

-- ===========================================================================
-- 1b. fn_seed_default_dashboard — wrapper PÚBLICO que autoriza
-- ===========================================================================
-- Achado 4a do revisor: a versão anterior era SECURITY DEFINER, concedida a
-- `authenticated`, e o único gate era assert_org_access — que passa para
-- QUALQUER MEMBRO ATIVO. Como DEFINER com owner postgres, os INSERT
-- BYPASSAVAM a RLS admin-only que o #1194 estabeleceu: membro comum escrevia
-- em dashboard_pages/dashboard_widgets. Além do land-grab (membro semeia
-- primeiro, admin toma 'already_exists').
--
-- Agora o gate é o MESMO de fn_publish_dashboard_page (#1194): admin/owner da
-- org OU master. Montar e semear são a mesma classe de escrita — têm que exigir
-- a mesma permissão.
CREATE OR REPLACE FUNCTION public.fn_seed_default_dashboard(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- 1ª instrução: tenancy.
  PERFORM public.assert_org_access(p_org_id);

  -- Só admin/owner da org ou master semeiam (membro comum não escreve painel).
  IF NOT (p_org_id IN (SELECT public.get_my_admin_organization_ids()) OR public.is_master_user()) THEN
    RAISE EXCEPTION 'only org admins may seed dashboards' USING ERRCODE = '42501';
  END IF;

  RETURN public._fn_seed_default_dashboard_unchecked(p_org_id);
END;
$$;

COMMENT ON FUNCTION public.fn_seed_default_dashboard(uuid) IS
  'Semeia o painel padrão da TV montável (#1207). Wrapper de AUTORIZAÇÃO: '
  'assert_org_access 1º + gate admin/master (mesmo de fn_publish_dashboard_page). '
  'A execução é do _fn_seed_default_dashboard_unchecked. Idempotente.';

REVOKE EXECUTE ON FUNCTION public.fn_seed_default_dashboard(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_seed_default_dashboard(uuid) TO authenticated, service_role;

-- ===========================================================================
-- 2. Gatilho 1 — a flag de rollout LIGA para a org
-- ===========================================================================
-- O gatilho da decisão do arquiteto era "conclusão do onboarding". Não existe
-- tabela para pendurá-lo (ver cabeçalho). O instante certo é melhor de qualquer
-- forma: é quando a TV montável passa a EXISTIR para a org. Ligar a flag e achar
-- a parede vazia é exatamente o que a AC proíbe.
CREATE OR REPLACE FUNCTION public.fn_seed_dashboard_on_flag_enabled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- Só na transição false → true. Não a cada UPDATE em organizations.
  IF NEW.composable_metrics_enabled = true
     AND COALESCE(OLD.composable_metrics_enabled, false) = false THEN
    -- A semeadura não pode derrubar o UPDATE que ligou a flag: se falhar
    -- (painel já existente, org sem acesso), registra e segue.
    -- Chama o CORPO, não o wrapper: quem liga a flag pode não ser admin da org
    -- (master, service_role, painel interno), e o próprio flip é o evento de
    -- autorização. Passar pelo gate de usuário aqui reintroduziria o no-op
    -- silencioso do achado 4b.
    BEGIN
      PERFORM public._fn_seed_default_dashboard_unchecked(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'semeadura do painel falhou para org %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_dashboard_on_flag_enabled ON public.organizations;
CREATE TRIGGER trg_seed_dashboard_on_flag_enabled
  AFTER UPDATE OF composable_metrics_enabled ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.fn_seed_dashboard_on_flag_enabled();

-- ===========================================================================
-- 3. Gatilho 2 — backfill das orgs que já existem com a flag ON
-- ===========================================================================
-- Chama o CORPO (sem gate de usuário). A afirmação anterior — "roda como dono da
-- migration, então assert_org_access passa pelo ramo de backend" — era FALSA:
-- em migration não há JWT, logo auth.role() é NULL (≠ 'service_role') e
-- auth.uid() é NULL, e o gate levantava access_denied em toda iteração,
-- silenciado pelo EXCEPTION. O backfill semeava ZERO e reportava sucesso.
--
-- E agora ele CONTA: um zero silencioso deixa de ser possível, porque o total
-- vai para NOTICE no log da migration.
DO $backfill$
DECLARE
  r RECORD;
  v_seeded int := 0;
  v_failed int := 0;
  v_candidates int := 0;
BEGIN
  FOR r IN
    SELECT o.id FROM public.organizations o
    WHERE o.composable_metrics_enabled = true
      AND NOT EXISTS (
        SELECT 1 FROM public.dashboard_pages dp
        WHERE dp.organization_id = o.id AND dp.surface = 'tv')
  LOOP
    v_candidates := v_candidates + 1;
    BEGIN
      IF (public._fn_seed_default_dashboard_unchecked(r.id) ->> 'seeded')::boolean THEN
        v_seeded := v_seeded + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      RAISE WARNING 'backfill do painel falhou para org %: %', r.id, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'backfill do painel montável: % candidata(s), % semeada(s), % falha(s)',
    v_candidates, v_seeded, v_failed;

  -- Candidatas existiam mas nenhuma foi semeada = o modo de falha que esta
  -- fatia já teve uma vez. Não passa em silêncio.
  IF v_candidates > 0 AND v_seeded = 0 THEN
    RAISE WARNING 'backfill do painel montável NÃO semeou nenhuma das % org(s) candidata(s)', v_candidates;
  END IF;
END
$backfill$;
