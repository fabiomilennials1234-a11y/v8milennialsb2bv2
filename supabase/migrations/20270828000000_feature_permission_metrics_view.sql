-- 20270828000000_feature_permission_metrics_view.sql
--
-- SCRUM-430 — o Estúdio de Métricas ganha chave de permissão.
--
-- O BURACO QUE ISTO FECHA. A rota `/metricas` foi montada de propósito SEM
-- `PermissionProtectedRoute` (o comentário está em `src/App.tsx`), porque
-- `useFeaturePermission` é fail-closed (`features?.[key] === true`) e gatear
-- numa chave que `get-member-permissions` não semeia trancaria TODO membro
-- não-admin. A decisão foi certa; o TODO é que nunca foi feito. Resultado: numa
-- org com `metrics_studio_enabled = true`, todo membro ativo vê o Estúdio
-- inteiro, e não existe interruptor para o admin da org.
--
-- ORDEM OBRIGATÓRIA, E É O PONTO DELICADO. Esta migration vai para PROD **ANTES**
-- do gate entrar no front. Invertida, a tela tranca para todo membro entre o
-- deploy e o apply — e o front deploya sozinho no merge para `main`.
--
-- POR QUE `default_value = true`. Medido em prod 2026-08-24: as **15** chaves
-- `*.view` do catálogo são `true`, sem exceção — `leads.view`, `performance.view`,
-- `commissions.view`, todas. Duas razões para seguir a convenção:
--
--   1. Coerência de produto. `/dashboard` (Comando) mostra receita e não tem
--      gate nenhum; `/performance` mostra número por vendedor com `true`. Fazer
--      só o Estúdio nascer fechado seria uma regra que só vale numa tela.
--   2. Introduzir gate restritivo numa tela JÁ LIGADA muda o que o usuário vê
--      da noite para o dia, sem ninguém ter pedido. O valor desta chave é o
--      admin PODER restringir, não começar restrito.
--
-- Quem quiser fechar o Estúdio para membro faz isso na tela de permissões, por
-- membro, ou pela política da org (`organization_feature_defaults`).
--
-- ⚠️ ESTA CHAVE NÃO GOVERNA O CORTE POR PESSOA. Closer/SDR continuam atrás de
-- `performance.view` (`MetricsStudio.tsx`), que é a mesma trava do Ranking e já
-- governa exatamente esses números. Trocar isso é decisão de produto à parte.
--
-- `INSERT` em `feature_permissions` é CONFIGURAÇÃO DE PRODUTO, não dado de
-- cliente — mesma classificação que o crivo de segurança deu aos
-- `metric_catalog_*`. Guarda F4 respeitada: URL errada vira erro recuperável.
--
-- ROLLBACK pareado: rollback/20270828000000_feature_permission_metrics_view.sql

INSERT INTO public.feature_permissions
  (key, module, name, description, is_admin_only, default_value, sort_order)
SELECT
  'metrics.view',
  'Métricas',
  'Ver o Estúdio de Métricas',
  'Abre /metricas, monta o painel e lê as métricas da organização. O corte por '
  || 'vendedor (closer/SDR) depende separadamente de "Ver pódio".',
  false,
  true,
  10
WHERE NOT EXISTS (
  SELECT 1 FROM public.feature_permissions WHERE key = 'metrics.view'
);

-- Guarda que roda em TODO apply. Se a chave não estiver lá ao final, aborta —
-- um apply "verde" com a chave ausente é exatamente o cenário que tranca a tela
-- de todo membro assim que o front subir.
DO $$
DECLARE
  v_default boolean;
  v_admin_only boolean;
BEGIN
  SELECT default_value, is_admin_only
    INTO v_default, v_admin_only
    FROM public.feature_permissions
   WHERE key = 'metrics.view';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'metrics.view não foi semeada — NÃO faça o deploy do gate no front';
  END IF;

  -- `is_admin_only = true` faria `get-member-permissions` devolver false para
  -- todo não-admin (index.ts), que é o mesmo efeito de não ter a chave.
  IF v_admin_only THEN
    RAISE EXCEPTION 'metrics.view está is_admin_only — trancaria todo membro';
  END IF;

  IF NOT v_default THEN
    RAISE WARNING 'metrics.view nasceu com default_value = false: membro sem override PERDE a tela';
  END IF;
END $$;
