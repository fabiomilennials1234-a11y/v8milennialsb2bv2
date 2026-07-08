-- 20270302000040_commission_projection.sql
--
-- Issue #994 · PRD #986 · ADR-0017 §6 — comissão como PROJEÇÃO de sale_events.
-- "Commission is a projection of sale_events via trigger — ledger equals
--  metric by construction."
--
-- O QUE MUDA: cada evento do caderno de venda (#993) projeta automaticamente
-- uma linha em `commissions` pro Closer do snapshot. sale → linha positiva;
-- sale_reversed → linha NEGATIVA espelhando a original; sale_lost → nada.
-- O cálculo antigo (on-the-fly em useCommissionSummary, base × taxa do
-- team_member) permanece VIVO e intocado até o portão de reconciliação
-- do SP-3 (ADR-0017 §8) — projeção e cálculo convivem em paralelo.
--
-- REGRA DE CÁLCULO (pesquisada, não presumida — espelho exato do vigente,
-- src/modules/engagement/hooks/useCommissions.ts::useCommissionSummary):
--   · base  = sale_value da venda (sale_events.sale_value; NULL → 0, o
--     cálculo vigente também trata valor ausente como 0 via `Number(x)||0`)
--   · taxa  = team_members.commission_mrr_percent     se product_type='mrr'
--             team_members.commission_projeto_percent se product_type='projeto'
--     com os MESMOS defaults do vigente quando NULL: 1.0 e 0.5
--   · product_type = pipeline_entries.metadata->>'product_type' (é onde a
--     compat view pipe_propostas lê desde 20260941000000); ausente/inválido
--     → 'mrr' (o vigente faz `sale.product_type ?? "mrr"`)
--   · amount = round(base × taxa / 100, 2)
--   · TAXA SNAPSHOTADA na linha (rate_percent + amount materializado no
--     momento do evento). Mudar a taxa do membro depois NÃO reescreve
--     comissão já projetada; a taxa nova só vale pra vendas novas.
--   · month/year = sold_at cortado no TIMEZONE DA ORG (ADR-0017 §5,
--     organizations.timezone) — nunca UTC do client.
--
-- ATRIBUIÇÃO: exclusivamente sale_events.sale_responsible_id — snapshot do
--   Closer feito pelo caderno no momento da venda (fallback legado closer_id
--   já resolvido LÁ, na transição; aqui NENHUM COALESCE de chaves, ADR-0017
--   R5). Venda sem Closer no snapshot → nenhuma comissão (o vigente também
--   não credita ninguém: filtra por sale_responsible_id).
--
-- ESTORNO (formato escolhido: LINHA NEGATIVA, não status):
--   · O schema de commissions não tem coluna de status de estorno e `amount`
--     aceita negativo — linha negativa preserva o padrão append do caderno
--     (par se anula na leitura) e soma líquida por período sai por SUM puro.
--   · month/year do estorno = OS DA COMISSÃO ORIGINAL (ADR-0017 §3: "the
--     pair annuls in every read — original period restored"). Comissão é
--     projeção da métrica, não folha de pagamento; clawback operacional é
--     assunto do flag `paid`, não do período.
--   · Copia team_member/type/rate/amount(negado)/pipe_proposta da original.
--   · Estorno de venda SEM comissão projetada (venda pré-#994, ou venda sem
--     Closer) → nada a anular, não fabrica linha.
--
-- IDEMPOTÊNCIA / RASTREABILIDADE:
--   · commissions.sale_event_id UNIQUE + FK → sale_events(id): 1 evento ⇒
--     no máximo 1 linha projetada, pra sempre (ON CONFLICT DO NOTHING).
--     venda→estorno→re-venda = 3 eventos = 3 linhas rastreáveis 1:1.
--   · FK ON DELETE CASCADE: lead hard-deletado derruba sale_events (decisão
--     do #993) e as projeções caem juntas — não conta em métrica.
--
-- DUPLA CONTAGEM NA UI (protegido):
--   · A página Comissões (Comissoes.tsx) soma linhas cruas de `commissions`
--     nos tiles "Total Pago"/"A Pagar" (useCommissions). Linhas projetadas
--     ali somariam EM DOBRO com o cálculo on-the-fly dos cards.
--   · Escolha (sancionada na issue): coluna `source` discrimina
--     'manual' | 'sale_event_projection'; os hooks de leitura atuais filtram
--     source='manual' — a projeção fica INVISÍVEL pra UI até o SP-3 religar
--     a leitura no caderno. Reconciliação lê source='sale_event_projection'.
--
-- ANTI-SPOOF (linha projetada é métrica, precisa ser confiável):
--   · CHECK de coerência: source='sale_event_projection' ⟺ sale_event_id
--     preenchido (nas duas direções).
--   · Grants por COLUNA: INSERT/UPDATE de authenticated/service_role deixam
--     de ser table-level e passam a listar só as colunas do fluxo manual
--     vigente — ninguém fora do trigger definer escreve source/sale_event_id/
--     rate_percent (42501). O fluxo manual atual continua idêntico (defaults
--     cobrem as colunas novas).
--   · Trigger guard: linha projetada aceita UPDATE só do flag `paid`
--     (operacional); resto é imutável (P0001) — correção = estorno + venda
--     nova no caderno, nunca edição da projeção. DELETE de projeção só em
--     cascade real (padrão #992/#993: detecta pai vivo).
--
-- BACKFILL: eventos source='backfill' NÃO projetam (WHEN do trigger).
--   Comissões pré-caderno já existem no fluxo manual; migration governada
--   de backfill (se vier, ADR-0017 §7) decide o próprio tratamento.
--
-- Rollback: supabase/migrations/rollback/20270302000040_commission_projection.sql
-- Testes:   supabase/tests/commission_projection_test.sql (pgTAP, wired no run.sh)
-- Reconciliação (portão SP-3): scripts/reconcile-commission-997.sql (instância
--   do motor genérico scripts/reconcile-metrics.sql, via scripts/reconcile-metrics.sh)

-- ============================================================================
-- 1. Colunas novas em commissions
-- ============================================================================

ALTER TABLE public.commissions
  ADD COLUMN IF NOT EXISTS sale_event_id uuid
    REFERENCES public.sale_events(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
    CONSTRAINT commissions_source_check
    CHECK (source IN ('manual', 'sale_event_projection')),
  ADD COLUMN IF NOT EXISTS rate_percent numeric
    CONSTRAINT commissions_rate_percent_non_negative
    CHECK (rate_percent IS NULL OR rate_percent >= 0);

-- 1 evento ⇒ no máximo 1 projeção, pra sempre. (UNIQUE permite N NULLs —
-- linhas manuais não participam.)
ALTER TABLE public.commissions
  ADD CONSTRAINT commissions_sale_event_id_key UNIQUE (sale_event_id);

-- Coerência: projeção ⟺ evento (as duas direções, igualdade booleana).
-- Linhas manuais existentes: (false)=(false) ✓ — CHECK valida sem rewrite.
ALTER TABLE public.commissions
  ADD CONSTRAINT commissions_projection_coherence
  CHECK ((source = 'sale_event_projection') = (sale_event_id IS NOT NULL));

COMMENT ON COLUMN public.commissions.sale_event_id IS
  'ADR-0017 §6 / #994 — evento de sale_events que projetou esta linha. UNIQUE '
  '(idempotência: mesmo evento nunca projeta 2×). FK CASCADE: cai junto com o '
  'evento no único delete legítimo (cascade de lead/org). NULL = linha manual.';
COMMENT ON COLUMN public.commissions.source IS
  '#994 — ''manual'' (fluxo vigente, UI) | ''sale_event_projection'' (projetada '
  'do caderno). Hooks atuais filtram manual; projeção invisível pra UI até SP-3.';
COMMENT ON COLUMN public.commissions.rate_percent IS
  '#994 — SNAPSHOT da taxa (%) usada no momento do evento (commission_mrr_percent '
  'ou commission_projeto_percent do team_member, conforme product_type). Mudar a '
  'taxa do membro depois não reescreve projeção. NULL em linhas manuais.';

-- Padrão de leitura da reconciliação e do SP-3: projeções por org+período.
CREATE INDEX idx_commissions_projection_org_period
  ON public.commissions (organization_id, year, month)
  WHERE source = 'sale_event_projection';

-- ============================================================================
-- 2. Grants por coluna — colunas de projeção fora do alcance de client roles
-- ============================================================================
-- Antes: grant table-level (era Supabase default). Agora: INSERT/UPDATE listam
-- exatamente as colunas do fluxo manual vigente (useCreateCommission/
-- useUpdateCommission) — comportamento do fluxo atual inalterado; escrever
-- source/sale_event_id/rate_percent fora do trigger definer → 42501.
-- SELECT/DELETE seguem table-level como estavam (RLS continua mandando).

REVOKE INSERT, UPDATE ON public.commissions FROM anon;
REVOKE INSERT, UPDATE ON public.commissions FROM authenticated;
REVOKE INSERT, UPDATE ON public.commissions FROM service_role;

GRANT INSERT (id, organization_id, team_member_id, pipe_proposta_id,
              amount, type, month, year, paid, created_at),
      UPDATE (organization_id, team_member_id, pipe_proposta_id,
              amount, type, month, year, paid)
  ON public.commissions TO authenticated, service_role;

-- ============================================================================
-- 3. Guard — linha projetada é (quase) imutável; paid é a única exceção
-- ============================================================================
-- Mesmo padrão 2 camadas dos cadernos (#992/#993), adaptado a tabela viva:
-- grants por coluna (42501 pra roles) + trigger BEFORE (P0001 até pra owner).
-- `paid` fica editável: é estado OPERACIONAL de pagamento, não métrica.
-- `source` é imutável em QUALQUER linha (manual não vira projeção, nem o
-- contrário). DELETE de projeção só passa em cascade real: detecção = o
-- evento pai já não existe (FK CASCADE em voo), padrão do #993.

CREATE FUNCTION public.fn_commissions_protect_projection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.source IS DISTINCT FROM OLD.source THEN
      RAISE EXCEPTION 'commissions.source é imutável (#994): linha manual não vira projeção nem o contrário'
        USING ERRCODE = 'P0001';
    END IF;

    IF OLD.source = 'sale_event_projection'
       AND (NEW.amount          IS DISTINCT FROM OLD.amount
         OR NEW.type            IS DISTINCT FROM OLD.type
         OR NEW.month           IS DISTINCT FROM OLD.month
         OR NEW.year            IS DISTINCT FROM OLD.year
         OR NEW.team_member_id  IS DISTINCT FROM OLD.team_member_id
         OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
         -- pipe_proposta_id: soft link de conveniência. PODE ir a NULL —
         -- é o RI ON DELETE SET NULL da FK quando a entry morre (sem essa
         -- exceção, deletar um lead com projeção abortaria no guard).
         -- Retargeting pra outra entry continua bloqueado.
         OR (NEW.pipe_proposta_id IS DISTINCT FROM OLD.pipe_proposta_id
             AND NEW.pipe_proposta_id IS NOT NULL)
         OR NEW.sale_event_id   IS DISTINCT FROM OLD.sale_event_id
         OR NEW.rate_percent    IS DISTINCT FROM OLD.rate_percent
         OR NEW.created_at      IS DISTINCT FROM OLD.created_at) THEN
      RAISE EXCEPTION 'comissão projetada é imutável exceto paid (ADR-0017 §6): corrija com estorno + venda nova no caderno'
        USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
  END IF;

  -- DELETE: projeção só cai em cascade legítimo. Detecção (padrão #992/#993):
  -- alguma entidade-mãe já não existe. Mães com FK CASCADE em commissions:
  -- sale_events (via lead/org), organizations e team_members — deletar um
  -- membro do time cascateia as comissões dele HOJE; o guard não pode
  -- quebrar esse fluxo vigente.
  IF OLD.source = 'sale_event_projection'
     AND EXISTS (SELECT 1 FROM public.sale_events   WHERE id = OLD.sale_event_id)
     AND EXISTS (SELECT 1 FROM public.organizations WHERE id = OLD.organization_id)
     AND EXISTS (SELECT 1 FROM public.team_members  WHERE id = OLD.team_member_id) THEN
    RAISE EXCEPTION 'comissão projetada não pode ser deletada (ADR-0017 §6): só cai em cascade de evento/org/membro'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN OLD;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_commissions_protect_projection() FROM PUBLIC;

CREATE TRIGGER trg_commissions_protect_projection
  BEFORE UPDATE OR DELETE ON public.commissions
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_commissions_protect_projection();

-- ============================================================================
-- 4. Projeção — sale_events → commissions
-- ============================================================================
-- SEM catch de exceção, de propósito (padrão #992/#993): projeção falhou →
-- a movimentação que gerou a venda falha junta — ledger e projeção nunca
-- divergem silenciosamente.

CREATE FUNCTION public.fn_project_commission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz          text;
  v_local       timestamp;      -- sold_at no relógio da org
  v_rate_mrr    numeric;
  v_rate_proj   numeric;
  v_rate        numeric;
  v_ptype_raw   text;
  v_ptype       public.product_type;
  v_entry_id    uuid;
  v_amount      numeric;
  v_original    public.commissions%ROWTYPE;
BEGIN
  -- Perda não comissiona nada.
  IF NEW.event_type = 'sale_lost' THEN
    RETURN NEW;
  END IF;

  -- ── Estorno: espelho negativo da comissão original ─────────────────────
  IF NEW.event_type = 'sale_reversed' THEN
    SELECT c.* INTO v_original
    FROM public.commissions c
    WHERE c.sale_event_id = NEW.reversed_event_id
      AND c.source = 'sale_event_projection';

    IF NOT FOUND THEN
      -- Venda pré-#994 ou venda sem Closer: nada projetado, nada a anular.
      RETURN NEW;
    END IF;

    -- month/year DA ORIGINAL: par se anula no período em que contou
    -- (ADR-0017 §3 — original period restored). Copia atribuição/taxa/tipo.
    INSERT INTO public.commissions
      (organization_id, team_member_id, pipe_proposta_id, amount, type,
       month, year, paid, sale_event_id, source, rate_percent)
    VALUES
      (v_original.organization_id, v_original.team_member_id,
       v_original.pipe_proposta_id, -v_original.amount, v_original.type,
       v_original.month, v_original.year, false,
       NEW.id, 'sale_event_projection', v_original.rate_percent)
    ON CONFLICT (sale_event_id) DO NOTHING;

    RETURN NEW;
  END IF;

  -- ── Venda ───────────────────────────────────────────────────────────────
  -- Atribuição: SÓ o snapshot do caderno. Sem Closer → sem comissão
  -- (o cálculo vigente também não credita ninguém).
  IF NEW.sale_responsible_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Taxa do membro NO MOMENTO DO EVENTO (snapshot). Membro já deletado /
  -- de outra org (snapshot stale) → FK de commissions nem aceitaria: skip
  -- honesto, mesmo resultado do vigente (member lookup falharia).
  SELECT tm.commission_mrr_percent, tm.commission_projeto_percent
    INTO v_rate_mrr, v_rate_proj
  FROM public.team_members tm
  WHERE tm.id = NEW.sale_responsible_id
    AND tm.organization_id = NEW.organization_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- product_type: metadata da entry que originou o evento (via caderno de
  -- etapa). Ausente/inválido → 'mrr', espelhando o `?? "mrr"` do vigente.
  SELECT pse.entry_id, pe.metadata->>'product_type'
    INTO v_entry_id, v_ptype_raw
  FROM public.pipeline_stage_events pse
  LEFT JOIN public.pipeline_entries pe ON pe.id = pse.entry_id
  WHERE pse.id = NEW.stage_event_id;

  v_ptype := CASE WHEN v_ptype_raw IN ('mrr', 'projeto')
                  THEN v_ptype_raw::public.product_type
                  ELSE 'mrr'::public.product_type END;

  -- Defaults 1.0 / 0.5 = os MESMOS do cálculo vigente quando a coluna é NULL.
  v_rate := CASE WHEN v_ptype = 'mrr'
                 THEN COALESCE(v_rate_mrr, 1.0)
                 ELSE COALESCE(v_rate_proj, 0.5) END;

  -- Base NULL (valor desconhecido) → comissão 0, linha mantida pra
  -- rastreabilidade 1:1 evento⇒projeção (o vigente também soma 0).
  v_amount := round(COALESCE(NEW.sale_value, 0) * v_rate / 100, 2);

  -- Período no relógio da ORG (ADR-0017 §5).
  SELECT o.timezone INTO v_tz
  FROM public.organizations o
  WHERE o.id = NEW.organization_id;
  v_local := NEW.sold_at AT TIME ZONE COALESCE(v_tz, 'America/Sao_Paulo');

  INSERT INTO public.commissions
    (organization_id, team_member_id, pipe_proposta_id, amount, type,
     month, year, paid, sale_event_id, source, rate_percent)
  VALUES
    (NEW.organization_id, NEW.sale_responsible_id, v_entry_id, v_amount,
     v_ptype, extract(month FROM v_local)::int, extract(year FROM v_local)::int,
     false, NEW.id, 'sale_event_projection', v_rate)
  ON CONFLICT (sale_event_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_project_commission() FROM PUBLIC;

COMMENT ON FUNCTION public.fn_project_commission() IS
  'ADR-0017 §6 / #994 — projeta cada sale_event em commissions: sale → linha '
  'positiva pro Closer do snapshot (taxa do team_member snapshotada, período '
  'no timezone da org); sale_reversed → espelho negativo no período da '
  'original; sale_lost → nada. Idempotente via UNIQUE(sale_event_id).';

CREATE TRIGGER trg_sale_events_project_commission
  AFTER INSERT ON public.sale_events
  FOR EACH ROW
  WHEN (NEW.source = 'trigger')
  EXECUTE FUNCTION public.fn_project_commission();

-- ============================================================================
-- 5. Backfill — NÃO (deliberado)
-- ============================================================================
-- Projeção começa a valer com o caderno (#993 também não tem backfill).
-- Comissões históricas seguem no fluxo manual vigente; se o backfill
-- governado de vendas vier (ADR-0017 §7), ele decide o próprio tratamento
-- de comissão (o WHEN source='trigger' garante que não projeta sozinho).
