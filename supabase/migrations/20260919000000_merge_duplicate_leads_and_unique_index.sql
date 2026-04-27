-- =====================================================================
-- Merge leads duplicados (mesma org + mesmo normalized_phone) e cria
-- UNIQUE INDEX para impedir novas duplicatas.
--
-- Causa: lead-webhook recebe webhook 2x do Meta em ms (retry agressivo).
-- Sem UNIQUE INDEX, INSERTs concorrentes ambos passam → leads duplicados →
-- workflow_executions duplicadas → disparos WhatsApp dobrados.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Mapping (duplicate_id -> canonical_id) por org+normalized_phone
-- ---------------------------------------------------------------------
CREATE TEMP TABLE _lead_dedupe_map ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    id,
    organization_id,
    normalized_phone,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY organization_id, normalized_phone
      ORDER BY created_at ASC, id ASC
    ) AS rn,
    FIRST_VALUE(id) OVER (
      PARTITION BY organization_id, normalized_phone
      ORDER BY created_at ASC, id ASC
    ) AS canonical_id
  FROM public.leads
  WHERE normalized_phone IS NOT NULL
)
SELECT
  id AS duplicate_id,
  canonical_id,
  organization_id,
  normalized_phone
FROM ranked
WHERE rn > 1;

CREATE INDEX ON _lead_dedupe_map (duplicate_id);
CREATE INDEX ON _lead_dedupe_map (canonical_id);

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM _lead_dedupe_map;
  RAISE NOTICE '[lead-merge] Total leads duplicados a serem mesclados: %', v_count;
END $$;

-- ---------------------------------------------------------------------
-- 2. PRE-DEDUPE: tabelas com UNIQUE constraint envolvendo lead_id
--
--    Para cada (duplicate, canonical), se canonical JÁ tem row com mesma
--    unique key, deletar row do duplicate (não há merge útil — canonical
--    leva o estado mais antigo / mais relevante).
--    Caso contrário, deixar pro UPDATE genérico re-apontar.
-- ---------------------------------------------------------------------

-- 2a. conversation_context_summary — UNIQUE(lead_id) só lead_id
DELETE FROM public.conversation_context_summary t
USING _lead_dedupe_map m
WHERE t.lead_id = m.duplicate_id
  AND EXISTS (
    SELECT 1 FROM public.conversation_context_summary s
    WHERE s.lead_id = m.canonical_id
  );

-- 2b. conversations — UNIQUE(lead_id) só lead_id
DELETE FROM public.conversations t
USING _lead_dedupe_map m
WHERE t.lead_id = m.duplicate_id
  AND EXISTS (
    SELECT 1 FROM public.conversations s
    WHERE s.lead_id = m.canonical_id
  );

-- 2c. lead_scores — UNIQUE(lead_id)
DELETE FROM public.lead_scores t
USING _lead_dedupe_map m
WHERE t.lead_id = m.duplicate_id
  AND EXISTS (
    SELECT 1 FROM public.lead_scores s
    WHERE s.lead_id = m.canonical_id
  );

-- 2d. lead_tags — UNIQUE(lead_id, tag_id)
DELETE FROM public.lead_tags t
USING _lead_dedupe_map m
WHERE t.lead_id = m.duplicate_id
  AND EXISTS (
    SELECT 1 FROM public.lead_tags s
    WHERE s.lead_id = m.canonical_id AND s.tag_id = t.tag_id
  );

-- 2e. lead_custom_field_values — UNIQUE(lead_id, field_id)
DELETE FROM public.lead_custom_field_values t
USING _lead_dedupe_map m
WHERE t.lead_id = m.duplicate_id
  AND EXISTS (
    SELECT 1 FROM public.lead_custom_field_values s
    WHERE s.lead_id = m.canonical_id AND s.field_id = t.field_id
  );

-- 2f. custom_pipe_entries — UNIQUE(pipeline_id, lead_id)
DELETE FROM public.custom_pipe_entries t
USING _lead_dedupe_map m
WHERE t.lead_id = m.duplicate_id
  AND EXISTS (
    SELECT 1 FROM public.custom_pipe_entries s
    WHERE s.lead_id = m.canonical_id AND s.pipeline_id = t.pipeline_id
  );

-- 2g. copilot_ab_assignments — UNIQUE(agent_id, lead_id)
DELETE FROM public.copilot_ab_assignments t
USING _lead_dedupe_map m
WHERE t.lead_id = m.duplicate_id
  AND EXISTS (
    SELECT 1 FROM public.copilot_ab_assignments s
    WHERE s.lead_id = m.canonical_id AND s.agent_id = t.agent_id
  );

-- 2h. upsell_clients — UNIQUE(organization_id, lead_id)
DELETE FROM public.upsell_clients t
USING _lead_dedupe_map m
WHERE t.lead_id = m.duplicate_id
  AND EXISTS (
    SELECT 1 FROM public.upsell_clients s
    WHERE s.lead_id = m.canonical_id AND s.organization_id = t.organization_id
  );

-- ---------------------------------------------------------------------
-- 3. Re-apontar FKs em todas tabelas filhas (descobertas via info_schema)
--    Após pre-dedupe acima, UPDATE não viola unique constraint.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  v_sql TEXT;
  v_updated BIGINT;
BEGIN
  FOR r IN
    SELECT DISTINCT
      tc.table_schema,
      tc.table_name,
      kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
     AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_schema = 'public'
      AND ccu.table_name = 'leads'
      AND ccu.column_name = 'id'
      AND tc.table_schema = 'public'
      AND tc.table_name <> 'leads'
  LOOP
    v_sql := format(
      'UPDATE %I.%I t
         SET %I = m.canonical_id
       FROM _lead_dedupe_map m
       WHERE t.%I = m.duplicate_id',
      r.table_schema, r.table_name, r.column_name, r.column_name
    );
    EXECUTE v_sql;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RAISE NOTICE '[lead-merge] %.% (col %) → % rows reapontadas',
      r.table_schema, r.table_name, r.column_name, v_updated;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 4. Cancelar workflow_executions duplicadas (mesma workflow+lead)
--    pendentes/processing/waiting → para disparos em fila
-- ---------------------------------------------------------------------
WITH ranked AS (
  SELECT
    id,
    workflow_id,
    lead_id,
    started_at,
    ROW_NUMBER() OVER (
      PARTITION BY workflow_id, lead_id
      ORDER BY started_at ASC, id ASC
    ) AS rn
  FROM public.workflow_executions
  WHERE status IN ('pending', 'processing', 'waiting')
    AND lead_id IS NOT NULL
)
UPDATE public.workflow_executions we
   SET status = 'cancelled',
       error = COALESCE(error, '') || ' [auto-cancelled: lead duplicate merge]',
       completed_at = NOW()
  FROM ranked r
 WHERE we.id = r.id
   AND r.rn > 1;

-- ---------------------------------------------------------------------
-- 5. Deletar leads duplicados
-- ---------------------------------------------------------------------
DELETE FROM public.leads l
USING _lead_dedupe_map m
WHERE l.id = m.duplicate_id;

-- ---------------------------------------------------------------------
-- 6. UNIQUE INDEX para prevenir futuras duplicatas
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_org_phone_unique
  ON public.leads (organization_id, normalized_phone)
  WHERE normalized_phone IS NOT NULL;

COMMIT;

-- =====================================================================
-- Estatísticas finais
-- =====================================================================
DO $$
DECLARE
  v_total INTEGER;
  v_dups INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_total FROM public.leads;
  SELECT COUNT(*) INTO v_dups FROM (
    SELECT 1
    FROM public.leads
    WHERE normalized_phone IS NOT NULL
    GROUP BY organization_id, normalized_phone
    HAVING COUNT(*) > 1
  ) sub;
  RAISE NOTICE '[lead-merge] Concluído. Leads totais: %. Duplicatas remanescentes: %.', v_total, v_dups;
END $$;
