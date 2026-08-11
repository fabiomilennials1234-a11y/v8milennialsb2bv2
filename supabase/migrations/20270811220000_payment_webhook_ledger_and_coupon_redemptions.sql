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
