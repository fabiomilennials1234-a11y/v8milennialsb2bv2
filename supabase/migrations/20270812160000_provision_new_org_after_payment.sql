-- 20270812160000_provision_new_org_after_payment.sql
--
-- Fatia 9 (parte 2 de 2) — a metade que faltava: pagamento de organização NOVA
-- vira organização + acesso. A parte 1 (`existing_org`) já está na main.
--
-- ═══ POR QUE ESTA METADE ESPEROU ═══
--
-- Ela precisa de e-mail e nome do comprador, e até o #1553 esses dados passavam
-- pelo checkout e SUMIAM — não eram persistidos em lugar nenhum. Agora vivem em
-- `payment_link_buyers` e saem por `billing_resolve_charge_buyer`, que devolve
-- e-mail e nome e NÃO devolve documento fiscal: provisionar não precisa de CPF,
-- e o menor conjunto que serve é o que torna impossível vazar por acidente.
--
-- ═══ TUDO NUMA TRANSAÇÃO SÓ, E É O PONTO ═══
--
-- Criar organização, gravar histórico, escrever assinatura e ativar são quatro
-- escritas que precisam acontecer JUNTAS. Orquestrar isso do worker deixaria
-- estados intermediários possíveis — organização criada sem assinatura, cliente
-- com login e sem acesso — e cada um deles exigiria um caminho de conserto.
-- Aqui, ou tudo acontece ou nada acontece.
--
-- O que NÃO cabe aqui é a criação do usuário no Auth, que não é SQL. Ela fica
-- no worker, DEPOIS, e o seu fracasso deixa a organização existindo e a linha
-- do livro marcada — estado visível, não silêncio.
--
-- ═══ payment_history.organization_id NÃO AFROUXA ═══
--
-- É a chave de tenant e a RLS depende dela; anulável abriria linha órfã sem
-- dono, que é pior que ausência. Por isso a linha de `payment_history` do ramo
-- `new_org` nasce AQUI, depois da organização existir. Até então a trilha vive
-- em `payment_webhook_events`, que é gravado antes de resolver dono e tem
-- `organization_id` anulável de propósito.
--
-- Consequência que evita diagnóstico errado: enquanto o comprador não existe, o
-- `payment_history` do `new_org` TAMBÉM não existe — e isso é esperado.

-- ---------------------------------------------------------------------------
-- 1. O livro passa a registrar o DESFECHO, não só o sucesso
-- ---------------------------------------------------------------------------
-- Pagamento confirmado sem como criar o admin é a única situação desta fatia em
-- que o silêncio custa dinheiro do cliente. Sem estado no livro, esse caso não
-- teria onde existir: ou a linha some (e ninguém vê), ou entra como sucesso (e
-- mente).
ALTER TABLE public.subscription_provisionings
  ALTER COLUMN organization_id DROP NOT NULL;

ALTER TABLE public.subscription_provisionings
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'provisioned',
  ADD COLUMN IF NOT EXISTS blocked_code text,
  ADD COLUMN IF NOT EXISTS blocked_at timestamptz;

ALTER TABLE public.subscription_provisionings
  DROP CONSTRAINT IF EXISTS subscription_provisionings_status_check;

ALTER TABLE public.subscription_provisionings
  ADD CONSTRAINT subscription_provisionings_status_check
  CHECK (status IN ('provisioned', 'blocked'));

-- Organização nula só é aceitável em linha BLOQUEADA: provisionado sem dono
-- seria a linha órfã que o resto desta fatia recusa criar.
ALTER TABLE public.subscription_provisionings
  DROP CONSTRAINT IF EXISTS subscription_provisionings_org_when_provisioned;

ALTER TABLE public.subscription_provisionings
  ADD CONSTRAINT subscription_provisionings_org_when_provisioned
  CHECK (status <> 'provisioned' OR organization_id IS NOT NULL);

-- A pergunta das 3 da manhã: quem pagou e não recebeu acesso.
CREATE INDEX IF NOT EXISTS idx_subscription_provisionings_blocked
  ON public.subscription_provisionings (blocked_at DESC)
  WHERE status = 'blocked';

COMMENT ON COLUMN public.subscription_provisionings.status IS
  'provisioned = acesso aberto. blocked = pagamento confirmado e provisionamento IMPOSSÍVEL (ver blocked_code) — exige humano. É o único estado desta fatia em que silêncio custa dinheiro do cliente, por isso ele existe no livro em vez de só no log.';

-- ---------------------------------------------------------------------------
-- 2. Bloquear é registrar, não falhar
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.billing_block_provisioning(
  p_provider_payment_id text,
  p_code                text,
  p_organization_id     uuid DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_role text := coalesce((current_setting('request.jwt.claims', true)::jsonb ->> 'role'), '');
  v_novo boolean := false;
BEGIN
  IF v_role <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'access_denied: billing_block_provisioning é só do serviço'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.subscription_provisionings
    (organization_id, provider_payment_id, target_kind, status, blocked_code, blocked_at)
  VALUES
    (p_organization_id, p_provider_payment_id, 'new_org', 'blocked', p_code, now())
  ON CONFLICT (provider_payment_id) DO NOTHING;

  v_novo := FOUND;

  -- `alarmou` distingue a PRIMEIRA vez das seguintes. Quem chama alarma só na
  -- primeira: o worker passa a cada 2 minutos, e repetir o erro a cada passada
  -- afogaria o sinal em vez de emitir um.
  RETURN jsonb_build_object('ok', true, 'code', p_code, 'alarmou', v_novo);
END;
$$;

REVOKE ALL ON FUNCTION public.billing_block_provisioning(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_block_provisioning(text, text, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. A organização nova, numa transação
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.billing_provision_new_org(
  p_provider_payment_id text,
  p_buyer_email         text
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_role   text := coalesce((current_setting('request.jwt.claims', true)::jsonb ->> 'role'), '');
  v_charge record;
  v_quote  jsonb;
  v_plan   text;
  v_plan_id uuid;
  v_meses  integer;
  v_ate    timestamptz;
  v_org    uuid;
  v_slug   text;
  v_nome   text;
  v_cents  integer;
BEGIN
  IF v_role <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'access_denied: billing_provision_new_org é só do serviço'
      USING ERRCODE = '42501';
  END IF;

  -- Já provisionado? Devolve o que existe. É a re-entrega batendo, e ela é o
  -- caminho FELIZ: o par CONFIRMED/RECEIVED chega duas vezes por desenho.
  SELECT organization_id INTO v_org
    FROM public.subscription_provisionings
   WHERE provider_payment_id = p_provider_payment_id
     AND status = 'provisioned';

  IF FOUND AND v_org IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'code', 'already_provisioned', 'organization_id', v_org);
  END IF;

  SELECT c.payment_link_id, l.target_kind, l.new_org_name, l.quote, l.organization_id
    INTO v_charge
    FROM public.payment_link_charges c
    JOIN public.payment_links l ON l.id = c.payment_link_id
   WHERE c.provider_charge_id = p_provider_payment_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'charge_not_found');
  END IF;

  IF v_charge.target_kind <> 'new_org' THEN
    -- Caminho errado: organização existente tem função própria. Recusa limpa em
    -- vez de criar organização duplicada para quem já tem uma.
    RETURN jsonb_build_object('ok', false, 'code', 'not_new_org');
  END IF;

  IF p_buyer_email IS NULL OR position('@' in p_buyer_email) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'buyer_email_missing');
  END IF;

  v_quote := coalesce(v_charge.quote, '{}'::jsonb);
  v_plan_id := nullif(v_quote ->> 'plan_id', '')::uuid;

  SELECT name INTO v_plan FROM public.subscription_plans WHERE id = v_plan_id;
  IF v_plan IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'plan_not_found');
  END IF;

  v_nome := coalesce(nullif(btrim(v_charge.new_org_name), ''), 'Organização ' || left(p_provider_payment_id, 8));

  -- Slug determinístico e único: a parte legível vem do nome, e o sufixo vem da
  -- COBRANÇA. Assim a re-entrega geraria o mesmo slug (e não gera nada, porque
  -- o livro barra antes), e dois clientes com o mesmo nome não colidem.
  -- `translate` em vez de `unaccent`: a extensão não está instalada neste banco
  -- (medido), e depender dela faria a migration morrer em ambiente novo. O
  -- conjunto abaixo cobre o português; o que escapar vira hífen no regexp e não
  -- quebra nada — slug é rótulo, e a unicidade vem do sufixo.
  v_slug := lower(translate(v_nome,
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'));
  v_slug := left(regexp_replace(v_slug, '[^a-z0-9]+', '-', 'g'), 40);
  v_slug := trim(both '-' from v_slug);
  IF v_slug = '' THEN v_slug := 'org'; END IF;
  v_slug := v_slug || '-' || left(md5(p_provider_payment_id), 6);

  v_meses := CASE v_quote ->> 'billing_cycle'
               WHEN 'monthly'    THEN 1
               WHEN 'semiannual' THEN 6
               WHEN 'annual'     THEN 12
               ELSE 1
             END;
  v_ate := now() + make_interval(months => v_meses);
  v_cents := coalesce((v_quote ->> 'charge_cents')::integer, 0);

  -- A organização nasce JÁ ativa e com o NOME do plano — e é o nome que faz
  -- `trg_sync_org_plan_quotas` (SCRUM-338) escrever a cota sozinho. Esta função
  -- não toca `org_quotas`.
  INSERT INTO public.organizations (name, slug, subscription_status, subscription_plan, subscription_expires_at)
  VALUES (v_nome, v_slug, 'active', v_plan, v_ate)
  RETURNING id INTO v_org;

  -- Agora existe dono: a linha de histórico pode nascer sem violar a chave de
  -- tenant, que é o motivo de ela não existir antes.
  INSERT INTO public.payment_history
    (organization_id, asaas_payment_id, amount, billing_cycle, status, paid_at,
     coupon_id, discount_applied)
  VALUES
    (v_org, p_provider_payment_id, v_cents / 100.0,
     coalesce(v_quote ->> 'billing_cycle', 'monthly'), 'received', now(),
     nullif(v_quote ->> 'coupon_id', '')::uuid,
     (coalesce((v_quote ->> 'cycle_discount_cents')::integer, 0)
      + coalesce((v_quote ->> 'coupon_discount_cents')::integer, 0)
      + coalesce((v_quote ->> 'manual_discount_cents')::integer, 0)) / 100.0)
  ON CONFLICT (asaas_payment_id) DO NOTHING;

  PERFORM public.billing_apply_paid_subscription(
    v_org, v_plan_id,
    coalesce(v_quote ->> 'billing_cycle', 'monthly'),
    v_quote ->> 'payment_method',
    p_provider_payment_id,
    coalesce((v_quote ->> 'seats')::integer, 1),
    coalesce((v_quote ->> 'base_amount_cents')::integer, v_cents),
    coalesce((v_quote ->> 'cycle_discount_cents')::integer, 0)
      + coalesce((v_quote ->> 'coupon_discount_cents')::integer, 0)
      + coalesce((v_quote ->> 'manual_discount_cents')::integer, 0),
    v_cents,
    coalesce((v_quote ->> 'cycle_discount_pct')::numeric, 0),
    coalesce((v_quote ->> 'coupon_discount_pct')::numeric, 0),
    coalesce((v_quote ->> 'manual_discount_cents')::integer, 0),
    nullif(v_quote ->> 'coupon_id', '')::uuid,
    'asaas');

  -- O link fica marcado como pago aqui também: no `new_org` o webhook pode não
  -- ter conseguido resolver o link antes de existir organização.
  UPDATE public.payment_links
     SET paid_at = now()
   WHERE id = v_charge.payment_link_id
     AND paid_at IS NULL;

  INSERT INTO public.subscription_provisionings
    (organization_id, provider_payment_id, target_kind, plan_name, activated_until, status)
  VALUES
    (v_org, p_provider_payment_id, 'new_org', v_plan, v_ate, 'provisioned')
  ON CONFLICT (provider_payment_id) DO UPDATE
    SET organization_id = EXCLUDED.organization_id,
        status          = 'provisioned',
        plan_name       = EXCLUDED.plan_name,
        activated_until = EXCLUDED.activated_until,
        blocked_code    = NULL,
        blocked_at      = NULL;

  RETURN jsonb_build_object(
    'ok', true, 'code', 'provisioned',
    'organization_id', v_org, 'slug', v_slug,
    'plan', v_plan, 'active_until', v_ate,
    'admin_email', p_buyer_email);
END;
$$;

COMMENT ON FUNCTION public.billing_provision_new_org(text, text) IS
  'Cria organização, histórico, assinatura e ativação para pagamento de org NOVA — tudo numa transação, porque estados intermediários (org sem assinatura, login sem acesso) exigiriam um caminho de conserto cada. NÃO cria o usuário do Auth: isso não é SQL e fica no worker, depois. Só service_role.';

REVOKE ALL ON FUNCTION public.billing_provision_new_org(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_provision_new_org(text, text) TO service_role;
