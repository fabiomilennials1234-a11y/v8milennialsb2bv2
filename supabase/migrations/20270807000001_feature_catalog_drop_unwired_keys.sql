-- 20270805000001_feature_catalog_drop_unwired_keys.sql
--
-- Fatia 2 do PRD #1393 — remoção das chaves de catálogo que nenhum código consulta.
-- Resolve a Decisão 3 de #1386.
--
-- ATENÇÃO — esta migration APAGA CONFIGURAÇÃO DE CLIENTE.
--
-- `organization_features.feature_key` referencia `feature_catalog(key)` com ON DELETE
-- CASCADE. Apagar as quatro chaves abaixo remove junto 14 linhas de override em
-- organizações reais (medido em prod, 2026-08-03):
--
--   custom_reports        3 organizações com a feature concedida
--   gamification          3
--   multi_pipeline        4
--   whatsapp_integration  4
--
-- Por que apagar mesmo assim: nenhuma dessas chaves é consultada em lugar nenhum. Zero
-- ocorrências no frontend, zero nas edge functions. Elas não ligam nem desligam nada — as
-- capacidades reais por trás dos nomes ou vivem em outro módulo (gamificação está em
-- `engagement` e nunca passou por essa chave) ou não existem. `gamification` ainda tinha
-- `default_enabled = true`, o que fazia todas as 97 organizações "terem" a chave sem que
-- ela produzisse efeito algum.
--
-- O risco real não é técnico, é comercial: manter as chaves faz o montador do link de
-- pagamento oferecer features que não ligam nada.
--
-- REVERSÃO: reinserir as linhas em feature_catalog não restaura os overrides apagados.
-- Se precisar reverter, restaure organization_features do backup do mesmo instante.

-- ---------------------------------------------------------------------------
-- Guarda: falha se a contagem divergir do que foi medido
-- ---------------------------------------------------------------------------
-- Se o número de overrides afetados mudou desde a medição, alguém concedeu ou removeu
-- essas features no intervalo e a decisão precisa ser reavaliada antes de destruir dado.

DO $$
DECLARE
  v_overrides integer;
  v_keys integer;
BEGIN
  SELECT count(*) INTO v_overrides
    FROM public.organization_features
   WHERE feature_key IN ('custom_reports', 'gamification', 'multi_pipeline', 'whatsapp_integration');

  SELECT count(*) INTO v_keys
    FROM public.feature_catalog
   WHERE key IN ('custom_reports', 'gamification', 'multi_pipeline', 'whatsapp_integration');

  -- Banco novo (db reset local, CI, projeto recém-criado) não tem essas chaves: elas vêm
  -- de dado semeado em produção. Nada a remover é sucesso, não erro — uma guarda que
  -- aborta em banco limpo quebraria `supabase db reset` e o CI.
  IF v_keys = 0 THEN
    RAISE NOTICE 'feature_catalog: nenhuma das 4 chaves presente — nada a remover';
    RETURN;
  END IF;

  -- Se as chaves existem, o estado tem que ser exatamente o medido. Divergência significa
  -- que alguém concedeu ou removeu essas features no intervalo, e a decisão de apagar
  -- configuração de cliente precisa ser reavaliada antes de destruir dado.
  IF v_keys <> 4 THEN
    RAISE EXCEPTION
      'feature_catalog: esperava 4 chaves a remover ou nenhuma, encontrou %. Estado divergente do medido — abortando.', v_keys;
  END IF;

  IF v_overrides <> 14 THEN
    RAISE EXCEPTION
      'organization_features: esperava 14 overrides afetados, encontrou %. Alguém mexeu nessas features desde a medição de 2026-08-03 — reavalie antes de apagar.', v_overrides;
  END IF;

  RAISE NOTICE 'feature_catalog: removendo 4 chaves e % overrides de cliente por CASCADE', v_overrides;
END $$;

-- ---------------------------------------------------------------------------
-- Remoção explícita dos overrides, antes do CASCADE
-- ---------------------------------------------------------------------------
-- Deletar aqui em vez de deixar o CASCADE fazer em silêncio: a remoção de configuração de
-- cliente fica visível no diff e no log da migration, não escondida numa constraint.

DELETE FROM public.organization_features
 WHERE feature_key IN ('custom_reports', 'gamification', 'multi_pipeline', 'whatsapp_integration');

DELETE FROM public.feature_catalog
 WHERE key IN ('custom_reports', 'gamification', 'multi_pipeline', 'whatsapp_integration');
