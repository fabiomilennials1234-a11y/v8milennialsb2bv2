-- ROLLBACK de 20270828000000_feature_permission_metrics_view.sql
--
-- ⚠️ NÃO RODE ISTO ENQUANTO O GATE ESTIVER NO FRONT.
--
-- `useFeaturePermission` é fail-closed. Remover a chave com
-- `NAV_VIEW_PERMISSIONS["/metricas"]` e o `PermissionProtectedRoute` ainda no
-- código tranca `/metricas` para TODO membro não-admin, em TODA org — que é
-- exatamente o bug vivo de `checklists.view` (SCRUM-431).
--
-- Ordem correta para desfazer: reverter o front PRIMEIRO, esperar o deploy,
-- e só então rodar isto.
--
-- Os overrides por membro saem junto: `member_feature_permissions` guarda
-- `feature_key` como texto, sem FK, então a linha órfã sobreviveria e voltaria
-- a valer se alguém resemeasse a chave depois.

DELETE FROM public.member_feature_permissions WHERE feature_key = 'metrics.view';
DELETE FROM public.organization_feature_defaults WHERE feature_key = 'metrics.view';
DELETE FROM public.feature_permissions WHERE key = 'metrics.view';
