-- 20270301000020_pipeline_stages_stage_role.sql
--
-- Issue #990 · PRD #986 · ADR-0017 §1 — Etapa governada por enum único.
--
-- `stage_role` é o ÚNICO input semântico de etapa permitido para métricas.
-- Enum exclusivo por construção (um role por stage, estados contraditórios
-- impossíveis) — NÃO flags booleanas paralelas. `is_final_positive` /
-- `is_final_negative` permanecem como semântica de board (UI-only) e são
-- PROIBIDAS como input de métrica (ADR-0017 §1; lint SP-0.6).
--
-- Conteúdo:
--   1. Tipo enum `public.stage_role` (open|meeting_booked|meeting_held|won|lost)
--   2. Mapa determinístico stage_key de sistema → role
--      (`public.system_stage_role`) — fonte única, reusada pelo backfill,
--      pelo trigger de seed de org nova e pelo classifier da fatia #991.
--   3. Coluna `pipeline_stages.stage_role` NOT NULL DEFAULT 'open'
--   4. Backfill determinístico de 100% das stages de sistema existentes
--   5. Trigger BEFORE INSERT que aplica o mapa em seeds futuros
--      (org nova via create_default_pipeline_stages ficaria toda 'open'
--      sem isso — vendido jamais emitiria sale_event no SP-2)
--   6. Query de verificação de cobertura (comentário no fim; arquivo
--      executável em rollback/20270301000020_pipeline_stages_stage_role_verify.sql)
--
-- Rollback: supabase/migrations/rollback/20270301000020_pipeline_stages_stage_role.sql
-- Stages custom (stage_key fora do mapa) ficam 'open' — o AI Stage Classifier
-- (fatia #991) sugere roles pra elas; won/lost exigem confirmação humana.

-- ============================================================================
-- 1. Enum
-- ============================================================================

CREATE TYPE public.stage_role AS ENUM (
  'open',
  'meeting_booked',
  'meeting_held',
  'won',
  'lost'
);

COMMENT ON TYPE public.stage_role IS
  'ADR-0017 §1 — papel semântico exclusivo de uma etapa de pipeline. '
  'Único input de etapa permitido em métricas (is_final_* é UI-only).';

-- ============================================================================
-- 2. Mapa determinístico — stage_keys de SISTEMA → role
-- ============================================================================
-- Conjunto completo de chaves de sistema, levantado das seeds:
--   create_default_pipeline_stages (20260124180000 → 20260500000000 →
--   20260503000000 → 20260604000000, versão vigente) e do funil mergeado
--   (20261124000000, ADR-0004: agendado/remarcar/compareceu/nao_compareceu
--   no pipe whatsapp).
--
-- Decisões semânticas (as não-óbvias, com justificativa):
--   · confirmar_d5/d3/d2/d1 e confirmacao_no_dia → meeting_booked: o lead
--     TEM reunião marcada durante toda a esteira de confirmação; D-5..dia
--     são estados operacionais da MESMA reunião. Dedup de "alcançou booked"
--     é responsabilidade da camada de leitura (eventos), não do role.
--   · remarcar (whatsapp e confirmacao) → open: reunião caiu; não há
--     compromisso ativo. O fato histórico "chegou a marcar" já está
--     preservado no caderno de eventos pela passagem anterior.
--   · nao_compareceu (funil mergeado) → lost: desfecho terminal negativo do
--     funil (seed marca is_final_negative); perder por no-show é perder a
--     oportunidade — vira sale_lost com loss_reason no SP-2.
--   · marcar_compromisso / compromisso_marcado (propostas) → open:
--     "compromisso" é rito de fechamento dentro do pipe de propostas, não a
--     reunião de qualificação — contar como meeting_* duplicaria o funil de
--     reuniões (auditoria 2026-07, métricas de reunião = pipe whatsapp/confirmacao).
--   · esfriou / futuro / reativar → open: estados de nutrição, não desfecho.
--   · upsell_base (0-3m..18m+) e upsell_gestao (campeoes..inativos) → open:
--     são buckets de classificação de carteira, não etapas de funil de venda;
--     receita de upsell entra pelo stream `carteira` do sale_event (ADR-0017 §2),
--     nunca por role de stage.
--
-- IMMUTABLE: função pura sobre os argumentos (só CASE), sem acesso a tabela.

CREATE FUNCTION public.system_stage_role(p_pipeline_type text, p_stage_key text)
RETURNS public.stage_role
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT (
    CASE p_pipeline_type
      WHEN 'whatsapp' THEN
        CASE p_stage_key
          WHEN 'agendado'          THEN 'meeting_booked'
          WHEN 'compareceu'        THEN 'meeting_held'
          WHEN 'nao_compareceu'    THEN 'lost'
          -- novo | abordado | respondeu | esfriou | remarcar → open
          ELSE 'open'
        END
      WHEN 'confirmacao' THEN
        CASE p_stage_key
          WHEN 'reuniao_marcada'    THEN 'meeting_booked'
          WHEN 'confirmar_d5'       THEN 'meeting_booked'
          WHEN 'confirmar_d3'       THEN 'meeting_booked'
          WHEN 'confirmar_d2'       THEN 'meeting_booked'
          WHEN 'confirmar_d1'       THEN 'meeting_booked'
          WHEN 'confirmacao_no_dia' THEN 'meeting_booked'
          WHEN 'compareceu'         THEN 'meeting_held'
          WHEN 'perdido'            THEN 'lost'
          -- remarcar → open
          ELSE 'open'
        END
      WHEN 'propostas' THEN
        CASE p_stage_key
          WHEN 'vendido' THEN 'won'
          WHEN 'perdido' THEN 'lost'
          -- marcar_compromisso | reativar | compromisso_marcado | esfriou | futuro → open
          ELSE 'open'
        END
      -- upsell_base | upsell_gestao | qualquer pipe custom → open
      ELSE 'open'
    END
  )::public.stage_role
$$;

COMMENT ON FUNCTION public.system_stage_role(text, text) IS
  'ADR-0017 §1 / #990 — mapa determinístico stage_key de sistema → stage_role. '
  'Fonte única: backfill, trigger de INSERT e classifier (#991) leem daqui. '
  'Chaves desconhecidas (custom) → open.';

-- ============================================================================
-- 3. Coluna
-- ============================================================================
-- ADD COLUMN NOT NULL + DEFAULT é seguro (fast default, sem rewrite; tabela
-- tem ~O(1k) linhas: ~30 orgs × ~30 stages).

ALTER TABLE public.pipeline_stages
  ADD COLUMN stage_role public.stage_role NOT NULL DEFAULT 'open';

COMMENT ON COLUMN public.pipeline_stages.stage_role IS
  'ADR-0017 §1 — papel semântico governado da etapa. Único input de etapa '
  'válido para métricas. Renomear a etapa (name) NUNCA altera o role. '
  'is_final_positive/is_final_negative são UI-only.';

-- ============================================================================
-- 4. Backfill determinístico — 100% das stages de sistema das orgs existentes
-- ============================================================================
-- Stages custom (chave fora do mapa) permanecem no DEFAULT 'open' — o
-- classifier (#991) cuida delas. O WHERE evita touch desnecessário nas
-- linhas que já ficam 'open'.

UPDATE public.pipeline_stages
SET stage_role = public.system_stage_role(pipeline_type, stage_key)
WHERE public.system_stage_role(pipeline_type, stage_key) <> 'open';

-- ============================================================================
-- 5. Trigger — seeds futuros recebem o mapa automaticamente
-- ============================================================================
-- create_default_pipeline_stages (org nova) insere sem stage_role; sem este
-- trigger, toda org criada após esta migration teria vendido='open' e nunca
-- emitiria sale_event (SP-2). BEFORE INSERT apenas — UPDATE (rename, reorder,
-- classifier, override humano) jamais passa por aqui, então role atribuído
-- não é sobrescrito. INSERT com role explícito ≠ 'open' é respeitado.
-- (Gotcha "triggers alteram dados silenciosamente" documentado aqui: o efeito
-- é exclusivamente NEW.stage_role em INSERT, determinístico pelo mapa.)

CREATE FUNCTION public.pipeline_stages_assign_system_stage_role()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.stage_role = 'open' THEN
    NEW.stage_role := public.system_stage_role(NEW.pipeline_type, NEW.stage_key);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pipeline_stages_system_stage_role
  BEFORE INSERT ON public.pipeline_stages
  FOR EACH ROW
  EXECUTE FUNCTION public.pipeline_stages_assign_system_stage_role();

-- ============================================================================
-- 6. Verificação de cobertura (executável em
--    rollback/20270301000020_pipeline_stages_stage_role_verify.sql)
-- ============================================================================
-- Deve retornar 0 linhas imediatamente após o backfill: toda stage carrega
-- exatamente o role do mapa determinístico (custom → open por definição).
--
--   SELECT organization_id, pipeline_type, stage_key, name, stage_role,
--          public.system_stage_role(pipeline_type, stage_key) AS expected_role
--   FROM public.pipeline_stages
--   WHERE stage_role IS DISTINCT FROM
--         public.system_stage_role(pipeline_type, stage_key);
--
-- E cobertura positiva por role (sanity — todas as orgs com pipes de sistema
-- devem ter won/lost/meeting_*):
--
--   SELECT stage_role, count(*) AS stages, count(DISTINCT organization_id) AS orgs
--   FROM public.pipeline_stages
--   GROUP BY stage_role ORDER BY stage_role;
