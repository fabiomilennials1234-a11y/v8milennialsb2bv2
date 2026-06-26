-- 20270101000300_org_unit_economics_comissao.sql
--
-- Adiciona a comissão do vendedor aos pressupostos de unit economics.
--
-- A comissão é modelada como % do faturamento (igual a imposto_pct/admin_pct) e
-- entra na soma de despesasTotais do CAC:
--   despesasTotais = anuncios + embalagem + frete + impostoValor + adminValor + comissaoValor
--   comissaoValor  = (comissao_pct/100) * faturamento
--
-- NOT NULL DEFAULT 0 é seguro em tabela com dados: linhas existentes recebem 0
-- (comissão neutra, CAC inalterado). Segurança/RLS da tabela inalterada — só ADD COLUMN.

ALTER TABLE public.org_unit_economics_inputs
  ADD COLUMN IF NOT EXISTS comissao_pct numeric(6, 3) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.org_unit_economics_inputs.comissao_pct IS
  'Comissão do vendedor como % do faturamento (ex.: 5 = 5%). Entra na soma do CAC (comissaoValor = comissao_pct/100 * faturamento).';
