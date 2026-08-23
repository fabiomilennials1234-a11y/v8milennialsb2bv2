-- ===========================================================================
-- ROLLBACK — 20270821180000_seed_feature_catalog.sql (SCRUM-362)
-- ===========================================================================
-- ⚠ NÃO existe rollback seguro por apagar linhas.
--
-- `organization_features.feature_key` referencia `feature_catalog.key`. Apagar
-- as 35 linhas semeadas derrubaria a configuração de feature de TODA
-- organização que aponte para elas — e em produção elas já existiam antes desta
-- migration, que só as insere com `ON CONFLICT DO NOTHING`.
--
-- Ou seja: em produção esta migration é NO-OP, e reverter um no-op apagando
-- dado real seria trocar um não-efeito por perda.
--
-- Num banco construído do repositório (CI, branch efêmera), reverter é
-- recriar o banco — mais barato e sem ambiguidade.
-- ===========================================================================

DO $$
BEGIN
  RAISE EXCEPTION
    'Sem rollback: apagar feature_catalog quebraria organization_features. Em prod esta migration é no-op; num banco do repo, recrie o banco.';
END
$$;
