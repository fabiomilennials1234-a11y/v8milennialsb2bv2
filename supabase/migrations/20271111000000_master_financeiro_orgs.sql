-- 20271111000000_master_financeiro_orgs.sql
--
-- Financeiro da central Organizações: quanto cada org paga ao Torque, quanto
-- custa para nós e quanto ela mesma vende. Base da margem simplificada.
--
-- MEDIDO 2026-10-08 (prod): a cobrança não passa pelo sistema.
-- `org_subscriptions`, `payment_history` e `payment_links` têm 0 linhas, e
-- 97 das 122 orgs rodam com `billing_override` manual. Logo, o valor pago
-- vem de um campo de CONTRATO preenchido pelo master (`org_billing`); sem
-- contrato, a tela estima pela tabela do plano e marca o valor como estimativa.
--
-- Custo = chips Uazapi × preço por chip + tokens de LLM em 30 dias × preço
-- + infra fixa rateada entre as orgs em uso. Os preços unitários moram em
-- `master_cost_settings` (uma linha) e vêm do master: nenhum número é
-- inventado aqui. A conta fica no front (`lib/org-finance.ts`, testada); o
-- banco entrega só os fatos.
--
-- Limite conhecido: só o Copilot V1 e o Oráculo gravam tokens
-- (`runtime_logs.prompt_tokens`, `oraculo_turns.input_tokens`). O V2 não
-- grava, então o custo de LLM é um PISO, não o valor real.
--
-- Acesso: só master pleno (`permissions.all`). Outbounder não vê dinheiro.
-- Escrita só pelas RPCs, sempre com trilha em `master_audit_logs`.

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.org_billing (
  organization_id   uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  monthly_fee_cents integer NOT NULL CHECK (monthly_fee_cents BETWEEN 0 AND 100000000),
  notes             text,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid
);

COMMENT ON TABLE public.org_billing IS
  'Mensalidade de contrato por org (o que ela paga ao Torque por mês). Escrita só via master_set_org_monthly_fee.';

CREATE TABLE IF NOT EXISTS public.master_cost_settings (
  id                        boolean PRIMARY KEY DEFAULT true CHECK (id),
  chip_monthly_cents        integer NOT NULL DEFAULT 0 CHECK (chip_monthly_cents >= 0),
  infra_fixed_monthly_cents integer NOT NULL DEFAULT 0 CHECK (infra_fixed_monthly_cents >= 0),
  -- Defaults = tabela pública do gpt-4.1-mini, o motor único do Copilot.
  llm_input_usd_per_mtok    numeric(10,4) NOT NULL DEFAULT 0.40 CHECK (llm_input_usd_per_mtok >= 0),
  llm_output_usd_per_mtok   numeric(10,4) NOT NULL DEFAULT 1.60 CHECK (llm_output_usd_per_mtok >= 0),
  -- 0 = câmbio não informado: a tela não converte e avisa.
  usd_brl                   numeric(8,4) NOT NULL DEFAULT 0 CHECK (usd_brl >= 0),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by                uuid
);

COMMENT ON TABLE public.master_cost_settings IS
  'Preços unitários de custo (linha única). Escrita só via master_set_cost_settings.';

INSERT INTO public.master_cost_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- Sem policy: ninguém lê nem escreve direto. Tudo passa pelas RPCs abaixo.
ALTER TABLE public.org_billing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_cost_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.org_billing FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.master_cost_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.org_billing TO service_role;
GRANT ALL ON public.master_cost_settings TO service_role;

-- ---------------------------------------------------------------------------
-- Guarda: master pleno
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_master_full()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  SELECT mu.id INTO v_id
    FROM public.master_users mu
   WHERE mu.user_id = auth.uid()
     AND mu.is_active
     AND COALESCE((mu.permissions ->> 'all')::boolean, false);
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.assert_master_full() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_master_full() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Leitura: fatos financeiros por org
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.master_org_finance()
RETURNS TABLE (
  organization_id       uuid,
  monthly_fee_cents     integer,
  fee_notes             text,
  fee_updated_at        timestamptz,
  uazapi_chips          integer,
  llm_input_tokens_30d  bigint,
  llm_output_tokens_30d bigint,
  client_revenue_30d    numeric,
  client_sales_30d      integer
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
  WITH orgs AS (
    SELECT o.id FROM public.organizations o WHERE NOT o.is_sandbox
  ),
  -- Uazapi cobra por instância provisionada, conectada ou não.
  chips AS (
    SELECT w.organization_id, count(*)::int AS n
      FROM public.whatsapp_instances w
     WHERE w.provider::text = 'uazapi'
     GROUP BY w.organization_id
  ),
  llm AS (
    SELECT t.organization_id, sum(t.i)::bigint AS i, sum(t.o)::bigint AS o
      FROM (
        SELECT r.organization_id, COALESCE(r.prompt_tokens, 0) AS i, COALESCE(r.completion_tokens, 0) AS o
          FROM public.runtime_logs r
         WHERE r.created_at > now() - interval '30 days'
           AND (r.prompt_tokens > 0 OR r.completion_tokens > 0)
        UNION ALL
        SELECT ot.organization_id, COALESCE(ot.input_tokens, 0), COALESCE(ot.output_tokens, 0)
          FROM public.oraculo_turns ot
         WHERE ot.created_at > now() - interval '30 days'
      ) t
     GROUP BY t.organization_id
  ),
  -- Mesma regra de `computeSalesMetrics`: venda que não foi estornada;
  -- `sale_lost` e o próprio estorno não contam.
  vendas AS (
    SELECT s.organization_id, sum(COALESCE(s.sale_value, 0)) AS valor, count(*)::int AS n
      FROM public.sale_events s
     WHERE s.event_type = 'sale'
       AND s.reversed_event_id IS NULL
       AND s.sold_at > now() - interval '30 days'
       AND NOT EXISTS (SELECT 1 FROM public.sale_events r WHERE r.reversed_event_id = s.id)
     GROUP BY s.organization_id
  )
  SELECT o.id,
         b.monthly_fee_cents,
         b.notes,
         b.updated_at,
         COALESCE(c.n, 0),
         COALESCE(l.i, 0),
         COALESCE(l.o, 0),
         COALESCE(v.valor, 0),
         COALESCE(v.n, 0)
    FROM orgs o
    LEFT JOIN public.org_billing b ON b.organization_id = o.id
    LEFT JOIN chips c ON c.organization_id = o.id
    LEFT JOIN llm l ON l.organization_id = o.id
    LEFT JOIN vendas v ON v.organization_id = o.id;
END;
$function$;

COMMENT ON FUNCTION public.master_org_finance() IS
  'Fatos financeiros por org (mensalidade de contrato, chips Uazapi, tokens LLM 30d, vendas líquidas 30d). Master pleno.';

REVOKE ALL ON FUNCTION public.master_org_finance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.master_org_finance() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.master_get_cost_settings()
RETURNS TABLE (
  chip_monthly_cents        integer,
  infra_fixed_monthly_cents integer,
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
  SELECT s.chip_monthly_cents, s.infra_fixed_monthly_cents, s.llm_input_usd_per_mtok,
         s.llm_output_usd_per_mtok, s.usd_brl, s.updated_at
    FROM public.master_cost_settings s
   WHERE s.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.master_get_cost_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.master_get_cost_settings() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Escrita auditada
-- ---------------------------------------------------------------------------
-- `_fee_cents` NULL apaga o contrato: a org volta a ser estimada pela tabela.
CREATE OR REPLACE FUNCTION public.master_set_org_monthly_fee(
  _org_id    uuid,
  _fee_cents integer,
  _notes     text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_master_id uuid := public.assert_master_full();
  v_before    integer;
  v_name      text;
BEGIN
  SELECT o.name INTO v_name FROM public.organizations o WHERE o.id = _org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organizacao % nao encontrada', _org_id USING ERRCODE = '22023';
  END IF;
  IF _fee_cents IS NOT NULL AND (_fee_cents < 0 OR _fee_cents > 100000000) THEN
    RAISE EXCEPTION 'Mensalidade invalida: %', _fee_cents USING ERRCODE = '22023';
  END IF;

  SELECT b.monthly_fee_cents INTO v_before FROM public.org_billing b WHERE b.organization_id = _org_id FOR UPDATE;

  IF _fee_cents IS NULL THEN
    DELETE FROM public.org_billing WHERE organization_id = _org_id;
  ELSE
    INSERT INTO public.org_billing (organization_id, monthly_fee_cents, notes, updated_at, updated_by)
    VALUES (_org_id, _fee_cents, NULLIF(btrim(_notes), ''), now(), auth.uid())
    ON CONFLICT (organization_id) DO UPDATE
      SET monthly_fee_cents = EXCLUDED.monthly_fee_cents,
          notes             = EXCLUDED.notes,
          updated_at        = EXCLUDED.updated_at,
          updated_by        = EXCLUDED.updated_by;
  END IF;

  INSERT INTO public.master_audit_logs (master_user_id, user_id, action, target_type, target_id, target_name, details)
  VALUES (v_master_id, auth.uid(), 'ORG_MONTHLY_FEE', 'organization', _org_id, v_name,
          jsonb_build_object('before_cents', v_before, 'after_cents', _fee_cents, 'notes', _notes));
END;
$function$;

REVOKE ALL ON FUNCTION public.master_set_org_monthly_fee(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.master_set_org_monthly_fee(uuid, integer, text) TO authenticated, service_role;

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
DECLARE
  v_master_id uuid := public.assert_master_full();
  v_before    jsonb;
BEGIN
  SELECT to_jsonb(s) - 'id' INTO v_before FROM public.master_cost_settings s WHERE s.id FOR UPDATE;

  -- Os CHECKs da tabela rejeitam negativo com 23514.
  UPDATE public.master_cost_settings SET
    chip_monthly_cents        = _chip_monthly_cents,
    infra_fixed_monthly_cents = _infra_fixed_monthly_cents,
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
            'llm_input_usd_per_mtok', _llm_input_usd_per_mtok,
            'llm_output_usd_per_mtok', _llm_output_usd_per_mtok,
            'usd_brl', _usd_brl)));
END;
$function$;

REVOKE ALL ON FUNCTION public.master_set_cost_settings(integer, integer, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.master_set_cost_settings(integer, integer, numeric, numeric, numeric) TO authenticated, service_role;
