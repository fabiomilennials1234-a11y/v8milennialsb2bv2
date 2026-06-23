-- 20261224000000_fix_leads_uf_trigger_search_path.sql
--
-- HOTFIX — master/admin "erro ao excluir lead" (na verdade: TODO mundo, todo path).
--
-- Sintoma: excluir lead falhava com toast genérico para master E admin, em
-- qualquer org. Não tinha nada a ver com permissão/master-ghost.
--
-- Causa-raiz: a migration 20261211100000_lead_uf_and_map criou o trigger
-- `leads_derive_uf_from_ddd()` SEM `SET search_path` e chamando `uf_from_ddd(...)`
-- UNqualified. Uma função PL/pgSQL sem search_path próprio HERDA o search_path do
-- caller em runtime. Os caminhos de delete (single/bulk/limpar-etapa/limpar-tudo)
-- passam todos por `bulk_delete_leads`, que é SECURITY DEFINER com
-- `SET search_path = ''`. Quando o `UPDATE public.leads SET deleted_at = now()`
-- dispara o trigger, o search_path está vazio → `uf_from_ddd` (em public) não
-- resolve → ERROR 42883 "function uf_from_ddd(text) does not exist" → o UPDATE
-- aborta → a RPC inteira lança → o frontend mostra o erro genérico.
--
-- Edição normal de lead (PostgREST) não quebra porque o search_path default
-- inclui `public`; só estoura sob callers hardened (search_path='') — daí o bug
-- ter aparecido só ao deletar, e em TODAS as orgs, depois que 20261211100000
-- entrou em prod.
--
-- Fix: tornar o trigger independente do caller — pinar `search_path = ''`
-- (padrão de hardening do repo) e qualificar `public.uf_from_ddd`. Corpo idêntico
-- ao vigente fora isso. Beneficia qualquer outra RPC search_path='' que toque
-- leads (ex.: restore_lead, bulk_delete_leads).
--
-- Verificado em prod (read-only, tx revertida): com este corpo,
-- bulk_delete_leads(ARRAY[lead]) retorna deleted=1 em vez de 42883.

CREATE OR REPLACE FUNCTION public.leads_derive_uf_from_ddd()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  derived char(2);
BEGIN
  IF (NEW.uf IS NULL OR NEW.uf_source = 'ddd') THEN
    derived := public.uf_from_ddd(COALESCE(NEW.phone_digits, NEW.phone));
    IF derived IS NOT NULL THEN
      NEW.uf := derived;
      NEW.uf_source := 'ddd';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
