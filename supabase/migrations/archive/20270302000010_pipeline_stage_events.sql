-- 20270302000010_pipeline_stage_events.sql
--
-- Issue #992 · PRD #986 · ADR-0017 §write-model — caderno append-only de
-- transições de etapa. Toda mudança de `pipeline_entries.stage_key` vira
-- linha IMUTÁVEL aqui; métricas de funil (SP-3) leem SÓ deste caderno,
-- nunca do estado mutável do kanban (mata R1 da auditoria 2026-07-02).
--
-- `pipeline_entries` é o choke point único de stage no schema atual:
--   · kanban system → compat views pipe_whatsapp/confirmacao/propostas
--     (INSTEAD OF triggers → UPDATE pipeline_entries, 20260983000000)
--   · custom pipes → custom_pipe_entries + trg_sync_custom_pipe_to_entries
--     (upsert em pipeline_entries, 20260981000000)
--   · RPCs bulk, workflow executor, webhooks → UPDATE direto
-- Logo, UM par de triggers aqui cobre 100% dos caminhos de escrita.
--
-- Conteúdo:
--   1. Tabela `pipeline_stage_events` (append-only) + índices
--   2. RLS: SELECT tenant via get_my_organization_ids(); ZERO policy de
--      escrita pra usuários (INSERT só via trigger SECURITY DEFINER)
--   3. Grants: REVOKE tudo; SELECT pra authenticated/service_role.
--      UPDATE/DELETE revogados de TODOS os roles.
--   4. Imutabilidade: trigger BEFORE UPDATE OR DELETE que dá RAISE —
--      bloqueia até postgres/service_role (belt-and-braces sobre o REVOKE)
--   5. Captura: AFTER INSERT (from=NULL) e AFTER UPDATE OF stage_key
--      (só transição real) em pipeline_entries
--   6. Backfill best-effort de lead_history (source='backfill',
--      ADR-0017 §7 — corte contratual 2026-12-01) + alinhamento terminal
--
-- Rollback: supabase/migrations/rollback/20270302000010_pipeline_stage_events.sql
-- Testes:   supabase/tests/pipeline_stage_events_test.sql (pgTAP)

-- ============================================================================
-- 1. Tabela
-- ============================================================================
-- Decisões de FK (ON DELETE):
--   · organization_id → CASCADE: teardown de tenant leva tudo (padrão do repo).
--   · lead_id → CASCADE: segue o prior art de meeting_events (ADR-0007) e o
--     ADR-0017 ("lead deletado não conta em métrica"). Hard-delete de lead é
--     a operação sancionada de destruição de dados (LGPD / reset de teste);
--     manter eventos órfãos de FK envenenaria todo join da camada de leitura.
--     Append-only protege a HISTÓRIA DE MÉTRICA contra adulteração
--     (UPDATE/DELETE no caderno), não contra a destruição da entidade-mãe.
--     Soft-delete (leads.deleted_at) NÃO passa por aqui — eventos ficam e a
--     leitura filtra (ADR-0017).
--   · pipeline_id → CASCADE: funil deletado → histórico de funil daquele
--     funil não tem leitura possível (métricas parametrizam por pipeline_id).
--     Receita/venda NÃO depende deste caderno — sale_events (SP-2, #993)
--     snapshota atribuição e sobrevive independente.
--   · entry_id → SEM FK, de propósito (prior art: meeting_events.source_entry_id).
--     Entries são efêmeras (lead sai do pipe → row some; re-entra → row nova);
--     o evento sobrevive à entry. FK com SET NULL exigiria UPDATE no caderno —
--     proibido pelo trigger de imutabilidade. Soft reference para debug/join.
--   · actor → SEM FK (snapshot de auth.uid() no momento; user deletado não
--     pode reescrever história — mesmo racional do meeting_events).
--
-- CHECK real_transition: from ≠ to por construção (from=NULL = entrada no funil).
-- CHECK source: 'trigger' (captura ao vivo) | 'backfill' (reconstrução).
--   Fontes novas = migration nova alterando o CHECK (governado, não free-text).

CREATE TABLE public.pipeline_stage_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id         uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  pipeline_id     uuid NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  entry_id        uuid,
  from_stage_key  text,
  to_stage_key    text NOT NULL,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  actor           uuid,
  source          text NOT NULL DEFAULT 'trigger'
                    CONSTRAINT pipeline_stage_events_source_check
                    CHECK (source IN ('trigger', 'backfill')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pipeline_stage_events_real_transition
    CHECK (from_stage_key IS DISTINCT FROM to_stage_key)
);

COMMENT ON TABLE public.pipeline_stage_events IS
  'ADR-0017 / #992 — caderno append-only de transições de stage_key em '
  'pipeline_entries. Fonte ÚNICA de métricas de funil (SP-3). Nunca sofre '
  'UPDATE/DELETE (trigger de imutabilidade); correção = evento novo.';
COMMENT ON COLUMN public.pipeline_stage_events.from_stage_key IS
  'NULL = entrada do lead no funil (INSERT da entry).';
COMMENT ON COLUMN public.pipeline_stage_events.entry_id IS
  'Soft reference (sem FK, de propósito) pra pipeline_entries.id — entries '
  'são efêmeras, o evento sobrevive a elas. Prior art: meeting_events.source_entry_id.';
COMMENT ON COLUMN public.pipeline_stage_events.actor IS
  'Snapshot de auth.uid() no momento do evento (NULL = automação/service_role). '
  'Sem FK: user deletado não reescreve história.';
COMMENT ON COLUMN public.pipeline_stage_events.occurred_at IS
  'Âncora temporal canônica da transição (ADR-0017 §R4). Backfill usa o '
  'timestamp original do registro reconstruído.';

-- Índices pensados pros dois padrões de leitura do SP-3:
--   funil por org+período (com e sem recorte de funil) e timeline por lead.
CREATE INDEX idx_pipeline_stage_events_org_occurred
  ON public.pipeline_stage_events (organization_id, occurred_at);
CREATE INDEX idx_pipeline_stage_events_org_pipeline_occurred
  ON public.pipeline_stage_events (organization_id, pipeline_id, occurred_at);
CREATE INDEX idx_pipeline_stage_events_lead
  ON public.pipeline_stage_events (lead_id, occurred_at DESC);
CREATE INDEX idx_pipeline_stage_events_entry
  ON public.pipeline_stage_events (entry_id) WHERE entry_id IS NOT NULL;

-- ============================================================================
-- 2. RLS — leitura tenant-scoped; escrita SÓ via trigger definer
-- ============================================================================
-- get_my_organization_ids() é SECURITY DEFINER (bypassa RLS) — NUNCA subquery
-- inline em team_members dentro de policy (recursão infinita quando Realtime
-- avalia apply_rls(); gotcha documentado no CLAUDE.md raiz).
-- Sem policy de INSERT/UPDATE/DELETE: authenticated não escreve por nenhum
-- caminho; o caminho de escrita é o trigger SECURITY DEFINER (roda como owner,
-- bypassa RLS) e migrations (owner).

ALTER TABLE public.pipeline_stage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY pipeline_stage_events_select ON public.pipeline_stage_events
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

-- ============================================================================
-- 3. Grants — UPDATE/DELETE revogados de TODOS os roles
-- ============================================================================
REVOKE ALL ON public.pipeline_stage_events FROM PUBLIC;
REVOKE ALL ON public.pipeline_stage_events FROM anon;
REVOKE ALL ON public.pipeline_stage_events FROM authenticated;
REVOKE ALL ON public.pipeline_stage_events FROM service_role;

GRANT SELECT ON public.pipeline_stage_events TO authenticated;
GRANT SELECT ON public.pipeline_stage_events TO service_role;
-- Nenhum INSERT grant: append é exclusividade do trigger definer + migrations.
-- service_role sem UPDATE/DELETE → 42501 antes mesmo do trigger de imutabilidade.

-- ============================================================================
-- 4. Imutabilidade — RAISE em UPDATE/DELETE, inclusive owner/service_role
-- ============================================================================
-- UPDATE: proibido sempre, sem exceção (correção = evento novo; ADR-0017 §3).
-- DELETE: proibido, EXCETO o cascade de teardown das entidades-mãe
--   (org/lead/pipeline deletados). Detecção precisa: dentro do cascade de FK
--   a linha-mãe já não existe; num DELETE direto (qualquer role, qualquer
--   contexto) as três mães ainda existem → RAISE. Sem esse escape o
--   ON DELETE CASCADE das FKs deadlockaria com o trigger e deletar lead
--   quebraria (reset de teste, LGPD, delete de org).
-- SECURITY DEFINER + search_path pinado (invariante #638): precisa enxergar
-- leads/organizations/pipelines por baixo de RLS pra validar o contexto.

CREATE FUNCTION public.fn_pipeline_stage_events_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'pipeline_stage_events é append-only (ADR-0017): UPDATE proibido — corrija com evento novo'
      USING ERRCODE = 'P0001';
  END IF;

  -- DELETE: só passa se alguma entidade-mãe já foi deletada (cascade de FK).
  IF EXISTS (SELECT 1 FROM public.leads         WHERE id = OLD.lead_id)
     AND EXISTS (SELECT 1 FROM public.organizations WHERE id = OLD.organization_id)
     AND EXISTS (SELECT 1 FROM public.pipelines     WHERE id = OLD.pipeline_id) THEN
    RAISE EXCEPTION 'pipeline_stage_events é append-only (ADR-0017): DELETE proibido — eventos só caem em cascade de lead/pipeline/org'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN OLD;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_pipeline_stage_events_block_mutation() FROM PUBLIC;

CREATE TRIGGER trg_pipeline_stage_events_immutable
  BEFORE UPDATE OR DELETE ON public.pipeline_stage_events
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_pipeline_stage_events_block_mutation();

-- ============================================================================
-- 5. Captura — pipeline_entries → evento
-- ============================================================================
-- Exatamente 1 evento por transição:
--   · AFTER INSERT           → from=NULL, to=stage_key (entrada no funil)
--   · AFTER UPDATE OF stage_key WHEN (OLD.stage_key IS DISTINCT FROM NEW.stage_key)
--     → from=OLD, to=NEW. UPDATE OF dispara mesmo com valor igual (basta a
--     coluna estar no SET — caso real: upsert do sync de custom_pipe_entries);
--     o WHEN garante só transição de fato.
-- Entries sem lead (deal-only, lead_id NULL) não geram evento: o funil de
-- métricas é lead-scoped (ADR-0017) e o caderno exige lead_id NOT NULL.
-- SEM catch de exceção, de propósito: se o caderno falhar, a movimentação
-- falha junto — evento perdido = métrica errada pra sempre (ledger = verdade;
-- diferente do log de timeline em lead_history, que é best-effort e engole).

CREATE FUNCTION public.fn_capture_pipeline_stage_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.pipeline_stage_events
    (organization_id, lead_id, pipeline_id, entry_id,
     from_stage_key, to_stage_key, occurred_at, actor, source)
  VALUES
    (NEW.organization_id, NEW.lead_id, NEW.pipeline_id, NEW.id,
     CASE WHEN TG_OP = 'UPDATE' THEN OLD.stage_key END,
     NEW.stage_key, now(), auth.uid(), 'trigger');
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_capture_pipeline_stage_event() FROM PUBLIC;

CREATE TRIGGER trg_pipeline_entries_stage_event_insert
  AFTER INSERT ON public.pipeline_entries
  FOR EACH ROW
  WHEN (NEW.lead_id IS NOT NULL)
  EXECUTE FUNCTION public.fn_capture_pipeline_stage_event();

CREATE TRIGGER trg_pipeline_entries_stage_event_update
  AFTER UPDATE OF stage_key ON public.pipeline_entries
  FOR EACH ROW
  WHEN (OLD.stage_key IS DISTINCT FROM NEW.stage_key AND NEW.lead_id IS NOT NULL)
  EXECUTE FUNCTION public.fn_capture_pipeline_stage_event();

-- ============================================================================
-- 6. Backfill de lead_history — best-effort DECLARADO (ADR-0017 §7)
-- ============================================================================
-- O que lead_history REALMENTE contém (investigado, não presumido):
--
--   (i)  Registros ESTRUTURADOS — trigger fn_log_pipeline_stage_change_history
--        (20261129000003, ativo desde 2026-11-29): metadata carrega
--        pipeline_id, from_stage, to_stage (stage_key reais). SÓ moves de
--        AUTOMAÇÃO (workflow/copilot/cron; auth.uid() IS NULL). 100%
--        reconstruíveis → Parte A.
--   (ii) Moves MANUAIS (frontend logAction) — description-only, com o NOME
--        de exibição da etapa ('Etapa alterada para "X" no funil Y'), sem
--        stage_key nem pipeline_id. NÃO reconstruímos: parsear label→key
--        quebra em rename — exatamente a classe de bug que o ADR-0017 mata.
--        Backfill parcial correto > inventado.
--   (iii) Registros legados pré-consolidação (triggers das tabelas
--        pipe_* dropadas, 20260731100000): description-only ('Movido para
--        <status> no funil ...'), sem metadata estruturada. Não reconstruídos,
--        mesmo racional de (ii).
--
-- Corte contratual 2026-12-01 (ADR-0017 §7): completude de transição só é
-- prometida DALI EM DIANTE pra automação — e, a partir DESTA migration, pra
-- tudo (captura ao vivo). Pré-corte = best-effort declarado. Estruturados
-- anteriores ao corte (janela 2026-11-29→12-01) entram também: são dados
-- corretos, e o contrato é piso de completude, não teto.
--
-- Parte B (alinhamento terminal) fecha o buraco de (ii)/(iii) no que importa:
-- garante que o ÚLTIMO estado de TODA entry viva está no caderno, ancorado em
-- stage_changed_at (timestamp real mantido por trigger desde a consolidação).
-- Transições intermediárias manuais pré-migration ficam de fora — limitação
-- conhecida e declarada; o funil pré-corte "parecerá mais raso", aceito e
-- rotulado (ADR-0017 §Consequences).

-- ── Parte A — registros estruturados de lead_history ────────────────────────
INSERT INTO public.pipeline_stage_events
  (organization_id, lead_id, pipeline_id, entry_id,
   from_stage_key, to_stage_key, occurred_at, actor, source)
SELECT
  lh.organization_id,
  lh.lead_id,
  (lh.metadata->>'pipeline_id')::uuid,
  pe.id,                                   -- entry pode já não existir → NULL
  NULLIF(lh.metadata->>'from_stage', ''),
  lh.metadata->>'to_stage',
  lh.created_at,                           -- timestamp original da transição
  lh.created_by,                           -- NULL em automação (fiel à origem)
  'backfill'
FROM public.lead_history lh
JOIN public.pipelines p
  ON p.id = (lh.metadata->>'pipeline_id')::uuid   -- funil deletado → sem FK possível, pula
JOIN public.leads l
  ON l.id = lh.lead_id                            -- lead hard-deleted → FK cascade já limpou lh, cinto extra
LEFT JOIN public.pipeline_entries pe
  ON pe.pipeline_id = (lh.metadata->>'pipeline_id')::uuid
 AND pe.lead_id = lh.lead_id                      -- único parcial (pipeline_id, lead_id) WHERE lead_id IS NOT NULL
WHERE lh.action = 'stage_changed'
  AND lh.organization_id IS NOT NULL
  AND COALESCE(lh.metadata->>'to_stage', '') <> ''
  AND (lh.metadata->>'pipeline_id')
      ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND NULLIF(lh.metadata->>'from_stage', '') IS DISTINCT FROM (lh.metadata->>'to_stage');

-- ── Parte B — alinhamento terminal com o estado vivo do kanban ──────────────
-- Pra cada entry viva com lead: se o caderno não termina no stage_key atual
-- (nenhum evento, ou último evento ≠ estado), insere 1 evento de fechamento
-- ancorado em stage_changed_at. GREATEST preserva monotonicidade por entry
-- quando o último evento estruturado é posterior ao stage_changed_at
-- (move manual não-logado entre os dois — hora exata desconhecida, honesto
-- colocar "não antes do último fato conhecido").
INSERT INTO public.pipeline_stage_events
  (organization_id, lead_id, pipeline_id, entry_id,
   from_stage_key, to_stage_key, occurred_at, actor, source)
SELECT
  pe.organization_id,
  pe.lead_id,
  pe.pipeline_id,
  pe.id,
  le.to_stage_key,                          -- NULL quando não há evento algum
  pe.stage_key,
  GREATEST(
    COALESCE(pe.stage_changed_at, pe.entered_at, pe.created_at),
    COALESCE(le.occurred_at, '-infinity'::timestamptz)
  ),
  NULL,
  'backfill'
FROM public.pipeline_entries pe
LEFT JOIN LATERAL (
  SELECT e.to_stage_key, e.occurred_at
  FROM public.pipeline_stage_events e
  WHERE e.pipeline_id = pe.pipeline_id
    AND e.lead_id = pe.lead_id
  ORDER BY e.occurred_at DESC, e.created_at DESC
  LIMIT 1
) le ON true
WHERE pe.lead_id IS NOT NULL
  AND (le.to_stage_key IS NULL OR le.to_stage_key IS DISTINCT FROM pe.stage_key);

-- ── Verificação pós-backfill (rodar manualmente; deve retornar 0) ───────────
--   -- Nenhuma entry viva cujo último evento diverge do estado atual:
--   SELECT count(*)
--   FROM public.pipeline_entries pe
--   LEFT JOIN LATERAL (
--     SELECT e.to_stage_key FROM public.pipeline_stage_events e
--     WHERE e.pipeline_id = pe.pipeline_id AND e.lead_id = pe.lead_id
--     ORDER BY e.occurred_at DESC, e.created_at DESC LIMIT 1
--   ) le ON true
--   WHERE pe.lead_id IS NOT NULL
--     AND le.to_stage_key IS DISTINCT FROM pe.stage_key;
