-- 20270806000000_subscription_snapshot_base_layer.sql
--
-- Fatia 3 do PRD #1393. Implementa o contrato de #1380 e as decisões de #1382.
--
-- O snapshot da assinatura vira a CAMADA BASE de onde `org_get_features_and_limits` resolve
-- features e limites, substituindo o join com `subscription_plans`. As camadas acima
-- (`organization_features`, `limit_overrides`, `org_quotas`) continuam intactas.
--
-- NASCE INERTE: `org_subscriptions` está vazia em produção (0 linhas), então toda org cai
-- no fallback pro plano e nada muda de comportamento até o backfill de #1391 rodar.
--
-- ATENÇÃO — esta migration NÃO faz backfill. Popular `org_subscriptions` muda a resolução
-- de quota de 90 organizações de uma vez, porque `_resolve_plan_base_for_resource` já
-- prioriza esta tabela sobre `organizations.subscription_plan`. Ver #1391.

-- ---------------------------------------------------------------------------
-- 1. Append-only: uma assinatura VIGENTE por org, não uma linha por org
-- ---------------------------------------------------------------------------
--
-- O índice único atual em organization_id impede o versionamento decidido em #1380:
-- toda mudança de pacote ou preço cria linha nova, e a antiga vira histórico.

-- A constraint primeiro: o índice sustenta a UNIQUE e não pode ser dropado sozinho.
ALTER TABLE public.org_subscriptions
  DROP CONSTRAINT IF EXISTS org_subscriptions_organization_id_key;
-- E o índice depois, para o caso de existir solto sem constraint por trás.
DROP INDEX IF EXISTS public.org_subscriptions_organization_id_key;

CREATE UNIQUE INDEX org_subscriptions_one_current_per_org
  ON public.org_subscriptions (organization_id)
  WHERE cancelled_at IS NULL;

COMMENT ON INDEX public.org_subscriptions_one_current_per_org IS
  'Append-only: várias versões por org no tempo, mas no máximo uma vigente (cancelled_at IS NULL).';

-- ---------------------------------------------------------------------------
-- 2. Dinheiro em centavos inteiros
-- ---------------------------------------------------------------------------
--
-- Seguro porque a tabela está vazia. Centavos inteiros ponta a ponta é o mesmo contrato de
-- `_shared/payments/money.ts` — nenhum float toca valor cobrado em lugar nenhum do sistema.

ALTER TABLE public.org_subscriptions
  DROP COLUMN IF EXISTS base_amount,
  DROP COLUMN IF EXISTS discount_amount,
  DROP COLUMN IF EXISTS final_amount,
  -- Sem uma única referência no código, em tabela vazia (#1380).
  DROP COLUMN IF EXISTS addon_turbo_count;

ALTER TABLE public.org_subscriptions
  ADD COLUMN base_amount_cents     integer NOT NULL DEFAULT 0,
  ADD COLUMN discount_amount_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN final_amount_cents    integer NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 3. O snapshot
-- ---------------------------------------------------------------------------

ALTER TABLE public.org_subscriptions
  -- Exaustivo sobre as chaves is_sellable: toda feature vendável tem valor explícito.
  ADD COLUMN features jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Os 10 limites, com o valor efetivamente vendido.
  ADD COLUMN limits   jsonb NOT NULL DEFAULT '{}'::jsonb,

  ADD COLUMN payment_method       text,
  ADD COLUMN cycle_discount_pct   numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN coupon_discount_pct  numeric(5,2) NOT NULL DEFAULT 0,

  -- Trilha do desconto manual (#1381): sem teto, mas nunca sem motivo.
  ADD COLUMN manual_discount_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN manual_discount_reason text,
  ADD COLUMN manual_discount_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  ADD COLUMN created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN provider                 text,
  ADD COLUMN provider_subscription_id text;

COMMENT ON COLUMN public.org_subscriptions.features IS
  'Snapshot exaustivo das features vendáveis no momento da venda. Camada BASE da resolução — organization_features continua por cima. Chaves não vendáveis (rollout/infra) não entram aqui e seguem resolvendo por feature_catalog.default_enabled.';
COMMENT ON COLUMN public.org_subscriptions.limits IS
  'Limites vendidos. org_quotas.plan_base é derivado daqui (#1382); purchased_addons e admin_adjustment continuam como deltas operacionais por cima.';
COMMENT ON COLUMN public.org_subscriptions.renews_at IS
  'Fim do ciclo. NOT NULL para trial (assinatura de valor zero com fim obrigatório). NULL com valor zero = cortesia permanente (#1382).';

-- ---------------------------------------------------------------------------
-- 4. Invariantes
-- ---------------------------------------------------------------------------

ALTER TABLE public.org_subscriptions
  ADD CONSTRAINT org_subscriptions_billing_cycle_valid
    CHECK (billing_cycle IN ('monthly', 'semiannual', 'annual')),

  ADD CONSTRAINT org_subscriptions_payment_method_valid
    CHECK (payment_method IS NULL OR payment_method IN ('pix', 'credit_card')),

  -- Decisão #5 do mapa, gravada no schema e não só no código: Pix não tem recorrência
  -- automática, então não se vende Pix mensal. Mesma regra de _shared/payments/policy.ts.
  ADD CONSTRAINT org_subscriptions_pix_long_cycle_only
    CHECK (payment_method IS DISTINCT FROM 'pix' OR billing_cycle IN ('semiannual', 'annual')),

  -- Desconto manual sem motivo é buraco de receita invisível (#1381).
  ADD CONSTRAINT org_subscriptions_manual_discount_needs_reason
    CHECK (manual_discount_cents = 0 OR nullif(btrim(coalesce(manual_discount_reason, '')), '') IS NOT NULL),

  ADD CONSTRAINT org_subscriptions_amounts_sane
    CHECK (
      base_amount_cents     >= 0
      AND discount_amount_cents >= 0
      AND final_amount_cents    >= 0
      AND final_amount_cents    <= base_amount_cents
    ),

  ADD CONSTRAINT org_subscriptions_user_count_positive
    CHECK (user_count IS NULL OR user_count >= 0);

-- Índice do caminho quente: `org_get_features_and_limits` roda a cada carregamento de tela
-- em 97 organizações e precisa achar a assinatura vigente num lookup só.
CREATE INDEX IF NOT EXISTS idx_org_subscriptions_current
  ON public.org_subscriptions (organization_id)
  WHERE cancelled_at IS NULL;

-- ---------------------------------------------------------------------------
-- 5. A camada base
-- ---------------------------------------------------------------------------
--
-- Mudança única e cirúrgica: a base de features e limites passa a vir do snapshot quando
-- ele existe. Tudo acima na cadeia continua exatamente como estava.
--
-- Ordem de resolução, com snapshot:
--   snapshot.features → organization_features → default_enabled (só chaves NÃO vendáveis)
--   snapshot.limits   → limit_overrides → org_quotas.effective_limit
--
-- Ordem de resolução, sem snapshot (fallback PERMANENTE, não transitório):
--   plano → organization_features → default_enabled (todas as ausentes)
--   plano.limits → limit_overrides → org_quotas.effective_limit
--
-- Por que `default_enabled` continua preenchendo chaves não vendáveis mesmo com snapshot:
-- o snapshot é exaustivo apenas sobre `is_sellable = true`. Flags de rollout e chaves de
-- infraestrutura nunca são vendidas e portanto não entram nele — se não fossem preenchidas
-- aqui, sumiriam para toda org com snapshot. Grandfathering continua garantido, porque
-- nenhuma chave vendável é tocada por este passo.

CREATE OR REPLACE FUNCTION public.org_get_features_and_limits(p_org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_features    JSONB := '{}';
  v_limits      JSONB := '{}';
  v_org         RECORD;
  v_snapshot    RECORD;
  v_override    RECORD;
  v_flag        RECORD;
  v_quota_row   RECORD;
  v_plan_name   TEXT;
  v_quota_keys  TEXT[] := ARRAY['max_whatsapp_instances', 'max_users', 'max_copilot_agents'];
BEGIN
  -- Master: tudo habilitado e ilimitado (inalterado)
  IF public.is_master_user() THEN
    FOR v_flag IN SELECT key FROM public.feature_catalog LOOP
      v_features := v_features || jsonb_build_object(v_flag.key, true);
    END LOOP;
    RETURN jsonb_build_object(
      'features', v_features,
      'limits', '{"max_leads":-1,"max_users":-1,"max_campaigns":-1,"max_copilot_agents":-1,"max_whatsapp_instances":-1,"max_funnels":-1,"max_documents_per_agent":-1}'::JSONB,
      'plan_name', 'master'
    );
  END IF;

  -- ── Camada BASE ──────────────────────────────────────────────────────────
  SELECT os.features, os.limits, sp.name AS plan_name
  INTO v_snapshot
  FROM public.org_subscriptions os
  LEFT JOIN public.subscription_plans sp ON sp.id = os.plan_id
  WHERE os.organization_id = p_org_id
    AND os.cancelled_at IS NULL;

  IF FOUND THEN
    v_features  := COALESCE(v_snapshot.features, '{}'::jsonb);
    v_limits    := COALESCE(v_snapshot.limits, '{}'::jsonb);
    v_plan_name := v_snapshot.plan_name;
  ELSE
    -- Fallback pro plano. Permanente: é o que serve org recém-criada e o que permite
    -- migrar a base em fases.
    SELECT o.subscription_plan,
           COALESCE(sp.features, '{}') AS plan_features,
           COALESCE(sp.limits, '{}')   AS plan_limits
    INTO v_org
    FROM public.organizations o
    LEFT JOIN public.subscription_plans sp ON sp.name = o.subscription_plan
    WHERE o.id = p_org_id;

    v_features  := COALESCE(v_org.plan_features, '{}');
    v_limits    := COALESCE(v_org.plan_limits, '{}');
    v_plan_name := v_org.subscription_plan;
  END IF;

  -- ── Overrides de feature por org (inalterado) ────────────────────────────
  FOR v_override IN
    SELECT feature_key, enabled
    FROM public.organization_features
    WHERE organization_id = p_org_id
      AND (expires_at IS NULL OR expires_at > NOW())
  LOOP
    v_features := v_features || jsonb_build_object(v_override.feature_key, v_override.enabled);
  END LOOP;

  -- ── default_enabled para o que ainda não foi resolvido ───────────────────
  -- Com snapshot, alcança apenas chaves não vendáveis (rollout e infraestrutura), porque
  -- o snapshot já é exaustivo sobre as vendáveis.
  FOR v_flag IN
    SELECT key, default_enabled FROM public.feature_catalog
    WHERE NOT (v_features ? key)
  LOOP
    v_features := v_features || jsonb_build_object(v_flag.key, v_flag.default_enabled);
  END LOOP;

  -- ── Limites: overrides e quotas por cima (inalterado) ────────────────────
  SELECT o.limit_overrides INTO v_org FROM public.organizations o WHERE o.id = p_org_id;
  IF v_org.limit_overrides IS NOT NULL AND v_org.limit_overrides != '{}'::JSONB THEN
    v_limits := v_limits || v_org.limit_overrides;
  END IF;

  FOR v_quota_row IN
    SELECT oq.resource_key, oq.effective_limit
    FROM public.org_quotas oq
    WHERE oq.organization_id = p_org_id
      AND oq.resource_key = ANY(v_quota_keys)
  LOOP
    v_limits := v_limits || jsonb_build_object(v_quota_row.resource_key, v_quota_row.effective_limit);
  END LOOP;

  RETURN jsonb_build_object(
    'features', v_features,
    'limits', v_limits,
    'plan_name', COALESCE(v_plan_name, 'free')
  );
END;
$function$;
