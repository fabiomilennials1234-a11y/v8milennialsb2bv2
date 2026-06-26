-- 20270101000400_org_unit_economics_custo_produto_mc.sql
--
-- Estende a ferramenta master de unit economics (org_unit_economics_inputs) com:
--   - custo_por_produto        — custo do produto por UNIDADE (R$). Total = × nº vendas.
--   - despesas_mode            — 'detalhado' (itens) | 'mc' (margem de contribuição %).
--   - margem_contribuicao_pct  — MC (% do ticket) = o que SOBRA após todos os custos
--                                não-aquisição. Só usado no modo 'mc'.
--
-- Modelo (confirmado pelo CTO):
--   modo 'detalhado': custo não-aquisição = custo_por_produto×vendas + embalagem + frete
--                     + (imposto+admin+comissao)% × faturamento
--   modo 'mc':        custo não-aquisição = faturamento × (1 − margem_contribuicao_pct/100)
--   cacMaximo = custo não-aquisição / nº vendas (em ambos os modos)
--
-- BACKWARD-COMPAT: defaults preservam o comportamento atual de toda org existente
--   (custo_por_produto 0, modo 'detalhado', MC 0 → cálculo idêntico ao de hoje).
--
-- Idempotente (ADD COLUMN IF NOT EXISTS + CHECK via pg_constraint guard) — seguro
-- reaplicar. RLS herdada da tabela (master-only, já em vigor).

ALTER TABLE public.org_unit_economics_inputs
  ADD COLUMN IF NOT EXISTS custo_por_produto       numeric(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS despesas_mode           text           NOT NULL DEFAULT 'detalhado',
  ADD COLUMN IF NOT EXISTS margem_contribuicao_pct numeric(6, 3)  NOT NULL DEFAULT 0;

-- CHECK do modo (idempotente — só adiciona se ainda não existir).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'org_unit_economics_inputs_despesas_mode_check'
      AND conrelid = 'public.org_unit_economics_inputs'::regclass
  ) THEN
    ALTER TABLE public.org_unit_economics_inputs
      ADD CONSTRAINT org_unit_economics_inputs_despesas_mode_check
      CHECK (despesas_mode IN ('detalhado', 'mc'));
  END IF;
END $$;

COMMENT ON COLUMN public.org_unit_economics_inputs.custo_por_produto IS
  'Custo do produto por unidade (R$). Total no cálculo = custo_por_produto × nº vendas (modo detalhado).';
COMMENT ON COLUMN public.org_unit_economics_inputs.despesas_mode IS
  'Modo do custo não-aquisição: detalhado (itens) ou mc (margem de contribuição %).';
COMMENT ON COLUMN public.org_unit_economics_inputs.margem_contribuicao_pct IS
  'Margem de contribuição (% do ticket) = o que sobra após todos os custos não-aquisição. Só no modo mc.';
