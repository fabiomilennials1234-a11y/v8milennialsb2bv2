-- 20270302000030_sale_events.sql
--
-- Issue #993 · PRD #986 · ADR-0017 §2-4 — caderno append-only de VENDA.
-- Toda entrada de lead em stage `won`/`lost` (e toda SAÍDA de `won`) vira
-- linha IMUTÁVEL aqui, com snapshot de valor, atribuição e Revenue Stream.
-- Receita (SP-3) lê SÓ deste caderno, líquida de estornos — mata R4/R5/R6
-- da auditoria 2026-07-02 e a segunda superfície de receita da Carteira.
--
-- PONTO DE CAPTURA (decisão): AFTER INSERT em `pipeline_stage_events`,
-- NÃO direto em `pipeline_entries`. Porquê:
--   · O caderno de etapa (#992) já é, por construção e por pgTAP, EXATAMENTE
--     1 linha por transição real (INSERT + UPDATE OF stage_key com WHEN),
--     cobrindo 100% dos caminhos de escrita (kanban, compat views, custom
--     sync, RPCs bulk, workflows, webhooks). Encadear aqui herda essa
--     garantia: venda sem evento de etapa é impossível, e a reconciliação
--     won/lost entre os dois cadernos é trivial (join por stage_event_id).
--   · Caminho de escrita futuro em pipeline_entries ganha captura de venda
--     de graça — 1 choke point, não 2.
--   · WHEN (NEW.source = 'trigger'): só captura ao vivo. Eventos de
--     backfill de etapa (reconstrução histórica) NÃO fabricam venda —
--     backfill de venda, se existir, é migration própria e governada.
--
-- SEMÂNTICA (roles via stage_role, #990; resolução em metric_stage_role()):
--   · entrada em role `won`  (from_role ≠ won)  → event_type = 'sale'
--   · entrada em role `lost` (from_role ≠ lost) → event_type = 'sale_lost'
--   · SAÍDA de `won` (from_role = won, to_role ≠ won) → 'sale_reversed'
--     referenciando a venda mais recente NÃO-estornada do lead+pipeline.
--     won→lost emite AMBOS (estorno + perda), nesta ordem — os dois fatos
--     são verdadeiros. won→won / lost→lost não emitem nada (mesma venda /
--     mesma perda; mover entre dois stages de mesmo role não é fato novo).
--   · Saída de won SEM venda registrada (won alcançado antes deste caderno
--     existir) → nenhum estorno: não há o que anular na leitura. Limitação
--     declarada da janela pré-caderno (ADR-0017 §7).
--
-- REVENUE STREAM (ADR-0017 §2): decidido PELO CLIENTE, nunca pelo funil.
--   Lead com Carteira Client ATIVO (upsell_clients.is_active) no momento da
--   venda → 'carteira'; senão → 'novo_negocio'. Vale mesmo vendendo pelo
--   funil normal de propostas (user story 7 do PRD). Um caderno só; total
--   = soma dos streams por construção.
--
-- SOLD_AT (ADR-0017 §4): momento do REGISTRO, sempre. now() no write, nunca
--   informável por caller: (1) zero grants de INSERT — o único writer é o
--   trigger definer; (2) o trigger grava now() explicitamente; (3) trigger
--   BEFORE INSERT força NEW.sold_at := now() pra source='trigger' — até o
--   owner é normalizado. source='backfill' (migration governada futura)
--   é a única forma de carregar timestamp original, rotulada (§7).
--
-- ORIGEM DOS SNAPSHOTS (pesquisado, não presumido):
--   · sale_value/currency → pipeline_entries.metadata->>'sale_value' — é
--     onde o app grava o valor (usePipePropostas escreve metadata + stage
--     no MESMO UPDATE; compat view pipe_propostas expõe essa chave desde
--     20260941000000). leads não tem coluna de valor. Valor ausente/
--     malformado → NULL (honesto), nunca 0 — e nunca bloqueia a venda.
--   · Atribuição → leads.sale_responsible_id (Closer canônico; fallback
--     legado closer_id SÓ na transição, ADR-0017 §5) e
--     leads.pre_sale_responsible_id. Snapshot no evento; user deletado não
--     reescreve história → SEM FK (prior art: actor em #992/meeting_events).
--   · Estorno copia valor/moeda/stream/atribuição da venda original —
--     linha auto-suficiente pra leitura líquida por membro sem self-join.
--
-- FKs (decisões):
--   · organization_id → CASCADE (teardown de tenant, padrão do repo).
--   · lead_id → CASCADE (ADR-0017: lead hard-deletado não conta em métrica;
--     mesmo racional do #992). Nota: cliente de Carteira não sofre esse
--     cascade na prática — upsell_clients.lead_id é ON DELETE RESTRICT.
--   · pipeline_id → SEM FK, de propósito. Receita é verdade da ORG e
--     sobrevive à deleção do funil (#992 já prometia: "sale_events …
--     sobrevive independente"). FK CASCADE mataria histórico de receita;
--     SET NULL exigiria UPDATE — proibido pela imutabilidade.
--   · stage_event_id → SEM FK (soft reference, prior art entry_id do #992):
--     proveniência/reconciliação com o caderno de etapa. FK herdaria o
--     cascade de pipeline_id de lá — mesmo problema acima.
--   · reversed_event_id → FK self ON DELETE CASCADE: original e estorno são
--     do mesmo lead — caem juntos no único cascade legítimo.
--
-- Rollback: supabase/migrations/rollback/20270302000030_sale_events.sql
-- Testes:   supabase/tests/sale_events_test.sql (pgTAP, wired no run.sh)

-- ============================================================================
-- 1. Tabela
-- ============================================================================

CREATE TABLE public.sale_events (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id                 uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  pipeline_id             uuid NOT NULL,
  stage_key               text NOT NULL,
  stage_event_id          uuid,
  event_type              text NOT NULL
                            CONSTRAINT sale_events_event_type_check
                            CHECK (event_type IN ('sale', 'sale_reversed', 'sale_lost')),
  reversed_event_id       uuid REFERENCES public.sale_events(id) ON DELETE CASCADE,
  sold_at                 timestamptz NOT NULL DEFAULT now(),
  sale_value              numeric,
  currency                text NOT NULL DEFAULT 'BRL'
                            CONSTRAINT sale_events_currency_check
                            CHECK (currency ~ '^[A-Z]{3}$'),
  revenue_stream          text NOT NULL
                            CONSTRAINT sale_events_revenue_stream_check
                            CHECK (revenue_stream IN ('novo_negocio', 'carteira')),
  sale_responsible_id     uuid,
  pre_sale_responsible_id uuid,
  actor                   uuid,
  source                  text NOT NULL DEFAULT 'trigger'
                            CONSTRAINT sale_events_source_check
                            CHECK (source IN ('trigger', 'backfill')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  -- Coerência estorno ⟷ referência: sale_reversed EXIGE reversed_event_id;
  -- sale/sale_lost NÃO PODEM ter (igualdade booleana cobre as duas direções).
  CONSTRAINT sale_events_reversal_coherence
    CHECK ((event_type = 'sale_reversed') = (reversed_event_id IS NOT NULL)),
  CONSTRAINT sale_events_value_non_negative
    CHECK (sale_value IS NULL OR sale_value >= 0)
);

COMMENT ON TABLE public.sale_events IS
  'ADR-0017 §2-4 / #993 — caderno append-only de vendas. Fonte ÚNICA de '
  'receita (SP-3), líquida de estornos (sale + sale_reversed se anulam). '
  'Nunca sofre UPDATE/DELETE (trigger de imutabilidade); correção = evento novo.';
COMMENT ON COLUMN public.sale_events.sold_at IS
  'Âncora temporal canônica da venda = momento do REGISTRO (ADR-0017 §4). '
  'now() no write, jamais informável por caller (normalizado por trigger '
  'BEFORE INSERT pra source=trigger). Sexta vendida registrada segunda conta segunda.';
COMMENT ON COLUMN public.sale_events.revenue_stream IS
  'ADR-0017 §2 — decidido pelo CLIENTE no momento da venda (Carteira Client '
  'ativo → carteira; senão novo_negocio), nunca pelo funil. Total = soma dos streams.';
COMMENT ON COLUMN public.sale_events.reversed_event_id IS
  'Venda original anulada por este sale_reversed. Par se anula em toda '
  'leitura (período original restaurado via join). FK self CASCADE: caem '
  'juntos no cascade de lead.';
COMMENT ON COLUMN public.sale_events.sale_value IS
  'Snapshot de pipeline_entries.metadata->>sale_value no momento da venda. '
  'NULL = valor desconhecido (nunca 0 fabricado). Estorno copia o valor da original.';
COMMENT ON COLUMN public.sale_events.sale_responsible_id IS
  'Snapshot do Closer canônico (leads.sale_responsible_id; fallback legado '
  'closer_id só na transição, ADR-0017 §5). SEM FK: user deletado não reescreve história.';
COMMENT ON COLUMN public.sale_events.pre_sale_responsible_id IS
  'Snapshot do SDR canônico (leads.pre_sale_responsible_id). SEM FK, mesmo racional.';
COMMENT ON COLUMN public.sale_events.pipeline_id IS
  'SEM FK, de propósito: receita é verdade da org e sobrevive à deleção do funil.';
COMMENT ON COLUMN public.sale_events.stage_event_id IS
  'Soft reference (sem FK) pro pipeline_stage_events que originou o evento — '
  'proveniência e reconciliação entre cadernos. Prior art: entry_id no #992.';

-- Índices pros padrões de leitura do SP-3 e pros joins internos do trigger:
--   receita por org+período (com e sem recorte de stream), timeline por lead,
--   busca da venda não-estornada (estorno) e anti-join de estornos.
CREATE INDEX idx_sale_events_org_sold
  ON public.sale_events (organization_id, sold_at);
CREATE INDEX idx_sale_events_org_stream_sold
  ON public.sale_events (organization_id, revenue_stream, sold_at);
CREATE INDEX idx_sale_events_lead
  ON public.sale_events (lead_id, sold_at DESC);
CREATE INDEX idx_sale_events_open_sale
  ON public.sale_events (lead_id, pipeline_id, sold_at DESC)
  WHERE event_type = 'sale';
CREATE INDEX idx_sale_events_reversed
  ON public.sale_events (reversed_event_id)
  WHERE reversed_event_id IS NOT NULL;

-- ============================================================================
-- 2. RLS — leitura tenant-scoped; escrita SÓ via trigger definer
-- ============================================================================
-- get_my_organization_ids() é SECURITY DEFINER (nunca team_members inline em
-- policy — recursão no apply_rls() do Realtime; gotcha do CLAUDE.md raiz).
-- ZERO policies de escrita: o caminho de escrita é o trigger definer.

ALTER TABLE public.sale_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY sale_events_select ON public.sale_events
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

-- ============================================================================
-- 3. Grants — UPDATE/DELETE/INSERT revogados de TODOS os roles
-- ============================================================================
REVOKE ALL ON public.sale_events FROM PUBLIC;
REVOKE ALL ON public.sale_events FROM anon;
REVOKE ALL ON public.sale_events FROM authenticated;
REVOKE ALL ON public.sale_events FROM service_role;

GRANT SELECT ON public.sale_events TO authenticated;
GRANT SELECT ON public.sale_events TO service_role;
-- Nenhum INSERT grant: append é exclusividade do trigger definer + migrations.

-- ============================================================================
-- 4. Imutabilidade — RAISE em UPDATE/DELETE, inclusive owner/service_role
-- ============================================================================
-- Mesmo padrão 2 camadas do #992: REVOKE (42501 pra roles) + trigger BEFORE
-- (P0001 até pra owner). DELETE só passa dentro de cascade de FK — detecção:
-- alguma entidade-mãe (org/lead) já não existe. pipeline NÃO é mãe aqui
-- (sem FK; receita sobrevive ao funil).

CREATE FUNCTION public.fn_sale_events_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'sale_events é append-only (ADR-0017): UPDATE proibido — corrija com evento novo (estorno + venda nova)'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.leads         WHERE id = OLD.lead_id)
     AND EXISTS (SELECT 1 FROM public.organizations WHERE id = OLD.organization_id) THEN
    RAISE EXCEPTION 'sale_events é append-only (ADR-0017): DELETE proibido — eventos só caem em cascade de lead/org'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN OLD;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_sale_events_block_mutation() FROM PUBLIC;

CREATE TRIGGER trg_sale_events_immutable
  BEFORE UPDATE OR DELETE ON public.sale_events
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sale_events_block_mutation();

-- ============================================================================
-- 5. sold_at à prova de adulteração — normalizador BEFORE INSERT
-- ============================================================================
-- Cinto extra sobre "zero grants": mesmo um INSERT de owner/migration com
-- sold_at forjado é normalizado pra now() quando source='trigger'. Só
-- source='backfill' (migration governada, rotulada §7) carrega timestamp
-- original.

CREATE FUNCTION public.fn_sale_events_force_sold_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.source = 'trigger' THEN
    NEW.sold_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sale_events_force_sold_at
  BEFORE INSERT ON public.sale_events
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sale_events_force_sold_at();

-- ============================================================================
-- 6. Resolução de role — fonte única pro trigger de captura
-- ============================================================================
-- (org, pipeline_id, stage_key) → stage_role via pipelines.slug →
-- pipeline_stages (UNIQUE organization_id+pipeline_type+stage_key desde
-- 20260124180000). Governança de role hoje vive SÓ em pipeline_stages
-- (#990/#991); custom_pipeline_stages ainda não tem stage_role → funil
-- custom resolve NULL (≙ open) e não emite venda ATÉ a governança chegar lá
-- — limitação declarada; quando chegar, ESTA função é o único ponto a
-- estender. STABLE (lê catálogo), não IMMUTABLE.

CREATE FUNCTION public.metric_stage_role(
  p_organization_id uuid,
  p_pipeline_id     uuid,
  p_stage_key       text
)
RETURNS public.stage_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ps.stage_role
  FROM public.pipelines p
  JOIN public.pipeline_stages ps
    ON ps.organization_id = p.organization_id
   AND ps.pipeline_type   = p.slug
   AND ps.stage_key       = p_stage_key
  WHERE p.id = p_pipeline_id
    AND p.organization_id = p_organization_id
    AND p_stage_key IS NOT NULL
$$;

REVOKE EXECUTE ON FUNCTION public.metric_stage_role(uuid, uuid, text) FROM PUBLIC;

COMMENT ON FUNCTION public.metric_stage_role(uuid, uuid, text) IS
  'ADR-0017 §1 / #993 — resolve o stage_role governado de (org, pipeline, '
  'stage_key) via pipelines.slug → pipeline_stages. NULL = sem governança '
  '(custom_pipeline_stages ainda sem role) ≙ open. Ponto único de extensão.';

-- ============================================================================
-- 7. Captura — pipeline_stage_events → sale_events
-- ============================================================================
-- Encadeado no caderno de etapa (racional no cabeçalho). SEM catch de
-- exceção no INSERT do evento, de propósito (#992): caderno falhou →
-- movimentação falha junto. Única exceção deliberada: parse do sale_value
-- (metadata é jsonb livre; valor malformado vira NULL, nunca bloqueia venda
-- nem fabrica número).

CREATE FUNCTION public.fn_capture_sale_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from_role  public.stage_role;
  v_to_role    public.stage_role;
  v_meta       jsonb;
  v_sale_value numeric;
  v_currency   text;
  v_sale_resp  uuid;
  v_pre_resp   uuid;
  v_stream     text;
  v_original   public.sale_events%ROWTYPE;
BEGIN
  v_from_role := public.metric_stage_role(NEW.organization_id, NEW.pipeline_id, NEW.from_stage_key);
  v_to_role   := public.metric_stage_role(NEW.organization_id, NEW.pipeline_id, NEW.to_stage_key);

  -- Fast path: transição sem semântica de venda (a esmagadora maioria).
  IF v_from_role IS DISTINCT FROM 'won'
     AND v_to_role IS DISTINCT FROM 'won'
     AND v_to_role IS DISTINCT FROM 'lost' THEN
    RETURN NEW;
  END IF;

  -- ── Estorno: saiu de won pra role ≠ won ────────────────────────────────
  IF v_from_role = 'won' AND v_to_role IS DISTINCT FROM 'won' THEN
    SELECT s.* INTO v_original
    FROM public.sale_events s
    WHERE s.lead_id     = NEW.lead_id
      AND s.pipeline_id = NEW.pipeline_id
      AND s.event_type  = 'sale'
      AND NOT EXISTS (
        SELECT 1 FROM public.sale_events r
        WHERE r.event_type = 'sale_reversed'
          AND r.reversed_event_id = s.id
      )
    ORDER BY s.sold_at DESC, s.created_at DESC
    LIMIT 1;

    IF FOUND THEN
      -- Copia valor/moeda/stream/atribuição da original: estorno anula
      -- exatamente o que foi contado, inclusive por membro e por stream.
      INSERT INTO public.sale_events
        (organization_id, lead_id, pipeline_id, stage_key, stage_event_id,
         event_type, reversed_event_id, sold_at, sale_value, currency,
         revenue_stream, sale_responsible_id, pre_sale_responsible_id,
         actor, source)
      VALUES
        (NEW.organization_id, NEW.lead_id, NEW.pipeline_id, NEW.to_stage_key,
         NEW.id, 'sale_reversed', v_original.id, now(),
         v_original.sale_value, v_original.currency, v_original.revenue_stream,
         v_original.sale_responsible_id, v_original.pre_sale_responsible_id,
         NEW.actor, 'trigger');
    END IF;
    -- Sem venda não-estornada (won pré-caderno): nada a anular, segue.
  END IF;

  -- ── Venda / perda: snapshot comum ──────────────────────────────────────
  IF (v_to_role = 'won' AND v_from_role IS DISTINCT FROM 'won')
     OR (v_to_role = 'lost' AND v_from_role IS DISTINCT FROM 'lost') THEN

    -- Valor: metadata da entry no momento da transição (mesmo UPDATE que
    -- moveu o stage). entry_id do evento ao vivo sempre aponta a entry.
    SELECT pe.metadata INTO v_meta
    FROM public.pipeline_entries pe
    WHERE pe.id = NEW.entry_id;

    BEGIN
      v_sale_value := NULLIF(v_meta->>'sale_value', '')::numeric;
    EXCEPTION WHEN OTHERS THEN
      v_sale_value := NULL;  -- malformado = desconhecido, nunca 0/bloqueio
    END;
    v_currency := COALESCE(NULLIF(upper(v_meta->>'currency'), ''), 'BRL');
    IF v_currency !~ '^[A-Z]{3}$' THEN
      v_currency := 'BRL';
    END IF;

    -- Atribuição canônica: snapshot do lead no momento da venda.
    SELECT COALESCE(l.sale_responsible_id, l.closer_id), -- metric-lint-allow: fallback legado closer_id sancionado SÓ na transição (ADR-0017 §5)
           l.pre_sale_responsible_id
      INTO v_sale_resp, v_pre_resp
    FROM public.leads l
    WHERE l.id = NEW.lead_id
      AND l.organization_id = NEW.organization_id;

    -- Revenue Stream: decidido pelo CLIENTE (ADR-0017 §2), nunca pelo funil.
    v_stream := CASE WHEN EXISTS (
        SELECT 1 FROM public.upsell_clients uc
        WHERE uc.organization_id = NEW.organization_id
          AND uc.lead_id = NEW.lead_id
          AND uc.is_active
      ) THEN 'carteira' ELSE 'novo_negocio' END;

    INSERT INTO public.sale_events
      (organization_id, lead_id, pipeline_id, stage_key, stage_event_id,
       event_type, reversed_event_id, sold_at, sale_value, currency,
       revenue_stream, sale_responsible_id, pre_sale_responsible_id,
       actor, source)
    VALUES
      (NEW.organization_id, NEW.lead_id, NEW.pipeline_id, NEW.to_stage_key,
       NEW.id,
       CASE WHEN v_to_role = 'won' THEN 'sale' ELSE 'sale_lost' END,
       NULL, now(), v_sale_value, v_currency, v_stream,
       v_sale_resp, v_pre_resp, NEW.actor, 'trigger');
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_capture_sale_event() FROM PUBLIC;

COMMENT ON FUNCTION public.fn_capture_sale_event() IS
  'ADR-0017 §2-4 / #993 — deriva sale/sale_lost/sale_reversed de cada evento '
  'ao vivo do caderno de etapa, com snapshot de valor (entry metadata), '
  'atribuição (lead) e Revenue Stream (Carteira Client ativo).';

CREATE TRIGGER trg_pipeline_stage_events_sale_capture
  AFTER INSERT ON public.pipeline_stage_events
  FOR EACH ROW
  WHEN (NEW.source = 'trigger')
  EXECUTE FUNCTION public.fn_capture_sale_event();

-- ============================================================================
-- 8. Backfill — NÃO (deliberado)
-- ============================================================================
-- Venda histórica não é reconstruível com honestidade: sold_at seria fake
-- (ADR-0017 §4), valor/atribuição mudaram desde então e o estado mutável
-- não guarda a transição. O caderno conta a partir daqui; reconciliação
-- SP-3 compara motores no período pós-caderno. Se um backfill de venda for
-- decidido, será migration própria com source='backfill' e delta explicado
-- (ADR-0017 §7-8).
