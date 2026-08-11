-- 20270811000001_drop_organizations_plan_id.sql
--
-- SCRUM-338 — a cota da organização passa a resolver o plano por NOME, e a
-- coluna `organizations.plan_id` morre.
--
-- O DEFEITO (mordeu produção em 11/08/2026)
-- `trg_sync_org_plan_quotas` disparava em `UPDATE OF subscription_plan,
-- plan_id`, mas `sync_org_plan_quotas()` só preenchia `plan_id` QUANDO ELE
-- ERA NULO. O Master troca o plano escrevendo o TEXTO (`subscription_plan`);
-- `plan_id` ficava com o plano velho; e a sincronia de `org_quotas.plan_base`
-- lia justamente por `plan_id`. Resultado: cota vinda do plano ERRADO — 8
-- organizações pagantes ficaram com `max_users` 2 (free) em vez de 5. Os DADOS
-- dessas organizações foram corrigidos à mão em produção; esta migration mata
-- a CAUSA para não voltar.
--
-- POR QUE MATAR A COLUNA, e não só consertar a resolução
-- Duas fontes para o mesmo fato (o texto em `subscription_plan` e o id em
-- `plan_id`) só podem divergir, e divergiram. `subscription_plan` é o que o
-- Master escreve e o que o CHECK da tabela governa; `plan_id` era um cache
-- derivado que ninguém lia — medido em produção antes desta mudança:
--   • nenhuma função, policy, view ou trigger além do próprio
--     `sync_org_plan_quotas()` lê `organizations.plan_id`;
--   • as funções que citam `plan_id` (`_resolve_plan_base_for_resource`,
--     `org_get_seat_usage`, `org_resolve_quota`, `sync_org_quotas_from_plan`)
--     falam de `org_subscriptions.plan_id` — OUTRA coluna, na tabela do
--     snapshot, que PERMANECE;
--   • nenhum consumidor no front nem em edge function (todo `plan_id` em `src/`
--     e `supabase/functions/` é de disparo em massa, `blast_plans` — homônimo
--     sem relação).
--
-- Sem backfill de dado de cliente aqui, por desenho: esta migration é só
-- schema. O reparo dos dados já foi feito em produção, e a sincronia correta
-- passa a acontecer sozinha na próxima troca de plano.

-- ---------------------------------------------------------------------------
-- 1. A função resolve o plano por NOME, e nunca mais escreve `plan_id`.
--    CREATE OR REPLACE (e não DROP + CREATE) preserva os GRANTs existentes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_org_plan_quotas() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_limits JSONB;
  v_resource TEXT;
BEGIN
  IF NEW.subscription_plan IS NULL THEN
    RETURN NEW;
  END IF;

  -- Fonte única: o NOME do plano vigente na organização.
  -- ORDER BY torna a escolha determinística caso o catálogo carregue nomes
  -- repetidos (`LIMIT 1` sozinho devolveria linha arbitrária).
  SELECT sp.limits INTO v_limits
  FROM public.subscription_plans sp
  WHERE sp.name = NEW.subscription_plan
  ORDER BY sp.is_active DESC NULLS LAST, sp.position, sp.created_at
  LIMIT 1;

  -- Nome sem linha no catálogo (o CHECK de `subscription_plan` aceita 'basic',
  -- 'starter', 'torque-*', que podem não existir em `subscription_plans`):
  -- deixa a cota como está. Sincronizar para "limites nulos" rebaixaria a
  -- organização a zero em silêncio.
  IF v_limits IS NULL THEN
    RETURN NEW;
  END IF;

  FOREACH v_resource IN ARRAY ARRAY[
    'max_whatsapp_instances', 'max_copilot_agents', 'max_users'
  ] LOOP
    -- Só `plan_base` é do plano. `purchased_addons` e `admin_adjustment` são
    -- do cliente e não são tocados aqui — há organizações em produção com
    -- ajuste manual, e `effective_limit` é coluna GERADA sobre os três.
    INSERT INTO public.org_quotas (organization_id, resource_key, plan_base)
    VALUES (NEW.id, v_resource, COALESCE((v_limits->>v_resource)::INTEGER, 0))
    ON CONFLICT (organization_id, resource_key) DO UPDATE
    SET plan_base = EXCLUDED.plan_base,
        updated_at = NOW();
  END LOOP;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_org_plan_quotas() IS
  'Sincroniza org_quotas.plan_base a partir de subscription_plans.limits, resolvendo o plano pelo NOME em organizations.subscription_plan. Preserva purchased_addons e admin_adjustment. SCRUM-338: a resolução por organizations.plan_id foi removida junto com a coluna — ela ficava velha na troca de plano e entregava a cota do plano errado (8 orgs pagantes em 11/08/2026).';

-- ---------------------------------------------------------------------------
-- 2. O gatilho para de escutar a coluna que vai morrer.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_sync_org_plan_quotas ON public.organizations;

CREATE TRIGGER trg_sync_org_plan_quotas
  AFTER INSERT OR UPDATE OF subscription_plan ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.sync_org_plan_quotas();

-- ---------------------------------------------------------------------------
-- 3. A coluna morre. Leva junto `organizations_plan_id_fkey`.
-- ---------------------------------------------------------------------------
ALTER TABLE public.organizations DROP COLUMN IF EXISTS plan_id;
