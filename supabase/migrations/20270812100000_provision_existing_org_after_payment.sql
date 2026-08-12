-- 20270812100000_provision_existing_org_after_payment.sql
--
-- Fatia 9 (parte 1 de 2) — o pagamento vira ACESSO, para organização que já
-- existe. A Fatia 6 escreve o FATO (`org_subscriptions` corrente, via
-- `billing_apply_paid_subscription`); esta lê o fato e abre a porta. Sem ela, o
-- dinheiro entra, a assinatura existe e ninguém consegue usar o sistema.
--
-- ═══ POR QUE WORKER, E NÃO DENTRO DO WEBHOOK ═══
--
-- O webhook devolve 200 SEMPRE, porque a fila do provedor pausa em 15 falhas e
-- um evento envenenado bloqueia todos os seguintes. Provisionar lá dentro
-- herdaria isso: falharia, devolveria 200, e a organização ficaria PAGA E
-- INACESSÍVEL em silêncio. É a mesma forma do 42P10 que esta fatia acabou de
-- matar, um andar acima. No worker, falha é vermelho visível — não 200 mentiroso.
--
-- ═══ O QUE É "ATIVAR", medido e não suposto ═══
--
-- O gate comercial do servidor é `org_get_subscription_status`, e ele lê
-- `subscription_status`, `subscription_plan`, `subscription_expires_at` e
-- `billing_override` de `organizations`. Ativar é escrever os três primeiros.
--
-- E `subscription_plan` é escrito com o NOME do plano DE PROPÓSITO: o gatilho
-- `trg_sync_org_plan_quotas` (SCRUM-338) dispara em `UPDATE OF subscription_plan`
-- e sincroniza `org_quotas.plan_base` sozinho. Escrever cota aqui recriaria a
-- segunda fonte de verdade que a SCRUM-338 acabou de matar — este arquivo NÃO
-- toca `org_quotas`, e há asserção provando que a cota chega assim mesmo.
--
-- ═══ IDEMPOTÊNCIA: LIVRO, como o resto da fatia ═══
--
-- `CONFIRMED` e `RECEIVED` da mesma cobrança chegam duas vezes (no cartão, com
-- 32 dias de intervalo). Provisionar é INSERIR no livro, e a segunda vez é
-- recusada pelo BANCO — não por um `IF`, que perderia a corrida entre dois
-- eventos simultâneos. O livro também responde "esta organização foi ativada
-- por causa de qual pagamento?", que um carimbo de data nunca responderia.
--
-- Escopo: SÓ `existing_org`. `new_org` precisa de e-mail e documento do
-- comprador, que hoje NÃO são persistidos em lugar nenhum (medido: nem
-- `payment_links` nem `payment_link_charges` os têm) — entra quando a captura
-- existir. Fazer a metade que já é possível prova a costura difícil antes.

-- ---------------------------------------------------------------------------
-- 1. O livro de provisionamentos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_provisionings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- A cobrança que pagou. É a chave da idempotência.
  provider_payment_id text NOT NULL,
  target_kind text NOT NULL DEFAULT 'existing_org',
  plan_name text,
  activated_until timestamptz,
  provisioned_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscription_provisionings_target_kind_check
    CHECK (target_kind IN ('existing_org', 'new_org'))
);

CREATE UNIQUE INDEX IF NOT EXISTS subscription_provisionings_payment_key
  ON public.subscription_provisionings (provider_payment_id);

CREATE INDEX IF NOT EXISTS idx_subscription_provisionings_org
  ON public.subscription_provisionings (organization_id, provisioned_at DESC);

COMMENT ON TABLE public.subscription_provisionings IS
  'Livro de provisionamentos. UNIQUE(provider_payment_id) é a idempotência: o par CONFIRMED/RECEIVED da mesma cobrança ativa UMA vez. Responde "esta organização foi ativada por causa de qual pagamento?" — pergunta de disputa que um carimbo de data não responde.';

ALTER TABLE public.subscription_provisionings ENABLE ROW LEVEL SECURITY;

CREATE POLICY subscription_provisionings_service_or_master
  ON public.subscription_provisionings
  FOR ALL
  USING (
    ((current_setting('request.jwt.claims', true))::jsonb ->> 'role') = 'service_role'
    OR (SELECT public.is_master_user())
  )
  WITH CHECK (
    ((current_setting('request.jwt.claims', true))::jsonb ->> 'role') = 'service_role'
    OR (SELECT public.is_master_user())
  );

REVOKE ALL ON public.subscription_provisionings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.subscription_provisionings TO service_role;

-- ---------------------------------------------------------------------------
-- 2. A ativação — uma transação, service_role apenas
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.billing_provision_existing_org(
  p_provider_payment_id text
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_sub   public.org_subscriptions%ROWTYPE;
  v_plan  text;
  v_meses integer;
  v_ate   timestamptz;
  v_role  text := coalesce(
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role'), '');
BEGIN
  -- Gate no CORPO, além do GRANT. `DROP + CREATE` devolve EXECUTE a PUBLIC, e
  -- isso já aconteceu neste repositório.
  IF v_role <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'access_denied: billing_provision_existing_org é só do serviço'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_sub
    FROM public.org_subscriptions
   WHERE provider_payment_id = p_provider_payment_id
     AND cancelled_at IS NULL;

  IF NOT FOUND THEN
    -- Cobrança sem assinatura ainda: a Fatia 6 não gravou (ou não vai gravar).
    -- Recusa LIMPA, com código próprio — não é incidente, é ordem de chegada.
    RETURN jsonb_build_object('ok', false, 'code', 'subscription_not_found');
  END IF;

  SELECT sp.name INTO v_plan
    FROM public.subscription_plans sp
   WHERE sp.id = v_sub.plan_id;

  IF v_plan IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'plan_not_found');
  END IF;

  v_meses := CASE v_sub.billing_cycle
               WHEN 'monthly'    THEN 1
               WHEN 'semiannual' THEN 6
               WHEN 'annual'     THEN 12
               ELSE 1
             END;

  -- Renovação SOMA sobre o vencimento vigente quando ele ainda está no futuro;
  -- caso contrário conta de agora. Sem isso, quem renova antes de vencer
  -- perderia os dias que já pagou.
  v_ate := greatest(
             coalesce((SELECT subscription_expires_at FROM public.organizations
                        WHERE id = v_sub.organization_id), now()),
             now()
           ) + make_interval(months => v_meses);

  -- ESCREVE O NOME DO PLANO, não a cota. `trg_sync_org_plan_quotas` (SCRUM-338)
  -- dispara em UPDATE OF subscription_plan e sincroniza `org_quotas.plan_base`.
  -- Tocar a cota aqui seria a segunda fonte de verdade que aquela fatia matou.
  UPDATE public.organizations
     SET subscription_status     = 'active',
         subscription_plan       = v_plan,
         subscription_expires_at = v_ate,
         updated_at              = now()
   WHERE id = v_sub.organization_id;

  -- Consumir é INSERIR. A segunda entrega da mesma cobrança bate no UNIQUE e
  -- não vira segundo provisionamento.
  INSERT INTO public.subscription_provisionings
    (organization_id, provider_payment_id, target_kind, plan_name, activated_until)
  VALUES
    (v_sub.organization_id, p_provider_payment_id, 'existing_org', v_plan, v_ate)
  ON CONFLICT (provider_payment_id) DO NOTHING;

  RETURN jsonb_build_object(
    'ok', true,
    'code', 'provisioned',
    'organization_id', v_sub.organization_id,
    'plan', v_plan,
    'active_until', v_ate);
END;
$$;

COMMENT ON FUNCTION public.billing_provision_existing_org(text) IS
  'Transforma pagamento confirmado em ACESSO para organização existente: subscription_status/plan/expires_at em organizations, e uma linha no livro de provisionamentos. NÃO escreve org_quotas — quem sincroniza é trg_sync_org_plan_quotas ao ver o NOME do plano (SCRUM-338). Só service_role.';

REVOKE ALL ON FUNCTION public.billing_provision_existing_org(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_provision_existing_org(text) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. O cron do worker — AGENDADO NA MIGRATION, de propósito
-- ---------------------------------------------------------------------------
-- Medido em 11/08: produção tem 53 jobs de cron e a cadeia do repositório
-- produz 9. Os 44 restantes só existem porque alguém os criou à mão, e
-- ambiente novo — branch efêmera, `db reset`, projeto novo — nasce sem eles.
-- O `cron_health_check` é um desses: existe em prod e em lugar nenhum que se
-- possa recriar.
--
-- Este não vai ser o 45º. Agendar aqui é o que faz o worker sobreviver a reset.
CREATE OR REPLACE FUNCTION public.invoke_billing_provision_worker() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_url TEXT := 'https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/billing-provision-worker';
  v_secret TEXT;
BEGIN
  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', COALESCE(v_secret, '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
EXCEPTION
  -- Mesmo engole-tudo das outras `invoke_*`: cron que levanta exceção fica
  -- marcado como falho e polui `cron.job_run_details`. Esta função não decide
  -- nada — só dispara o POST.
  WHEN undefined_function THEN NULL;
  WHEN OTHERS THEN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_billing_provision_worker() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.invoke_billing_provision_worker() IS
  'Dispara billing-provision-worker via pg_net. Chamada pelo cron billing-provision-worker a cada 2 minutos. REVOKE de anon/authenticated desde o nascimento — em 11/08 fechamos 27 invocadores que eram acionáveis por usuário logado.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'billing-provision-worker') THEN
    PERFORM cron.unschedule('billing-provision-worker');
  END IF;

  -- 2 minutos: o cliente que acabou de pagar não espera mais que isso pela
  -- liberação, e o custo de rodar em vazio é um SELECT que não acha nada.
  PERFORM cron.schedule(
    'billing-provision-worker',
    '*/2 * * * *',
    $cron$SELECT public.invoke_billing_provision_worker()$cron$
  );
END $$;
