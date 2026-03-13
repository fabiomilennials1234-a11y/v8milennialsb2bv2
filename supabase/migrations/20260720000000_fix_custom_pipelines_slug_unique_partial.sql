-- =================================================================
-- FIX: Unicidade de slug em custom_pipelines compatível com soft delete
--
-- Problema:
--   UNIQUE(organization_id, slug) incondicional impede recriar um funil
--   com o mesmo nome após exclusão lógica (is_active = false), pois a
--   linha excluída permanece na tabela ocupando o par (org_id, slug).
--
-- Solução:
--   Substituir a constraint por um índice único PARCIAL que só envolve
--   funis ativos (is_active = true).
--   Resultado:
--     - Dois funis ativos da mesma org NÃO podem ter o mesmo slug.  ✓
--     - Um funil ativo e um inativo da mesma org PODEM ter o mesmo slug. ✓
--     - Organizações diferentes PODEM ter o mesmo slug. ✓
--     - Soft delete não bloqueia recriação do nome. ✓
--
-- Estratégia: soft delete mantida. Sem alteração de dados existentes.
-- =================================================================

-- 1. Remover a constraint incondicional antiga
ALTER TABLE public.custom_pipelines
  DROP CONSTRAINT IF EXISTS custom_pipelines_organization_id_slug_key;

-- 2. Criar índice único parcial — unicidade apenas entre funis ativos
CREATE UNIQUE INDEX IF NOT EXISTS custom_pipelines_org_slug_active_idx
  ON public.custom_pipelines(organization_id, slug)
  WHERE is_active = true;
