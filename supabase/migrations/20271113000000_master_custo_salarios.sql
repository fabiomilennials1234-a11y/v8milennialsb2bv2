-- 20271113000000_master_custo_salarios.sql
--
-- Salários dos colaboradores entram no custo da operação (pedido do CTO,
-- 2026-10-08). Um campo só: o TOTAL mensal da folha. Salário por pessoa não
-- entra de propósito: todo master pleno lê esta configuração, e salário
-- individual não tem por que circular no painel.
--
-- Mesma regra da infra fixa: rateado igualmente entre as orgs em uso
-- (`lib/org-finance.ts`). Nasce zerado.
--
-- Compatibilidade de deploy: o front no ar chama `master_set_cost_settings`
-- com 5 argumentos. A versão de 5 continua existindo e delega para a de 6,
-- preservando a folha já gravada — assim apply e deploy não precisam ser
-- simultâneos. `master_get_cost_settings` ganha uma coluna; o front antigo
-- ignora o que não conhece.

ALTER TABLE public.master_cost_settings
  ADD COLUMN IF NOT EXISTS payroll_monthly_cents integer NOT NULL DEFAULT 0
  CHECK (payroll_monthly_cents >= 0);

COMMENT ON COLUMN public.master_cost_settings.payroll_monthly_cents IS
  'Folha de pagamento total por mês (centavos), com encargos. Rateada entre as orgs em uso.';

-- RETURNS TABLE muda: precisa DROP + CREATE.
DROP FUNCTION IF EXISTS public.master_get_cost_settings();

CREATE FUNCTION public.master_get_cost_settings()
RETURNS TABLE (
  chip_monthly_cents        integer,
  infra_fixed_monthly_cents integer,
  payroll_monthly_cents     integer,
  llm_input_usd_per_mtok    numeric,
  llm_output_usd_per_mtok   numeric,
  usd_brl                   numeric,
  updated_at                timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  PERFORM public.assert_master_full();
  RETURN QUERY
  SELECT s.chip_monthly_cents, s.infra_fixed_monthly_cents, s.payroll_monthly_cents,
         s.llm_input_usd_per_mtok, s.llm_output_usd_per_mtok, s.usd_brl, s.updated_at
    FROM public.master_cost_settings s
   WHERE s.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.master_get_cost_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.master_get_cost_settings() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.master_set_cost_settings(
  _chip_monthly_cents        integer,
  _infra_fixed_monthly_cents integer,
  _payroll_monthly_cents     integer,
  _llm_input_usd_per_mtok    numeric,
  _llm_output_usd_per_mtok   numeric,
  _usd_brl                   numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_master_id uuid := public.assert_master_full();
  v_before    jsonb;
BEGIN
  SELECT to_jsonb(s) - 'id' INTO v_before FROM public.master_cost_settings s WHERE s.id FOR UPDATE;

  -- Os CHECKs da tabela rejeitam negativo com 23514.
  UPDATE public.master_cost_settings SET
    chip_monthly_cents        = _chip_monthly_cents,
    infra_fixed_monthly_cents = _infra_fixed_monthly_cents,
    payroll_monthly_cents     = _payroll_monthly_cents,
    llm_input_usd_per_mtok    = _llm_input_usd_per_mtok,
    llm_output_usd_per_mtok   = _llm_output_usd_per_mtok,
    usd_brl                   = _usd_brl,
    updated_at                = now(),
    updated_by                = auth.uid()
  WHERE id;

  INSERT INTO public.master_audit_logs (master_user_id, user_id, action, target_type, details)
  VALUES (v_master_id, auth.uid(), 'COST_SETTINGS', 'master_cost_settings',
          jsonb_build_object('before', v_before, 'after', jsonb_build_object(
            'chip_monthly_cents', _chip_monthly_cents,
            'infra_fixed_monthly_cents', _infra_fixed_monthly_cents,
            'payroll_monthly_cents', _payroll_monthly_cents,
            'llm_input_usd_per_mtok', _llm_input_usd_per_mtok,
            'llm_output_usd_per_mtok', _llm_output_usd_per_mtok,
            'usd_brl', _usd_brl)));
END;
$function$;

REVOKE ALL ON FUNCTION public.master_set_cost_settings(integer, integer, integer, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.master_set_cost_settings(integer, integer, integer, numeric, numeric, numeric) TO authenticated, service_role;

-- Versão de 5 argumentos (front anterior a esta migration): mantém a folha.
CREATE OR REPLACE FUNCTION public.master_set_cost_settings(
  _chip_monthly_cents        integer,
  _infra_fixed_monthly_cents integer,
  _llm_input_usd_per_mtok    numeric,
  _llm_output_usd_per_mtok   numeric,
  _usd_brl                   numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.master_set_cost_settings(
    _chip_monthly_cents,
    _infra_fixed_monthly_cents,
    (SELECT s.payroll_monthly_cents FROM public.master_cost_settings s WHERE s.id),
    _llm_input_usd_per_mtok,
    _llm_output_usd_per_mtok,
    _usd_brl);
END;
$function$;

COMMENT ON FUNCTION public.master_set_cost_settings(integer, integer, numeric, numeric, numeric) IS
  'Compat do front anterior a 20271113000000: delega para a versão com folha, preservando o valor gravado.';
