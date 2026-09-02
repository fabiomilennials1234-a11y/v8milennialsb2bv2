-- 20270908001000_inversao_do_silo_custom.sql — SCRUM-621 (W2 · épico Funil é Funil)
--
-- INVERSÃO DO SILO CUSTOM: `pipeline_entries`/`pipelines` viram a FONTE ÚNICA
-- dos funis custom. `custom_pipe_entries` e `custom_pipelines` deixam de ser
-- tabelas e viram views de compat com INSTEAD OF (D5: espelho com data pra
-- morrer — caem na F6). Mesmo playbook das pipe_* (W1) e da
-- custom_pipeline_stages (SCRUM-616): medir → migrar → INSTEAD OF → asserções.
--
-- ── DECISÃO: colunas extras de custom_pipelines → pipelines.config (JSONB) ──
-- custom_pipelines tem 12 colunas que pipelines não tem (lifecycle_type,
-- starts_at, ends_at, status, team_goal, individual_goal, bonus_value,
-- bonus_description, objective_pipe_type, objective_stage_key, template_type,
-- lead_source_config). Uso real medido em prod 2026-09-02 (79 funis):
--   lifecycle_type ≠ 'permanent'  →  2      status ≠ 'active'   →  2
--   starts_at NOT NULL            →  1      ends_at NOT NULL    →  2
--   template_type NOT NULL        → 13      metas/bônus         →  0
--   objective_*                   →  0      lead_source_config  →  0
-- Alternativas recusadas:
--   · Colunas novas em pipelines — polui a tabela canônica com features de
--     campanha que a F4 redesenha; 12 colunas pra ≤13 valores reais.
--   · Tabela sidecar — mais um objeto pra demolir na F6, e um JOIN na view
--     (quebra a auto-updatability e o caminho de lock da base).
-- `pipelines.config` já existe (default '{}'), guarda SÓ valores não-default
-- (jsonb_strip_nulls) e a view expõe cada campo com COALESCE no default e cast
-- no tipo original — shape idêntico ao da tabela antiga.
--
-- `position`: o sync legado gravava display_order = position + 3 (custom depois
-- dos 3 de sistema) — medido 79/79 em prod. A view expõe display_order - 3 e o
-- INSTEAD OF grava position + 3. Nenhuma coluna nova.
--
-- `pre_sale_responsible_id`/`sale_responsible_id` (1.091 linhas cada): seguem o
-- MESMO padrão das views pipe_* de W1 — vivem em pipeline_entries.metadata e a
-- view expõe `(metadata->>'…')::uuid`. Tenancy preservada por
-- fn_assert_member_in_org() (DEFINER, criada aqui) chamada nos INSTEAD OF —
-- substitui o trg_assert_member_same_org_custom_pipe_entries que morre com a
-- tabela (assigned_to continua coberto pelo trigger da base).
--
-- ── DRIFT reconciliado ANTES do drop (medido 2026-09-02) ──
--   · 16.550 cpe; 16.565 pe custom; 16 pe custom sem espelho cpe
--     (manutencao-bikes — pe já é a fonte que fica: nada a fazer, os 16 cards
--     passam a aparecer no kanban custom, antes eram invisíveis).
--   · 1 cpe (dd91cd35…) cujo id casa com pe de funil de SISTEMA ('vendido') —
--     o par descasado documentado em fn_sync_deal_id_to_custom_pipe_entry.
--     Ganha linha própria (uuid novo) em pipeline_entries no funil custom dele.
--   · 2 pares custom com stage divergente: a cpe aponta etapa de OUTRO funil
--     (mesma stage_key 'novo'); a pe já resolveu pra etapa correta do próprio
--     funil — a FONTE está certa, o espelho corrompido morre com a tabela.
--     Pares onde a cpe tivesse etapa legítima do funil seriam reconciliados
--     cpe→pe (0 hoje; o UPDATE fica pra janela real por robustez).
--
-- ── TRIGGERS (enumerados um a um em pg_trigger, prod 2026-09-02) ──
--   custom_pipe_entries:
--     trg_apply_stage_checklist_custom (OF stage_id)  → MORRE; o da base é
--       unificado: apply_stage_checklist perde o ramo TG_TABLE_NAME custom e
--       resolve por stage_id (fallback legado por slug+key); o trigger da base
--       vira OF stage_id, stage_key.
--     trg_assert_member_same_org_custom_pipe_entries  → MORRE; assigned_to já
--       coberto na base; pre_sale/sale cobertos por fn_assert_member_in_org.
--     trg_custom_pipe_entries_updated_at              → MORRE; INSTEAD OF seta.
--     trg_sync_custom_pipe_to_entries                 → MORRE (é a inversão).
--     trg_workflow_custom_pipe_entry                  → RENASCE na base:
--       trg_workflow_pipeline_custom_entry, contexto IDÊNTICO (ADR-0031):
--       lead_created {trigger, pipeline_id} + stage_changed {trigger,
--       pipeline_id, to_stage} — pipeline_id sem pipe_type.
--     trg_workflow_custom_pipe_stage_change           → RENASCE na base:
--       trg_workflow_pipeline_custom_stage_change, contexto IDÊNTICO
--       {trigger, pipeline_id, from_stage, to_stage, pipeline_entry_id,
--       deal_id}; o id canônico agora é NEW.id direto (era resolvido via
--       pickActiveEntry — mesmo critério, sem a busca).
--   custom_pipelines:
--     trg_custom_pipelines_updated_at → MORRE; INSTEAD OF seta.
--     trg_sync_custom_pipeline        → MORRE (é a inversão).
--   pipeline_entries:
--     trg_sync_deal_id_to_custom_pipe_entry → MORRE (espelho não existe mais;
--       mantê-lo viraria UPDATE da view → INSTEAD OF → self-loop).
--     trg_pipeline_entries_dispatch → INTOCADO. Continua early-return pra
--       custom (resolve slug só com funil de sistema). O destravamento é
--       D11/W3, NÃO aqui — asserção-tripwire no bloco final e sonda no ensaio.
--     demais 14 triggers da base → intocados; o caminho custom JÁ passava por
--       eles via sync (ON CONFLICT ... SET stage_key), nada muda de frequência.
--
-- ── ESCRITORES (grep + pg_proc, todos cobertos por INSTEAD OF I/U/D+RETURNING) ──
--   Front: useCustomPipelines (CRUD + realtime + FK-hint — os 2 últimos migram
--   no front NESTA janela), stageTransition, useLeadDetail, useCrossPipeMove,
--   useExportLeads, AddToFunilDialog, useWhatsAppLeadIntegration,
--   ImportCustomPipelineContent, OnboardingWizard.
--   Edge fns: disparo-planilha-create, import-leads, onboarding-engine,
--   move-stage.
--   RPCs: abrir_negocio (ramo custom:), bulk_add_to_custom_pipe,
--   import_lead_into_custom_pipeline, bulk_delete_leads, purge_lead,
--   fn_auto_assign_lead_default_pipe, get_all_funnels_lead_ids,
--   get_custom_filtered_lead_ids, get_custom_pipeline_stage_counts,
--   custom_pipeline_delete_impact, lead_excluded_from_metrics,
--   create_lead_from_social_conversation, remove_demo_data — funcionam contra
--   as views sem mudança. REESCRITAS aqui, porque view não suporta o que usam:
--     · seed_demo_data — ON CONFLICT (org, slug) não roda em view → escreve
--       direto em pipelines (que tem o UNIQUE real).
--     · delete_custom_pipeline — SELECT ... FOR UPDATE + dependia do sync pra
--       limpar o espelho → opera direto em pipelines/pipeline_entries/
--       pipeline_stages, mesmas guardas e mesmo retorno.
--   PostgREST embeds: leads/pipeline_stages/pipelines resolvidos pelas FKs da
--   BASE através das views (view→view inclusive). Único hint nominal no front
--   (`team_members!custom_pipe_entries_assigned_to_fkey`) migra para
--   `pipeline_entries_assigned_to_fkey` no mesmo PR.
--
-- ── REALTIME ── custom_pipe_entries NUNCA esteve na publication
--   supabase_realtime (medido: só pipelines + pipeline_entries) — a subscription
--   do front era um no-op. O front migra pra pipeline_entries nesta janela e o
--   realtime do kanban custom passa a funcionar de verdade. Nada a fazer no DB.
--
-- ── MUDANÇAS DE COMPORTAMENTO ACEITAS (documentadas, não silenciosas) ──
--   1. Slug custom passa a colidir com slug de qualquer funil da org
--      (pipelines UNIQUE org+slug é total; o antigo era parcial is_active).
--      O front já trata 23505 com mensagem amigável. Zero violações existentes
--      (o espelho já vivia sob o UNIQUE total).
--   2. Os 16 cards pe-only de manutencao-bikes aparecem no kanban custom.
--   3. Movimento custom agora grava lead_history/closed_at pelos triggers da
--      base — paridade que o sync já exercitava parcialmente.
--
-- Backfill de Negócios dos cards custom sem deal = SCRUM-622 (fora daqui).
-- Rollback pareado: rollback/20270908001000_inversao_do_silo_custom.sql

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

-- ════════════════════════════════════════════════════════════════════════════
-- 0. Pré-flight + snapshot
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF (SELECT relkind FROM pg_class WHERE oid = to_regclass('public.custom_pipe_entries')) IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION 'SCRUM621: custom_pipe_entries não é tabela — migration já aplicada?';
  END IF;
  IF (SELECT relkind FROM pg_class WHERE oid = to_regclass('public.custom_pipelines')) IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION 'SCRUM621: custom_pipelines não é tabela — migration já aplicada?';
  END IF;
  IF (SELECT relkind FROM pg_class WHERE oid = to_regclass('public.custom_pipeline_stages')) IS DISTINCT FROM 'v' THEN
    RAISE EXCEPTION 'SCRUM621: custom_pipeline_stages deveria já ser view (SCRUM-616 antes)';
  END IF;
END;
$$;

CREATE TEMP TABLE _scrum621_pre ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.custom_pipe_entries)                             AS cpe_total,
  (SELECT count(*) FROM public.custom_pipelines)                                AS cp_total,
  (SELECT count(*) FROM public.pipeline_entries pe
     JOIN public.pipelines p ON p.id = pe.pipeline_id
    WHERE p.type = 'custom')                                                    AS pe_custom,
  (SELECT count(*) FROM public.custom_pipe_entries c
     JOIN public.pipeline_entries pe ON pe.id = c.id
     JOIN public.pipelines p ON p.id = pe.pipeline_id
    WHERE p.type <> 'custom')                                                   AS cpe_par_nao_custom,
  (SELECT count(*) FROM public.custom_pipe_entries c
     JOIN public.pipeline_entries pe ON pe.id = c.id
     JOIN public.pipelines p ON p.id = pe.pipeline_id
    WHERE p.type = 'custom' AND c.stage_id IS DISTINCT FROM pe.stage_id)        AS pares_stage_diverge,
  (SELECT count(*) FROM public.custom_pipe_entries
    WHERE pre_sale_responsible_id IS NOT NULL)                                  AS presale_nn,
  (SELECT count(*) FROM public.custom_pipe_entries
    WHERE sale_responsible_id IS NOT NULL)                                      AS sale_nn,
  (SELECT count(*) FROM public.custom_pipelines c
     JOIN public.pipelines p ON p.id = c.id
    WHERE p.display_order <> c.position + 3)                                    AS offset_quebrado;

DO $$
DECLARE pre record;
BEGIN
  SELECT * INTO pre FROM _scrum621_pre;
  -- Espelho de funis 1:1 nos dois sentidos — pré-condição da inversão.
  IF EXISTS (SELECT 1 FROM public.custom_pipelines c
              WHERE NOT EXISTS (SELECT 1 FROM public.pipelines p WHERE p.id = c.id)) THEN
    RAISE EXCEPTION 'SCRUM621: custom_pipelines sem espelho em pipelines';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pipelines p
              WHERE p.type = 'custom'
                AND NOT EXISTS (SELECT 1 FROM public.custom_pipelines c WHERE c.id = p.id)) THEN
    RAISE EXCEPTION 'SCRUM621: pipelines custom sem linha em custom_pipelines';
  END IF;
  -- O offset position+3 é a regra do sync — se quebrou, a view mentiria.
  IF pre.offset_quebrado <> 0 THEN
    RAISE EXCEPTION 'SCRUM621: % funis com display_order <> position+3 — medir antes de inverter', pre.offset_quebrado;
  END IF;
  -- Toda cpe tem par em pipeline_entries por id (medido: 0 sem par).
  IF EXISTS (SELECT 1 FROM public.custom_pipe_entries c
              WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_entries pe WHERE pe.id = c.id)) THEN
    RAISE EXCEPTION 'SCRUM621: cpe sem par algum em pipeline_entries — drift novo, medir';
  END IF;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Reconciliação do drift (triggers da base DESLIGADOS: reconciliação não é
--    movimento de card — não pode acordar dispatch/workflow/checklist/história)
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.pipeline_entries DISABLE TRIGGER USER;

-- 1a. Pares custom com stage divergente: a cpe (o que a UI mostra) vence,
--     DESDE que a etapa dela pertença ao funil do card. Medido em prod
--     2026-09-02: os 2 pares divergentes são o caso OPOSTO — a cpe aponta
--     etapa de OUTRO funil (mesma stage_key 'novo') e a pe já resolveu para a
--     etapa correta do próprio funil. Nesses, a FONTE está certa e o espelho é
--     que está corrompido: pe vence (nada a escrever). O predicado do UPDATE
--     só toca o primeiro caso; a asserção aceita como resto APENAS o segundo.
WITH alvo AS (
  SELECT c.id, c.stage_id, ps.stage_key, c.stage_changed_at, c.updated_at
  FROM public.custom_pipe_entries c
  JOIN public.pipeline_entries pe ON pe.id = c.id
  JOIN public.pipelines p ON p.id = pe.pipeline_id AND p.type = 'custom'
  JOIN public.pipeline_stages ps ON ps.id = c.stage_id AND ps.pipeline_id = c.pipeline_id
  WHERE c.stage_id IS DISTINCT FROM pe.stage_id
)
UPDATE public.pipeline_entries pe
   SET stage_id         = alvo.stage_id,
       stage_key        = alvo.stage_key,
       stage_changed_at = alvo.stage_changed_at,
       updated_at       = alvo.updated_at
  FROM alvo
 WHERE pe.id = alvo.id;

DO $$
DECLARE pre record; v_rest bigint;
BEGIN
  SELECT * INTO pre FROM _scrum621_pre;
  -- Resto tolerado: SÓ o caso em que o espelho aponta etapa de outro funil e a
  -- fonte já está na etapa correta (mesma stage_key) do funil do card.
  SELECT count(*) INTO v_rest
  FROM public.custom_pipe_entries c
  JOIN public.pipeline_entries pe ON pe.id = c.id
  JOIN public.pipelines p ON p.id = pe.pipeline_id AND p.type = 'custom'
  WHERE c.stage_id IS DISTINCT FROM pe.stage_id
    AND NOT EXISTS (
      -- espelho corrompido + fonte saudável = par aceito (pe vence)
      SELECT 1
      FROM public.pipeline_stages ps_cpe
      JOIN public.pipeline_stages ps_pe ON ps_pe.id = pe.stage_id
      WHERE ps_cpe.id = c.stage_id
        AND ps_cpe.pipeline_id IS DISTINCT FROM c.pipeline_id
        AND ps_pe.pipeline_id = pe.pipeline_id
        AND ps_pe.stage_key = ps_cpe.stage_key
    );
  IF v_rest <> 0 THEN
    RAISE EXCEPTION 'SCRUM621: % pares divergentes fora dos casos conhecidos (havia %)', v_rest, pre.pares_stage_diverge;
  END IF;
END;
$$;

-- 1b. cpe cujo id casa com pe NÃO-custom (o par descasado dd91cd35…): o card
--     custom ganha linha PRÓPRIA em pipeline_entries (uuid novo — o antigo
--     pertence ao card de sistema). deal_id só se ainda livre
--     (uq_pipeline_entries_deal_id); os órfãos de deal são SCRUM-622.
CREATE TEMP TABLE _scrum621_reinseridas (id uuid) ON COMMIT DROP;

WITH descasadas AS (
  SELECT c.*
  FROM public.custom_pipe_entries c
  JOIN public.pipeline_entries pe ON pe.id = c.id
  JOIN public.pipelines p ON p.id = pe.pipeline_id
  WHERE p.type <> 'custom'
), ins AS (
  INSERT INTO public.pipeline_entries
    (id, organization_id, pipeline_id, lead_id, deal_id, stage_key, stage_id,
     assigned_to, notes, metadata, entered_at, stage_changed_at, created_at, updated_at)
  SELECT
    gen_random_uuid(), d.organization_id, d.pipeline_id, d.lead_id,
    CASE WHEN d.deal_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.pipeline_entries x WHERE x.deal_id = d.deal_id)
         THEN d.deal_id END,
    ps.stage_key, d.stage_id, d.assigned_to, d.notes,
    '{}'::jsonb || jsonb_strip_nulls(jsonb_build_object(
      'pre_sale_responsible_id', d.pre_sale_responsible_id,
      'sale_responsible_id',     d.sale_responsible_id)),
    d.entered_at, d.stage_changed_at, d.created_at, d.updated_at
  FROM descasadas d
  JOIN public.pipeline_stages ps ON ps.id = d.stage_id AND ps.pipeline_id = d.pipeline_id
  RETURNING id
)
INSERT INTO _scrum621_reinseridas SELECT id FROM ins;

DO $$
DECLARE pre record; v_n bigint;
BEGIN
  SELECT * INTO pre FROM _scrum621_pre;
  SELECT count(*) INTO v_n FROM _scrum621_reinseridas;
  IF v_n <> pre.cpe_par_nao_custom THEN
    RAISE EXCEPTION 'SCRUM621: reinseridas (%) != pares descasados medidos (%)', v_n, pre.cpe_par_nao_custom;
  END IF;
END;
$$;

-- 1c. Responsáveis pre_sale/sale → metadata do par canônico (padrão pipe_* W1).
UPDATE public.pipeline_entries pe
   SET metadata = COALESCE(pe.metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
         'pre_sale_responsible_id', c.pre_sale_responsible_id,
         'sale_responsible_id',     c.sale_responsible_id))
  FROM public.custom_pipe_entries c
  JOIN public.pipelines p ON p.id = c.pipeline_id AND p.type = 'custom'
 WHERE pe.id = c.id
   AND pe.pipeline_id = c.pipeline_id
   AND (c.pre_sale_responsible_id IS NOT NULL OR c.sale_responsible_id IS NOT NULL);

ALTER TABLE public.pipeline_entries ENABLE TRIGGER USER;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Colunas extras de custom_pipelines → pipelines.config (só não-default)
-- ════════════════════════════════════════════════════════════════════════════

UPDATE public.pipelines p
   SET config = COALESCE(p.config, '{}'::jsonb) || x.extras
  FROM (
    SELECT c.id,
           jsonb_strip_nulls(jsonb_build_object(
             'lifecycle_type',      NULLIF(c.lifecycle_type, 'permanent'),
             'status',              NULLIF(c.status, 'active'),
             'starts_at',           c.starts_at,
             'ends_at',             c.ends_at,
             'team_goal',           c.team_goal,
             'individual_goal',     c.individual_goal,
             'bonus_value',         c.bonus_value,
             'bonus_description',   c.bonus_description,
             'objective_pipe_type', c.objective_pipe_type,
             'objective_stage_key', c.objective_stage_key,
             'template_type',       c.template_type,
             'lead_source_config',  c.lead_source_config
           )) AS extras
    FROM public.custom_pipelines c
  ) x
 WHERE p.id = x.id AND x.extras <> '{}'::jsonb;


-- ════════════════════════════════════════════════════════════════════════════
-- 3. FKs que apontavam para custom_pipelines → pipelines (uuid preservado,
--    mesma ação de ON DELETE; zero órfãos por construção do espelho 1:1)
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.custom_pipe_transitions
  DROP CONSTRAINT custom_pipe_transitions_source_pipeline_id_fkey,
  ADD CONSTRAINT custom_pipe_transitions_source_pipeline_id_fkey
    FOREIGN KEY (source_pipeline_id) REFERENCES public.pipelines(id) ON DELETE CASCADE;

ALTER TABLE public.custom_pipe_transitions
  DROP CONSTRAINT custom_pipe_transitions_target_pipeline_id_fkey,
  ADD CONSTRAINT custom_pipe_transitions_target_pipeline_id_fkey
    FOREIGN KEY (target_pipeline_id) REFERENCES public.pipelines(id) ON DELETE CASCADE;

ALTER TABLE public.custom_pipeline_members
  DROP CONSTRAINT custom_pipeline_members_pipeline_id_fkey,
  ADD CONSTRAINT custom_pipeline_members_pipeline_id_fkey
    FOREIGN KEY (pipeline_id) REFERENCES public.pipelines(id) ON DELETE CASCADE;

ALTER TABLE public.pipeline_stages
  DROP CONSTRAINT pipeline_stages_target_pipeline_id_fkey,
  ADD CONSTRAINT pipeline_stages_target_pipeline_id_fkey
    FOREIGN KEY (target_pipeline_id) REFERENCES public.pipelines(id) ON DELETE SET NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Morrem o sync e as tabelas (a inversão em si)
-- ════════════════════════════════════════════════════════════════════════════

-- O espelho deal_id pe→cpe vira self-loop com a view — morre.
DROP TRIGGER trg_sync_deal_id_to_custom_pipe_entry ON public.pipeline_entries;
DROP FUNCTION public.fn_sync_deal_id_to_custom_pipe_entry();

-- Triggers das tabelas caem com elas; as funções exclusivas caem em seguida.
DROP TABLE public.custom_pipe_entries;   -- leva a FK p/ custom_pipelines junto
DROP TABLE public.custom_pipelines;

DROP FUNCTION public.sync_custom_pipe_to_entries();
DROP FUNCTION public.sync_custom_pipeline_to_pipelines();
DROP FUNCTION public.trigger_workflow_custom_pipe_entry();
DROP FUNCTION public.trigger_workflow_custom_pipe_stage_change();

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Guarda de tenancy p/ responsáveis em metadata (substitui o trigger morto)
-- ════════════════════════════════════════════════════════════════════════════

-- DEFINER pelo mesmo motivo do fn_assert_member_same_org que substitui: quem
-- escreve é usuário comum e a RLS de team_members esconderia o membro da OUTRA
-- org — a validação aprovaria exatamente o que existe pra recusar. Corpo burro:
-- uma consulta por PK, zero SQL dinâmico.
CREATE FUNCTION public.fn_assert_member_in_org(p_member uuid, p_org uuid, p_col text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF p_member IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.team_members m
                  WHERE m.id = p_member AND m.organization_id = p_org) THEN
    RAISE EXCEPTION 'access_denied: % aponta para team_member % de outra organização', p_col, p_member
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_assert_member_in_org(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_assert_member_in_org(uuid, uuid, text) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. View de compat custom_pipelines + INSTEAD OF (shape idêntico à tabela)
-- ════════════════════════════════════════════════════════════════════════════

CREATE VIEW public.custom_pipelines
WITH (security_invoker = on) AS
SELECT
  p.id,
  p.organization_id,
  p.name,
  p.slug,
  p.description,
  p.icon,
  p.color,
  (p.display_order - 3)::integer                          AS position,
  p.is_active,
  p.created_by,
  p.created_at,
  p.updated_at,
  COALESCE(p.config->>'lifecycle_type', 'permanent')      AS lifecycle_type,
  (p.config->>'starts_at')::timestamptz                   AS starts_at,
  (p.config->>'ends_at')::timestamptz                     AS ends_at,
  COALESCE(p.config->>'status', 'active')                 AS status,
  (p.config->>'team_goal')::integer                       AS team_goal,
  (p.config->>'individual_goal')::integer                 AS individual_goal,
  (p.config->>'bonus_value')::integer                     AS bonus_value,
  p.config->>'bonus_description'                          AS bonus_description,
  p.config->>'objective_pipe_type'                        AS objective_pipe_type,
  p.config->>'objective_stage_key'                        AS objective_stage_key,
  p.config->>'template_type'                              AS template_type,
  p.config->'lead_source_config'                          AS lead_source_config
FROM public.pipelines p
WHERE p.type = 'custom';

COMMENT ON VIEW public.custom_pipelines IS
  'View de compat sobre pipelines (type=custom). D5: espelho com data pra '
  'morrer — cai na F6 da unificação de funis. Extras vivem em pipelines.config; '
  'position = display_order - 3. SCRUM-621.';

-- Valida os vocabulários que os CHECKs da tabela antiga garantiam.
CREATE FUNCTION public.custom_pipelines_check_vocab(p_lifecycle text, p_status text, p_template text)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF p_lifecycle IS NOT NULL AND p_lifecycle NOT IN ('permanent', 'temporary') THEN
    RAISE EXCEPTION 'custom_pipelines: lifecycle_type % inválido', p_lifecycle
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('draft', 'active', 'paused', 'ended') THEN
    RAISE EXCEPTION 'custom_pipelines: status % inválido', p_status
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_template IS NOT NULL AND p_template NOT IN ('indicacao', 'prospeccao', 'reativacao') THEN
    RAISE EXCEPTION 'custom_pipelines: template_type % inválido', p_template
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE FUNCTION public.custom_pipelines_extras(
  p_lifecycle text, p_starts timestamptz, p_ends timestamptz, p_status text,
  p_team_goal integer, p_individual_goal integer, p_bonus_value integer,
  p_bonus_description text, p_objective_pipe_type text, p_objective_stage_key text,
  p_template_type text, p_lead_source_config jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO ''
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'lifecycle_type',      NULLIF(p_lifecycle, 'permanent'),
    'status',              NULLIF(p_status, 'active'),
    'starts_at',           p_starts,
    'ends_at',             p_ends,
    'team_goal',           p_team_goal,
    'individual_goal',     p_individual_goal,
    'bonus_value',         p_bonus_value,
    'bonus_description',   p_bonus_description,
    'objective_pipe_type', p_objective_pipe_type,
    'objective_stage_key', p_objective_stage_key,
    'template_type',       p_template_type,
    'lead_source_config',  p_lead_source_config
  ));
$$;

CREATE FUNCTION public.custom_pipelines_insert_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  NEW.id             := COALESCE(NEW.id, gen_random_uuid());
  NEW.icon           := COALESCE(NEW.icon, 'kanban');
  NEW.color          := COALESCE(NEW.color, '#3b82f6');
  NEW.position       := COALESCE(NEW.position, 0);
  NEW.is_active      := COALESCE(NEW.is_active, true);
  NEW.lifecycle_type := COALESCE(NEW.lifecycle_type, 'permanent');
  NEW.status         := COALESCE(NEW.status, 'active');
  NEW.created_at     := COALESCE(NEW.created_at, now());
  NEW.updated_at     := COALESCE(NEW.updated_at, now());  -- metric-lint-allow: default de INSTEAD OF INSERT, não métrica (SCRUM-621)

  PERFORM public.custom_pipelines_check_vocab(NEW.lifecycle_type, NEW.status, NEW.template_type);

  INSERT INTO public.pipelines (
    id, organization_id, name, slug, type, description, icon, color,
    display_order, is_active, config, created_by, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.organization_id, NEW.name, NEW.slug, 'custom', NEW.description,
    NEW.icon, NEW.color, NEW.position + 3, NEW.is_active,
    public.custom_pipelines_extras(
      NEW.lifecycle_type, NEW.starts_at, NEW.ends_at, NEW.status,
      NEW.team_goal, NEW.individual_goal, NEW.bonus_value, NEW.bonus_description,
      NEW.objective_pipe_type, NEW.objective_stage_key, NEW.template_type,
      NEW.lead_source_config),
    NEW.created_by, NEW.created_at, NEW.updated_at
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_custom_pipelines_insert
  INSTEAD OF INSERT ON public.custom_pipelines
  FOR EACH ROW EXECUTE FUNCTION public.custom_pipelines_insert_fn();

CREATE FUNCTION public.custom_pipelines_update_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  PERFORM public.custom_pipelines_check_vocab(NEW.lifecycle_type, NEW.status, NEW.template_type);

  UPDATE public.pipelines p SET
    organization_id = NEW.organization_id,
    name            = NEW.name,
    slug            = NEW.slug,
    description     = NEW.description,
    icon            = NEW.icon,
    color           = NEW.color,
    display_order   = COALESCE(NEW.position, 0) + 3,
    is_active       = NEW.is_active,
    created_by      = NEW.created_by,
    config          = (p.config
                        - 'lifecycle_type' - 'starts_at' - 'ends_at' - 'status'
                        - 'team_goal' - 'individual_goal' - 'bonus_value'
                        - 'bonus_description' - 'objective_pipe_type'
                        - 'objective_stage_key' - 'template_type' - 'lead_source_config')
                      || public.custom_pipelines_extras(
                           NEW.lifecycle_type, NEW.starts_at, NEW.ends_at, NEW.status,
                           NEW.team_goal, NEW.individual_goal, NEW.bonus_value,
                           NEW.bonus_description, NEW.objective_pipe_type,
                           NEW.objective_stage_key, NEW.template_type,
                           NEW.lead_source_config),
    updated_at      = now()
  WHERE p.id = OLD.id AND p.type = 'custom';
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_custom_pipelines_update
  INSTEAD OF UPDATE ON public.custom_pipelines
  FOR EACH ROW EXECUTE FUNCTION public.custom_pipelines_update_fn();

CREATE FUNCTION public.custom_pipelines_delete_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  DELETE FROM public.pipelines WHERE id = OLD.id AND type = 'custom';
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_custom_pipelines_delete
  INSTEAD OF DELETE ON public.custom_pipelines
  FOR EACH ROW EXECUTE FUNCTION public.custom_pipelines_delete_fn();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_pipelines TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_pipelines TO service_role;
GRANT SELECT ON public.custom_pipelines TO anon;
GRANT SELECT ON public.custom_pipelines TO mcp_readonly;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. View de compat custom_pipe_entries + INSTEAD OF
-- ════════════════════════════════════════════════════════════════════════════

CREATE VIEW public.custom_pipe_entries
WITH (security_invoker = on) AS
SELECT
  pe.id,
  pe.organization_id,
  pe.pipeline_id,
  pe.lead_id,
  pe.stage_id,
  pe.assigned_to,
  pe.notes,
  pe.entered_at,
  pe.stage_changed_at,
  pe.created_at,
  pe.updated_at,
  (pe.metadata->>'pre_sale_responsible_id')::uuid AS pre_sale_responsible_id,
  (pe.metadata->>'sale_responsible_id')::uuid     AS sale_responsible_id,
  pe.deal_id
FROM public.pipeline_entries pe
JOIN public.pipelines p ON p.id = pe.pipeline_id AND p.type = 'custom';

COMMENT ON VIEW public.custom_pipe_entries IS
  'View de compat sobre pipeline_entries (funis type=custom). D5: espelho com '
  'data pra morrer — cai na F6. pre_sale/sale_responsible_id vivem em '
  'pipeline_entries.metadata (mesmo padrão das views pipe_*). SCRUM-621.';

CREATE FUNCTION public.custom_pipe_entries_insert_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_pipe  public.pipelines%ROWTYPE;
  v_stage public.pipeline_stages%ROWTYPE;
BEGIN
  IF NEW.pipeline_id IS NULL THEN
    RAISE EXCEPTION 'custom_pipe_entries: pipeline_id é obrigatório';
  END IF;
  SELECT * INTO v_pipe FROM public.pipelines WHERE id = NEW.pipeline_id;
  IF v_pipe.id IS NULL THEN
    RAISE EXCEPTION 'custom_pipe_entries: funil % não existe em pipelines', NEW.pipeline_id;
  END IF;
  IF v_pipe.type <> 'custom' THEN
    RAISE EXCEPTION 'custom_pipe_entries: funil % não é custom (type=%)', NEW.pipeline_id, v_pipe.type;
  END IF;
  -- Contrato da tabela antiga: lead e etapa NOT NULL.
  IF NEW.lead_id IS NULL THEN
    RAISE EXCEPTION 'custom_pipe_entries: lead_id é obrigatório' USING ERRCODE = 'not_null_violation';
  END IF;
  IF NEW.stage_id IS NULL THEN
    RAISE EXCEPTION 'custom_pipe_entries: stage_id é obrigatório' USING ERRCODE = 'not_null_violation';
  END IF;
  SELECT * INTO v_stage FROM public.pipeline_stages WHERE id = NEW.stage_id;
  IF v_stage.id IS NULL THEN
    RAISE EXCEPTION 'custom_pipe_entries: etapa % não existe', NEW.stage_id;
  END IF;
  IF v_stage.pipeline_id IS DISTINCT FROM NEW.pipeline_id THEN
    RAISE EXCEPTION 'custom_pipe_entries: etapa % pertence ao funil %, não ao funil % do card',
      NEW.stage_id, v_stage.pipeline_id, NEW.pipeline_id;
  END IF;

  NEW.id               := COALESCE(NEW.id, gen_random_uuid());
  NEW.organization_id  := COALESCE(NEW.organization_id, v_pipe.organization_id);
  NEW.entered_at       := COALESCE(NEW.entered_at, now());
  NEW.stage_changed_at := COALESCE(NEW.stage_changed_at, now());
  NEW.created_at       := COALESCE(NEW.created_at, now());
  NEW.updated_at       := COALESCE(NEW.updated_at, now());  -- metric-lint-allow: default de INSTEAD OF INSERT, não métrica (SCRUM-621)

  -- Tenancy dos responsáveis em metadata (o da tabela morreu com ela;
  -- assigned_to segue coberto por trg_assert_member_same_org_pipeline_entries).
  PERFORM public.fn_assert_member_in_org(NEW.pre_sale_responsible_id, NEW.organization_id, 'pre_sale_responsible_id');
  PERFORM public.fn_assert_member_in_org(NEW.sale_responsible_id,     NEW.organization_id, 'sale_responsible_id');

  INSERT INTO public.pipeline_entries (
    id, organization_id, pipeline_id, lead_id, deal_id, stage_key, stage_id,
    assigned_to, notes, metadata, entered_at, stage_changed_at, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.organization_id, NEW.pipeline_id, NEW.lead_id, NEW.deal_id,
    v_stage.stage_key, NEW.stage_id, NEW.assigned_to, NEW.notes,
    '{}'::jsonb || jsonb_strip_nulls(jsonb_build_object(
      'pre_sale_responsible_id', NEW.pre_sale_responsible_id,
      'sale_responsible_id',     NEW.sale_responsible_id)),
    NEW.entered_at, NEW.stage_changed_at, NEW.created_at, NEW.updated_at
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_custom_pipe_entries_insert
  INSTEAD OF INSERT ON public.custom_pipe_entries
  FOR EACH ROW EXECUTE FUNCTION public.custom_pipe_entries_insert_fn();

CREATE FUNCTION public.custom_pipe_entries_update_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_stage_key text;
BEGIN
  IF NEW.pipeline_id IS DISTINCT FROM OLD.pipeline_id THEN
    IF NOT EXISTS (SELECT 1 FROM public.pipelines
                    WHERE id = NEW.pipeline_id AND type = 'custom') THEN
      RAISE EXCEPTION 'custom_pipe_entries: funil % não é custom', NEW.pipeline_id;
    END IF;
  END IF;

  -- stage_key entra no SET pra manter os AFTER ... OF stage_key da base
  -- elegíveis (dispatch/workflow/checklist/história). O BEFORE-mirror
  -- (pipeline_entries_stage_mirror) revalida e é o dono final do espelho.
  SELECT ps.stage_key INTO v_stage_key
  FROM public.pipeline_stages ps WHERE ps.id = NEW.stage_id;

  IF NEW.pre_sale_responsible_id IS DISTINCT FROM OLD.pre_sale_responsible_id THEN
    PERFORM public.fn_assert_member_in_org(NEW.pre_sale_responsible_id, NEW.organization_id, 'pre_sale_responsible_id');
  END IF;
  IF NEW.sale_responsible_id IS DISTINCT FROM OLD.sale_responsible_id THEN
    PERFORM public.fn_assert_member_in_org(NEW.sale_responsible_id, NEW.organization_id, 'sale_responsible_id');
  END IF;

  UPDATE public.pipeline_entries pe SET
    organization_id  = NEW.organization_id,
    pipeline_id      = NEW.pipeline_id,
    lead_id          = NEW.lead_id,
    stage_id         = NEW.stage_id,
    stage_key        = COALESCE(v_stage_key, pe.stage_key),
    assigned_to      = NEW.assigned_to,
    notes            = NEW.notes,
    entered_at       = NEW.entered_at,
    stage_changed_at = NEW.stage_changed_at,
    deal_id          = NEW.deal_id,
    metadata         = (pe.metadata - 'pre_sale_responsible_id' - 'sale_responsible_id')
                       || jsonb_strip_nulls(jsonb_build_object(
                            'pre_sale_responsible_id', NEW.pre_sale_responsible_id,
                            'sale_responsible_id',     NEW.sale_responsible_id)),
    updated_at       = now()
  WHERE pe.id = OLD.id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_custom_pipe_entries_update
  INSTEAD OF UPDATE ON public.custom_pipe_entries
  FOR EACH ROW EXECUTE FUNCTION public.custom_pipe_entries_update_fn();

CREATE FUNCTION public.custom_pipe_entries_delete_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  DELETE FROM public.pipeline_entries WHERE id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_custom_pipe_entries_delete
  INSTEAD OF DELETE ON public.custom_pipe_entries
  FOR EACH ROW EXECUTE FUNCTION public.custom_pipe_entries_delete_fn();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_pipe_entries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_pipe_entries TO service_role;
GRANT SELECT ON public.custom_pipe_entries TO anon;
GRANT SELECT ON public.custom_pipe_entries TO mcp_readonly;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. Workflow custom renasce no lado canônico — contexto IDÊNTICO (ADR-0031)
-- ════════════════════════════════════════════════════════════════════════════

CREATE FUNCTION public.trigger_workflow_pipeline_custom_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  -- Só funil custom; o caminho system tem os triggers próprios (http_post).
  IF NEW.lead_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pipelines p
                  WHERE p.id = NEW.pipeline_id AND p.type = 'custom') THEN
    RETURN NEW;
  END IF;

  -- Shape EXATO do trg_workflow_custom_pipe_entry que morreu (ADR-0031):
  -- pipeline_id sem pipe_type; workflows salvos continuam casando igual.
  PERFORM public.fire_workflow_trigger(
    NEW.organization_id, 'lead_created', NEW.lead_id,
    jsonb_build_object('trigger', 'lead_created', 'pipeline_id', NEW.pipeline_id::text));

  PERFORM public.fire_workflow_trigger(
    NEW.organization_id, 'stage_changed', NEW.lead_id,
    jsonb_build_object('trigger', 'stage_changed',
                       'pipeline_id', NEW.pipeline_id::text,
                       'to_stage', NEW.stage_key));
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_workflow_pipeline_custom_entry
  AFTER INSERT ON public.pipeline_entries
  FOR EACH ROW EXECUTE FUNCTION public.trigger_workflow_pipeline_custom_entry();

CREATE FUNCTION public.trigger_workflow_pipeline_custom_stage_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  IF NEW.lead_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pipelines p
                  WHERE p.id = NEW.pipeline_id AND p.type = 'custom') THEN
    RETURN NEW;
  END IF;

  -- Shape EXATO do trg_workflow_custom_pipe_stage_change que morreu; o sujeito
  -- (pipeline_entry_id) agora é NEW.id direto — era resolvido via
  -- pickActiveEntry porque o espelho não carregava o id canônico.
  PERFORM public.fire_workflow_trigger(
    NEW.organization_id, 'stage_changed', NEW.lead_id,
    jsonb_build_object('trigger', 'stage_changed',
                       'pipeline_id', NEW.pipeline_id::text,
                       'from_stage', OLD.stage_key,
                       'to_stage', NEW.stage_key,
                       'pipeline_entry_id', NEW.id,
                       'deal_id', NEW.deal_id));
  RETURN NEW;
END;
$$;

-- WHEN por VALOR (não OF coluna): UPDATE que só menciona stage_id também tem
-- que disparar — o BEFORE-mirror muda o stage_key antes de o WHEN ser avaliado.
CREATE TRIGGER trg_workflow_pipeline_custom_stage_change
  AFTER UPDATE ON public.pipeline_entries
  FOR EACH ROW
  WHEN (OLD.stage_key IS DISTINCT FROM NEW.stage_key)
  EXECUTE FUNCTION public.trigger_workflow_pipeline_custom_stage_change();

-- ════════════════════════════════════════════════════════════════════════════
-- 9. apply_stage_checklist unificado em stage_id (o ramo custom morreu)
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.apply_stage_checklist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_template_id uuid;
  v_stage_org_id uuid;
  v_new_checklist_id uuid;
  v_entry_id uuid;
  v_deal_id uuid;
BEGIN
  -- Unificado (SCRUM-621): só pipeline_entries dispara isto agora. O ramo
  -- TG_TABLE_NAME='custom_pipe_entries' morreu com a tabela.
  IF TG_OP = 'UPDATE'
     AND NEW.stage_key IS NOT DISTINCT FROM OLD.stage_key
     AND NEW.stage_id  IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NEW;
  END IF;

  -- Resolução canônica por stage_id; fallback legado por (org, slug, key) pros
  -- cards fantasma (stage_id NULL, tolerados por D-a do SCRUM-617).
  IF NEW.stage_id IS NOT NULL THEN
    SELECT ps.checklist_template_id, ps.organization_id
      INTO v_template_id, v_stage_org_id
    FROM public.pipeline_stages ps
    WHERE ps.id = NEW.stage_id;
  ELSE
    SELECT ps.checklist_template_id, ps.organization_id
      INTO v_template_id, v_stage_org_id
    FROM public.pipeline_stages ps
    JOIN public.pipelines p ON p.id = NEW.pipeline_id
    WHERE ps.organization_id = NEW.organization_id
      AND ps.pipeline_type = p.slug
      AND ps.stage_key = NEW.stage_key
      AND ps.is_active = true
    LIMIT 1;
  END IF;

  -- O card é o próprio sujeito (vale pra system e custom agora).
  v_entry_id := NEW.id;
  v_deal_id  := NEW.deal_id;

  IF v_template_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_stage_org_id IS NULL OR v_stage_org_id <> NEW.organization_id THEN
    RETURN NEW;
  END IF;

  IF NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Dois INSERTs e não um ON CONFLICT esperto: os índices-árbitro são parciais
  -- com predicados opostos (ver histórico da função).
  IF v_entry_id IS NOT NULL THEN
    INSERT INTO public.checklists (
      organization_id, lead_id, pipeline_entry_id, deal_id,
      source_template_id, title, description, created_by
    )
    SELECT t.organization_id, NEW.lead_id, v_entry_id, v_deal_id, t.id, t.title, t.description, NULL
    FROM public.checklists t
    WHERE t.id = v_template_id
      AND t.lead_id IS NULL
      AND t.organization_id = NEW.organization_id
    ON CONFLICT (pipeline_entry_id, source_template_id)
      WHERE source_template_id IS NOT NULL AND pipeline_entry_id IS NOT NULL
    DO NOTHING
    RETURNING id INTO v_new_checklist_id;
  ELSE
    INSERT INTO public.checklists (
      organization_id, lead_id, pipeline_entry_id, deal_id,
      source_template_id, title, description, created_by
    )
    SELECT t.organization_id, NEW.lead_id, NULL, NULL, t.id, t.title, t.description, NULL
    FROM public.checklists t
    WHERE t.id = v_template_id
      AND t.lead_id IS NULL
      AND t.organization_id = NEW.organization_id
    ON CONFLICT (lead_id, source_template_id)
      WHERE source_template_id IS NOT NULL AND lead_id IS NOT NULL AND pipeline_entry_id IS NULL
    DO NOTHING
    RETURNING id INTO v_new_checklist_id;
  END IF;

  IF v_new_checklist_id IS NOT NULL THEN
    INSERT INTO public.checklist_items (checklist_id, title, position, template_item_id)
    SELECT v_new_checklist_id, ci.title, ci.position, ci.id
    FROM public.checklist_items ci
    WHERE ci.checklist_id = v_template_id
    ORDER BY ci.position;
  END IF;

  RETURN NEW;
END;
$$;

-- OF stage_id, stage_key: UPDATE que só menciona stage_id (caminho novo do
-- INSTEAD OF e escritores canônicos futuros) também dispara; a guarda por
-- valor dentro da função evita reaplicação sem mudança real.
DROP TRIGGER trg_apply_stage_checklist_pipeline ON public.pipeline_entries;
CREATE TRIGGER trg_apply_stage_checklist_pipeline
  AFTER INSERT OR UPDATE OF stage_id, stage_key ON public.pipeline_entries
  FOR EACH ROW EXECUTE FUNCTION public.apply_stage_checklist();

-- ════════════════════════════════════════════════════════════════════════════
-- 10. RPCs que view não atende: seed_demo_data (ON CONFLICT) e
--     delete_custom_pipeline (FOR UPDATE + dependia do sync)
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.seed_demo_data(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_caller_id    uuid  := auth.uid();
  v_is_admin     boolean;
  v_tag_id       uuid;
  v_pipeline_id  uuid;
  v_leads_created int  := 0;
  v_lead_id      uuid;
  i              int;
  v_already_seeded boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = v_caller_id
      AND organization_id = p_org_id
      AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'insufficient_privilege: apenas admin pode popular dados demo'
      USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.leads l
    JOIN public.lead_tags lt ON lt.lead_id = l.id
    JOIN public.tags t ON t.id = lt.tag_id
    WHERE l.organization_id = p_org_id
      AND t.name = 'demo'
      AND t.organization_id = p_org_id
    LIMIT 1
  ) INTO v_already_seeded;

  IF v_already_seeded THEN
    RETURN jsonb_build_object('already_seeded', true, 'leads', 0);
  END IF;

  INSERT INTO public.tags (organization_id, name, color)
  VALUES (p_org_id, 'demo', '#facc15')
  ON CONFLICT (name, organization_id) DO NOTHING
  RETURNING id INTO v_tag_id;

  IF v_tag_id IS NULL THEN
    SELECT id INTO v_tag_id
    FROM public.tags
    WHERE organization_id = p_org_id AND name = 'demo';
  END IF;

  -- SCRUM-621: custom_pipelines virou view (ON CONFLICT não roda em view) —
  -- escreve direto em pipelines, que carrega o UNIQUE (organization_id, slug).
  INSERT INTO public.pipelines (organization_id, name, slug, type, description, color)
  VALUES (
    p_org_id, 'Demo Pipeline', 'demo-pipeline', 'custom',
    'Pipeline criado automaticamente com dados de demonstração', '#facc15'
  )
  ON CONFLICT (organization_id, slug) DO NOTHING
  RETURNING id INTO v_pipeline_id;

  IF v_pipeline_id IS NULL THEN
    SELECT id INTO v_pipeline_id
    FROM public.pipelines
    WHERE organization_id = p_org_id AND slug = 'demo-pipeline';
  END IF;

  FOR i IN 1..10 LOOP
    INSERT INTO public.leads (
      organization_id, name, company, phone, email, origin, rating
    ) VALUES (
      p_org_id,
      '[DEMO] Lead ' || i || ' — ' || (ARRAY[
        'João Silva', 'Maria Oliveira', 'Carlos Santos', 'Ana Costa',
        'Pedro Lima', 'Fernanda Rocha', 'Ricardo Mendes', 'Juliana Alves',
        'Marcos Pereira', 'Patrícia Souza'
      ])[i],
      (ARRAY[
        'Distribuidora Alpha', 'Metalúrgica Beta', 'Logística Gamma',
        'Comércio Delta', 'Fábrica Epsilon', 'Transportes Zeta',
        'Indústria Eta', 'Atacado Theta', 'Importadora Iota', 'Serviços Kappa'
      ])[i],
      '+55 11 99999-90' || LPAD(i::text, 2, '0'),
      'demo' || i || '@torquecrm-demo.com',
      'outro',
      CASE WHEN i <= 3 THEN 5 WHEN i <= 6 THEN 3 ELSE 1 END
    )
    RETURNING id INTO v_lead_id;

    INSERT INTO public.lead_tags (lead_id, tag_id)
    VALUES (v_lead_id, v_tag_id)
    ON CONFLICT DO NOTHING;

    v_leads_created := v_leads_created + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'already_seeded', false,
    'leads',       v_leads_created,
    'tag_id',      v_tag_id,
    'pipeline_id', v_pipeline_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_custom_pipeline(p_pipeline_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org       uuid;
  v_impact    jsonb;
  v_wf        integer := 0;
  v_bp        integer := 0;
  v_invasores integer := 0;
  v_exemplo   text;
BEGIN
  -- SCRUM-621: lock direto na fonte (view não trava linha); o predicado
  -- type='custom' preserva o contrato — esta RPC nunca apaga funil de sistema.
  SELECT organization_id INTO v_org
    FROM public.pipelines
   WHERE id = p_pipeline_id
     AND type = 'custom'
     FOR UPDATE;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'funil não encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (v_org IN (SELECT public.get_my_organization_ids())
          OR public.is_master_user()
          OR current_setting('role', true) = 'service_role') THEN
    RAISE EXCEPTION 'sem permissão sobre este funil' USING ERRCODE = '42501';
  END IF;

  -- A recusa: card de outro funil parado numa etapa deste — decisão é humana.
  SELECT count(*), min(coalesce(p.name, '(sem nome)') || ' / ' || coalesce(l.name, e.lead_id::text))
    INTO v_invasores, v_exemplo
    FROM public.pipeline_entries e
    JOIN public.pipeline_stages s ON s.id = e.stage_id
    LEFT JOIN public.pipelines p ON p.id = e.pipeline_id
    LEFT JOIN public.leads l     ON l.id = e.lead_id
   WHERE s.pipeline_id = p_pipeline_id
     AND e.pipeline_id <> p_pipeline_id;

  IF v_invasores > 0 THEN
    RAISE EXCEPTION
      'card de outro funil parado numa etapa deste: % card(s), ex. "%". Mova-os para o funil de origem antes de excluir.',
      v_invasores, v_exemplo
      USING ERRCODE = 'P0001';
  END IF;

  v_impact := public.custom_pipeline_delete_impact(p_pipeline_id);

  UPDATE public.workflows w
     SET is_active = false,
         updated_at = now()
   WHERE w.organization_id = v_org
     AND w.is_active
     AND (strpos(w.definition::text, p_pipeline_id::text) > 0
       OR strpos(w.trigger_config::text, p_pipeline_id::text) > 0);
  GET DIAGNOSTICS v_wf = ROW_COUNT;

  UPDATE public.blast_plans
     SET post_send_target = NULL,
         updated_at = now()
   WHERE organization_id = v_org
     AND status IN ('active', 'paused')
     AND post_send_target->>'pipelineId' = p_pipeline_id::text;
  GET DIAGNOSTICS v_bp = ROW_COUNT;

  -- Filhos antes do pai, direto na fonte (o sync que limpava o espelho morreu).
  DELETE FROM public.pipeline_entries WHERE pipeline_id = p_pipeline_id;
  DELETE FROM public.pipeline_stages  WHERE pipeline_id = p_pipeline_id;

  -- O pai: CASCADE leva pipeline_stage_events, custom_pipeline_members e
  -- custom_pipe_transitions (FKs repontadas nesta migration).
  DELETE FROM public.pipelines WHERE id = p_pipeline_id AND type = 'custom';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DELETE não afetou nenhuma linha' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_impact || jsonb_build_object(
    'automacoes_desativadas', v_wf,
    'disparos_neutralizados', v_bp
  );
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 11. Asserções — qualquer falha aborta a transação inteira
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  pre            record;
  v_reinseridas  bigint;
  v_view_cpe     bigint;
  v_view_cp      bigint;
  v_pe_custom    bigint;
  v_presale      bigint;
  v_sale         bigint;
  v_stage_null   bigint;
  v_iot          bigint;
  v_fk           bigint;
BEGIN
  SELECT * INTO pre FROM _scrum621_pre;
  SELECT count(*) INTO v_reinseridas FROM _scrum621_reinseridas;

  -- 11.1 As duas viraram views.
  IF (SELECT relkind FROM pg_class WHERE oid = to_regclass('public.custom_pipe_entries')) IS DISTINCT FROM 'v'
     OR (SELECT relkind FROM pg_class WHERE oid = to_regclass('public.custom_pipelines')) IS DISTINCT FROM 'v' THEN
    RAISE EXCEPTION 'SCRUM621: compat não virou view';
  END IF;

  -- 11.2 Contagem 1:1 — a view devolve a fonte inteira, nada além.
  SELECT count(*) INTO v_pe_custom
  FROM public.pipeline_entries pe
  JOIN public.pipelines p ON p.id = pe.pipeline_id AND p.type = 'custom';
  IF v_pe_custom <> pre.pe_custom + v_reinseridas THEN
    RAISE EXCEPTION 'SCRUM621: pe custom (%) != medido (%) + reinseridas (%)',
      v_pe_custom, pre.pe_custom, v_reinseridas;
  END IF;
  SELECT count(*) INTO v_view_cpe FROM public.custom_pipe_entries;
  IF v_view_cpe <> v_pe_custom THEN
    RAISE EXCEPTION 'SCRUM621: view cpe (%) != fonte (%)', v_view_cpe, v_pe_custom;
  END IF;
  SELECT count(*) INTO v_view_cp FROM public.custom_pipelines;
  IF v_view_cp <> pre.cp_total THEN
    RAISE EXCEPTION 'SCRUM621: view custom_pipelines (%) != % funis medidos', v_view_cp, pre.cp_total;
  END IF;

  -- 11.3 Nenhuma cpe ficou pra trás: todo card da tabela antiga (16.550) está
  -- na fonte — os pares por id + as reinseridas cobrem o total medido.
  IF pre.cpe_total > pre.pe_custom + v_reinseridas THEN
    RAISE EXCEPTION 'SCRUM621: cpe medidas (%) > fonte final (%) — carta perdida',
      pre.cpe_total, pre.pe_custom + v_reinseridas;
  END IF;

  -- 11.4 Responsáveis preservados (>=: a reinserida também carrega os dela).
  SELECT count(*) FILTER (WHERE pre_sale_responsible_id IS NOT NULL),
         count(*) FILTER (WHERE sale_responsible_id IS NOT NULL)
    INTO v_presale, v_sale
  FROM public.custom_pipe_entries;
  IF v_presale < pre.presale_nn OR v_sale < pre.sale_nn THEN
    RAISE EXCEPTION 'SCRUM621: responsáveis perdidos (pre_sale %/%, sale %/%)',
      v_presale, pre.presale_nn, v_sale, pre.sale_nn;
  END IF;

  -- 11.5 Nenhum card custom sem etapa (o contrato NOT NULL da tabela antiga).
  SELECT count(*) INTO v_stage_null FROM public.custom_pipe_entries WHERE stage_id IS NULL;
  IF v_stage_null <> 0 THEN
    RAISE EXCEPTION 'SCRUM621: % cards custom com stage_id NULL', v_stage_null;
  END IF;

  -- 11.6 INSTEAD OF completos: 3 triggers por view.
  SELECT count(*) INTO v_iot FROM pg_trigger t
  WHERE t.tgrelid IN ('public.custom_pipe_entries'::regclass, 'public.custom_pipelines'::regclass)
    AND NOT t.tgisinternal;
  IF v_iot <> 6 THEN
    RAISE EXCEPTION 'SCRUM621: % triggers INSTEAD OF (esperado 6)', v_iot;
  END IF;

  -- 11.7 Workflow custom no lado canônico; sync e espelho deal mortos.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_workflow_pipeline_custom_entry'
                    AND tgrelid = 'public.pipeline_entries'::regclass)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_workflow_pipeline_custom_stage_change'
                    AND tgrelid = 'public.pipeline_entries'::regclass) THEN
    RAISE EXCEPTION 'SCRUM621: triggers de workflow custom ausentes em pipeline_entries';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public'
                AND p.proname IN ('sync_custom_pipe_to_entries',
                                  'sync_custom_pipeline_to_pipelines',
                                  'fn_sync_deal_id_to_custom_pipe_entry',
                                  'trigger_workflow_custom_pipe_entry',
                                  'trigger_workflow_custom_pipe_stage_change')) THEN
    RAISE EXCEPTION 'SCRUM621: função do espelho ainda viva';
  END IF;

  -- 11.8 FKs repontadas pra pipelines e validadas.
  SELECT count(*) INTO v_fk
  FROM pg_constraint
  WHERE conname IN ('custom_pipe_transitions_source_pipeline_id_fkey',
                    'custom_pipe_transitions_target_pipeline_id_fkey',
                    'custom_pipeline_members_pipeline_id_fkey',
                    'pipeline_stages_target_pipeline_id_fkey')
    AND confrelid = 'public.pipelines'::regclass
    AND convalidated;
  IF v_fk <> 4 THEN
    RAISE EXCEPTION 'SCRUM621: % de 4 FKs repontadas/validadas', v_fk;
  END IF;

  -- 11.9 Tripwire D11: o dispatch continua cego pra custom (early-return por
  -- funil de sistema). Destravar é W3, não aqui.
  IF (SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'trigger_pipeline_entries_dispatch')
     NOT LIKE '%pip.type = ''system''%' THEN
    RAISE EXCEPTION 'SCRUM621: trigger_pipeline_entries_dispatch mudou — early-return custom era pra ficar (D11/W3)';
  END IF;

  RAISE NOTICE 'SCRUM621 OK: % cards na fonte única (% reinseridas) · % funis · views + INSTEAD OF no ar',
    v_pe_custom, v_reinseridas, v_view_cp;
END;
$$;
