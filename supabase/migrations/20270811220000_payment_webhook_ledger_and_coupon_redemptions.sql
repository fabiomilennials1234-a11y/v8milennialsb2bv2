-- 20270811220000_payment_webhook_ledger_and_coupon_redemptions.sql
--
-- SCRUM-287 (Fatia 6) — o que o webhook do gateway precisa para que
-- `payment_history` e `org_subscriptions` deixem de ser tabelas modeladas e
-- nunca ligadas. Hoje as duas têm ZERO linhas: o Torque cobra e o sistema não
-- registra.
--
-- Duas coisas nascem aqui, e as duas são LIVRO, não contador.
--
-- ═══ 1. `payment_webhook_events` — a idempotência mora no banco ═══
--
-- A entrega do Asaas é at-least-once e o `id` do evento (`evt_…`) é ESTÁVEL
-- entre re-entregas — é o próprio provedor que documenta isso e que publica o
-- padrão UNIQUE + tratar 23505 como sucesso. Então a chave já existe e não se
-- inventa outra: `UNIQUE (provider, provider_event_id)`.
--
-- Guardar o evento tem um segundo uso, que é o que salva a operação: evento de
-- tipo DESCONHECIDO é absorvido e gravado em vez de virar erro. Isso não é
-- indulgência — em modo SEQUENTIALLY, UM evento penalizado bloqueia TODOS os
-- seguintes da mesma fila, e 15 falhas consecutivas PAUSAM a fila inteira.
-- Devolver erro num evento que não sabemos tratar derruba o recebimento de
-- TODA a receita, não só daquele evento. O livro é onde o desconhecido espera
-- inspeção sem travar o resto.
--
-- ═══ 2. `coupon_redemptions` — livro de resgates, não contador ═══
--
-- `coupons.current_uses` diz QUANTO, nunca QUEM, QUANDO nem EM QUAL pagamento.
-- Com cupom de 35% circulando, "quem usou o MILENNIALS35" é pergunta comercial
-- que vai ser feita. Mesma forma que este repositório já adotou duas vezes:
-- `sale_events` é livro append-only e a comissão é projeção (ADR-0017), e a
-- lição registrada é "coluna de estado não é trilha".
--
-- Consumir passa a ser INSERIR. A segunda inserção do mesmo pagamento é
-- recusada pelo BANCO (`UNIQUE (coupon_id, payment_id)`), não por um `IF` no
-- código — que é o que faz a re-entrega ser inofensiva por construção.
--
-- E fecha um furo herdado: `validate_coupon` é STABLE e NUNCA incrementa
-- `current_uses`, então o limite é checado e jamais consumido — `max_uses = 1`
-- vale infinitas vezes hoje. O consumo pertence à CONFIRMAÇÃO do pagamento,
-- não à validação: validar é leitura, e o cliente abre o link dez vezes sem
-- pagar.
--
-- ═══ 3. `increment_coupon_uses` perde o alcance de usuário logado ═══
--
-- Ela está CORRETA (VOLATILE, atômica, com guarda `current_uses < max_uses`) e
-- ninguém a chama. Mas tem EXECUTE para `authenticated`: qualquer usuário
-- logado queima uso de cupom alheio pelo PostgREST. Continua existindo como
-- projeção; deixa de ser alcançável do navegador.
--
-- Só schema. Sem backfill: as duas tabelas de destino estão vazias, não há
-- histórico para reconstruir, e inventar linha seria pior que a lacuna.

-- ---------------------------------------------------------------------------
-- 1. Livro de eventos do gateway
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Provider-neutral por desenho: o dia em que houver um segundo gateway, a
  -- chave de idempotência continua sendo (provedor, id do evento dele).
  provider text NOT NULL DEFAULT 'asaas',
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  -- NULO enquanto o evento não foi resolvido para uma organização — o webhook
  -- chega antes de sabermos de quem é, e mentir uma org aqui seria pior.
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  provider_payment_id text,
  status text NOT NULL DEFAULT 'received',
  error_message text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CONSTRAINT payment_webhook_events_status_check
    CHECK (status IN ('received', 'applied', 'ignored', 'unknown_type', 'failed'))
);

-- A CHAVE. É ela que faz a re-entrega produzir UMA linha, e é o banco que
-- decide — não um SELECT-antes-do-INSERT, que perde a corrida entre duas
-- entregas simultâneas.
CREATE UNIQUE INDEX IF NOT EXISTS payment_webhook_events_provider_event_key
  ON public.payment_webhook_events (provider, provider_event_id);

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_org
  ON public.payment_webhook_events (organization_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_unresolved
  ON public.payment_webhook_events (received_at DESC)
  WHERE status IN ('unknown_type', 'failed');

COMMENT ON TABLE public.payment_webhook_events IS
  'Livro append-only dos eventos do gateway de pagamento. UNIQUE(provider, provider_event_id) é a idempotência: a re-entrega bate no índice e o 23505 é tratado como sucesso. Evento de tipo desconhecido é ABSORVIDO aqui com status unknown_type — devolver erro pausaria a fila do provedor e derrubaria o recebimento de toda a receita.';

ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;

-- Nenhum papel de usuário lê este livro: ele carrega o payload cru do gateway.
-- Master vê pelo painel; o resto é serviço.
CREATE POLICY payment_webhook_events_service_or_master
  ON public.payment_webhook_events
  FOR ALL
  USING (
    ((current_setting('request.jwt.claims', true))::jsonb ->> 'role') = 'service_role'
    OR (SELECT public.is_master_user())
  )
  WITH CHECK (
    ((current_setting('request.jwt.claims', true))::jsonb ->> 'role') = 'service_role'
    OR (SELECT public.is_master_user())
  );

REVOKE ALL ON public.payment_webhook_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.payment_webhook_events TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Livro de resgates de cupom
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coupon_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id uuid NOT NULL REFERENCES public.coupons(id) ON DELETE RESTRICT,
  -- O id da cobrança no gateway. É por pagamento que o cupom se consome — não
  -- por sessão, não por clique no link.
  payment_id text NOT NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  -- Quanto o cupom tirou NAQUELE pagamento. Snapshot: mudar o cupom depois não
  -- reescreve a história.
  discount_applied_cents integer,
  redeemed_at timestamptz NOT NULL DEFAULT now()
);

-- Consumir é INSERIR, e a segunda inserção do mesmo pagamento é recusada pelo
-- BANCO. É isto que torna a re-entrega inofensiva sem nenhum `IF` no handler.
CREATE UNIQUE INDEX IF NOT EXISTS coupon_redemptions_coupon_payment_key
  ON public.coupon_redemptions (coupon_id, payment_id);

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon
  ON public.coupon_redemptions (coupon_id, redeemed_at DESC);

COMMENT ON TABLE public.coupon_redemptions IS
  'Livro de resgates. A verdade sobre uso de cupom mora aqui; coupons.current_uses passa a ser projeção. UNIQUE(coupon_id, payment_id) faz o consumo ser idempotente por construção. Responde QUEM, QUANDO e EM QUAL pagamento — que é o que um contador nunca respondeu.';

ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY coupon_redemptions_service_or_master
  ON public.coupon_redemptions
  FOR ALL
  USING (
    ((current_setting('request.jwt.claims', true))::jsonb ->> 'role') = 'service_role'
    OR (SELECT public.is_master_user())
  )
  WITH CHECK (
    ((current_setting('request.jwt.claims', true))::jsonb ->> 'role') = 'service_role'
    OR (SELECT public.is_master_user())
  );

REVOKE ALL ON public.coupon_redemptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.coupon_redemptions TO service_role;

-- ---------------------------------------------------------------------------
-- 3. `increment_coupon_uses` sai do alcance do navegador
-- ---------------------------------------------------------------------------
-- Uma assinatura só, medida no catálogo: `increment_coupon_uses(uuid)`. A
-- `(text, text)` é de `validate_coupon`, que é outra função — STABLE, de
-- leitura, e que o checkout chama antes de pagar. Ela NÃO é tocada aqui:
-- validar é leitura e o cliente valida sem pagar.
REVOKE ALL ON FUNCTION public.increment_coupon_uses(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_coupon_uses(uuid) TO service_role;

COMMENT ON FUNCTION public.increment_coupon_uses(uuid) IS
  'Projeção do contador de usos. A VERDADE é coupon_redemptions (SCRUM-287). service_role apenas: com EXECUTE para authenticated, qualquer usuário logado queimava uso de cupom alheio pelo PostgREST.';

-- ---------------------------------------------------------------------------
-- 4. A assinatura ganha PROVENIÊNCIA — mas a idempotência dela já existia
-- ---------------------------------------------------------------------------
-- MEDIDO ANTES DE ESCREVER, e mudou o desenho: `org_subscriptions` já tem
--   CREATE UNIQUE INDEX org_subscriptions_one_current_per_org
--     ON org_subscriptions (organization_id) WHERE cancelled_at IS NULL
-- ou seja, o schema PROÍBE duas assinaturas vivas para a mesma organização.
--
-- Consequência para esta fatia: o webhook NÃO pode inserir uma linha por ciclo
-- pago — a segunda seria recusada pelo banco. O modelo aqui é UMA assinatura
-- corrente por organização, e a renovação ATUALIZA essa linha. O livro de "o
-- que já foi pago" é `payment_history`, não `org_subscriptions`.
--
-- Então a garantia contra duplicar não precisa de chave nova: ela é o índice
-- que já existe, e o handler escreve com ON CONFLICT sobre ele. Continua sendo
-- o BANCO decidindo, não um `IF` — que era o ponto.
--
-- O que falta é PROVENIÊNCIA: qual cobrança pagou a assinatura corrente. Sem
-- isso, "esta organização está ativa por causa de qual pagamento?" não tem
-- resposta, e é a primeira pergunta de qualquer disputa de cobrança.
ALTER TABLE public.org_subscriptions
  ADD COLUMN IF NOT EXISTS provider_payment_id text;

COMMENT ON COLUMN public.org_subscriptions.provider_payment_id IS
  'Id da cobrança no gateway que pagou o ciclo CORRENTE desta assinatura. Proveniência, não chave: a unicidade já é garantida por org_subscriptions_one_current_per_org (uma assinatura viva por organização). NULO em linha criada por outro caminho.';

-- ---------------------------------------------------------------------------
-- 5. A escrita da assinatura vira RPC — porque o PostgREST não sabe dizer WHERE
-- ---------------------------------------------------------------------------
-- `org_subscriptions_one_current_per_org` é UNIQUE (organization_id) WHERE
-- cancelled_at IS NULL. Postgres SÓ infere índice parcial no ON CONFLICT se o
-- comando REPETIR o predicado — provado em transação revertida:
--
--   ON CONFLICT (organization_id)                            -> 42P10
--   ON CONFLICT (organization_id) WHERE cancelled_at IS NULL -> infere
--
-- E o PostgREST não expressa predicado: `on_conflict` aceita nome de coluna,
-- não cláusula WHERE. Escrever a assinatura pelo cliente estouraria 42P10 em
-- TODA chamada — e como o webhook engole erro e responde 200 (a fila do
-- provedor pausa em 15 falhas), a organização nunca seria ativada, EM SILÊNCIO.
-- O modo de falha contra o qual a fatia foi desenhada, entrando pelo argumento
-- de uma chamada.
--
-- Então o comando mora aqui, onde o predicado cabe. A garantia continua sendo
-- do BANCO e não de um `IF`; só muda de onde é chamada.
CREATE OR REPLACE FUNCTION public.billing_apply_paid_subscription(
  p_organization_id       uuid,
  p_plan_id               uuid,
  p_billing_cycle         text,
  p_payment_method        text,
  p_provider_payment_id   text,
  p_seats                 integer DEFAULT 1,
  p_base_amount_cents     integer DEFAULT 0,
  p_discount_amount_cents integer DEFAULT 0,
  p_final_amount_cents    integer DEFAULT 0,
  p_cycle_discount_pct    numeric DEFAULT 0,
  p_coupon_discount_pct   numeric DEFAULT 0,
  p_manual_discount_cents integer DEFAULT 0,
  p_coupon_id             uuid    DEFAULT NULL,
  p_provider              text    DEFAULT 'asaas'
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_id uuid;
  v_role text := coalesce(
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role'), '');
BEGIN
  -- Gate no CORPO, não só no GRANT. O GRANT é a primeira linha e está medido no
  -- pgTAP; isto é a segunda, para o dia em que um DROP + CREATE devolver EXECUTE
  -- a PUBLIC — que já aconteceu neste repositório.
  IF v_role <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'access_denied: billing_apply_paid_subscription é só do serviço'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.org_subscriptions (
    organization_id, plan_id, billing_cycle, payment_method, user_count,
    base_amount_cents, discount_amount_cents, final_amount_cents,
    cycle_discount_pct, coupon_discount_pct, manual_discount_cents,
    coupon_id, provider, provider_payment_id, updated_at
  ) VALUES (
    p_organization_id, p_plan_id, p_billing_cycle, p_payment_method, greatest(p_seats, 1),
    -- `final <= base` é CHECK da tabela; o piso evita gravar par impossível se
    -- o motor de preço mudar.
    greatest(p_base_amount_cents, p_final_amount_cents), p_discount_amount_cents, p_final_amount_cents,
    p_cycle_discount_pct, p_coupon_discount_pct, p_manual_discount_cents,
    p_coupon_id, p_provider, p_provider_payment_id, now()
  )
  ON CONFLICT (organization_id) WHERE cancelled_at IS NULL
  DO UPDATE SET
    plan_id               = EXCLUDED.plan_id,
    billing_cycle         = EXCLUDED.billing_cycle,
    payment_method        = EXCLUDED.payment_method,
    user_count            = EXCLUDED.user_count,
    base_amount_cents     = EXCLUDED.base_amount_cents,
    discount_amount_cents = EXCLUDED.discount_amount_cents,
    final_amount_cents    = EXCLUDED.final_amount_cents,
    cycle_discount_pct    = EXCLUDED.cycle_discount_pct,
    coupon_discount_pct   = EXCLUDED.coupon_discount_pct,
    manual_discount_cents = EXCLUDED.manual_discount_cents,
    coupon_id             = EXCLUDED.coupon_id,
    provider              = EXCLUDED.provider,
    provider_payment_id   = EXCLUDED.provider_payment_id,
    updated_at            = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.billing_apply_paid_subscription IS
  'Escreve a assinatura corrente da organização a partir de um pagamento confirmado. Existe como RPC porque o ON CONFLICT precisa REPETIR o predicado do índice parcial (WHERE cancelled_at IS NULL) e o PostgREST não expressa predicado — pelo cliente, a escrita estouraria 42P10 em toda chamada. Só service_role.';

REVOKE ALL ON FUNCTION public.billing_apply_paid_subscription(
  uuid, uuid, text, text, text, integer, integer, integer, integer, numeric, numeric, integer, uuid, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.billing_apply_paid_subscription(
  uuid, uuid, text, text, text, integer, integer, integer, integer, numeric, numeric, integer, uuid, text
) TO service_role;
