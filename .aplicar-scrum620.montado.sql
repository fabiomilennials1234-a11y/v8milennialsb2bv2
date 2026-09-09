BEGIN;
-- ═══════════════════════════════════════════════════════════════════════════
-- scripts/scrum620-stage-roles.sql — SCRUM-620 · W1 · Funil é Funil (F1)
-- Zera o backlog de stage_role das etapas custom ATIVAS.
--
-- NÃO é migration — é operação de dado, aplicada UMA vez na janela do CTO via
-- scripts/aplicar-scrum620.sh (BEGIN + este arquivo + COMMIT). Ensaio:
-- scripts/ensaio-scrum620.sh (aborta sozinho com RAISE 'ENSAIO_OK').
--
-- ── CONTEXTO (pós-janela 3 / SCRUM-616) ────────────────────────────────────
-- Todas as etapas vivem em pipeline_stages; custom = pipeline_id → pipelines
-- type='custom' (pipeline_type NULL). custom_pipeline_stages é view de compat.
-- stage_role é o ÚNICO input de etapa em métricas (ADR-0017 §1); a cadeia
-- won→sale_events→comissões roda por metric_stage_role. "Sem role" aqui =
-- stage_role='open' (NOT NULL DEFAULT) + stage_role_reviewed_at IS NULL —
-- a coluna nunca é NULL; o marcador de governança é o trio
-- (role≠open | suggested_stage_role | stage_role_reviewed_at).
--
-- ── PREMISSA DO TICKET REFUTADA EM PROD (2026-09-01) ───────────────────────
-- O ticket mandava "is_final_positive=true → 'won' (inequívoco)". Medido em
-- prod, a flag é SUJA: etapas final-positivas chamadas "Reunião Marcada",
-- "Proposta Enviada", "Respondeu", "Aquecido", "Ligação Marcada" (incl. na
-- org Milennials). Aplicar won por flag cega criaria sale_events/comissões
-- para reunião marcada — corrupção de dado de dinheiro. O próprio classifier
-- (classify-stage-roles, #991) trata flag como SINAL FRACO e enfileira
-- won/lost de flag em vez de aplicar. Regra adotada aqui (documentada no
-- relatório SCRUM-620, decisão revisável pelo CTO):
--
--   PASSADA DETERMINÍSTICA (aplica direto):
--     · nome=won  E is_final_positive  → stage_role='won'   (2 sinais concordam)
--     · nome=lost E is_final_negative  → stage_role='lost'  (2 sinais concordam)
--     · nome=meeting_booked/held       → stage_role=<meeting> (não é dinheiro;
--       paridade com o auto-apply do classifier; nome vence flag — ADR-0006)
--   FILA DE REVISÃO MASTER (/master/stage-roles — suggested_stage_role):
--     · nome=won/lost SEM flag concordante → sugestão source='deterministic'
--     · flag final SEM nome concordante    → sugestão source='flag'
--   GOVERNADO COMO OPEN:
--     · sem flag e sem padrão de nome → stage_role_reviewed_at=now()
--       (reviewed_by NULL = assinatura do script; aposenta a etapa do
--       classifier — inclusive da passada IA — como o dismiss da tela master)
--
-- Sugestões PENDENTES pré-existentes: mantidas, EXCETO quando nome+flag
-- concordam (mesma regra de aplicação — 12 lost + 2 won medidos).
--
-- ── GUARD DE MONEY-ROLE ────────────────────────────────────────────────────
-- trg_pipeline_stages_won_lost_guard (BEFORE INSERT OR UPDATE) barra won/lost
-- salvo service_role/superuser/master/admin-da-org. prod-sql.mjs conecta como
-- `postgres` (rolsuper=false → o guard BARRA). O fluxo legítimo
-- (classify-stage-roles / tela master via PostgREST) escreve como
-- service_role; espelhamos com SET LOCAL ROLE service_role — postgres é
-- member de service_role (verificado em prod 2026-09-01). SET LOCAL exige
-- transação: este arquivo SÓ roda embrulhado em BEGIN/COMMIT (aplicar) ou
-- BEGIN/ROLLBACK (ensaio); o DO de sanidade abaixo aborta se o contexto
-- estiver errado.
--
-- ── TRIGGERS EM UPDATE (armadilha "trigger reescreve seu UPDATE") ──────────
-- Verificado em prod 2026-09-01, gatilhos de pipeline_stages:
--   · trg_pipeline_stages_system_stage_role  — BEFORE INSERT apenas; NÃO
--     reescreve UPDATE (e com pipeline_type NULL seria no-op de todo modo).
--   · trg_pipeline_stages_won_lost_guard     — BEFORE INSERT OR UPDATE; só
--     valida/erra, nunca reescreve NEW.stage_role.
--   · on_pipeline_stage_removed (AFTER UPDATE) — só age quando is_active
--     true→false; este script nunca toca is_active.
--   · trg_queue_followup_reclassify (AFTER UPDATE) — upsert idempotente em
--     followup_reclassify_queue por org; efeito colateral benigno e desejado.
-- Nenhuma desativação de trigger é necessária.
-- ═══════════════════════════════════════════════════════════════════════════

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- ─── 0. Plano de classificação (calculado como postgres, antes do SET ROLE:
--        temp table não depende de grants de service_role) ──────────────────
CREATE TEMP TABLE _s620_plan ON COMMIT DROP AS
WITH custom AS (
  SELECT ps.id, ps.name,
         coalesce(ps.is_final_positive, false) AS fpos,
         coalesce(ps.is_final_negative, false) AS fneg,
         ps.suggested_stage_role,
         trim(regexp_replace(translate(lower(ps.name),
           'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
           '[^a-z0-9]+', ' ', 'g')) AS n
  FROM public.pipeline_stages ps
  JOIN public.pipelines p ON p.id = ps.pipeline_id AND p.type = 'custom'
  WHERE ps.is_active
    AND ps.stage_role = 'open'
    AND ps.stage_role_reviewed_at IS NULL
), named AS (
  -- Espelho SQL das RULES de _shared/metrics/stage-role-classifier.ts
  -- (mesma ordem: negação de comparecimento → won → lost → held → booked).
  SELECT *,
    CASE
      WHEN n ~ '\y(nao|sem) (compareceu|comparecimento)\y'
        OR n ~ '\yno ?show\y' THEN 'lost'
      WHEN n ~ '\y(fechado|fechada|fechou|ganho|ganha|ganhou|ganhamos|vendido|vendida|vendeu|comprou|recomprou|recompra)\y'
        OR n ~ '\yvenda (fechada|realizada|concluida|ganha)\y'
        OR n ~ '\ycontrato (assinado|fechado)\y' THEN 'won'
      WHEN n ~ '\y(perdido|perdida|perdeu|perdemos|perda|desistiu|desistencia|desqualificado|desqualificada|recusou|recusado|recusada|declinou|churn)\y'
        OR n ~ '\y(sem|nao tem) interesse\y' THEN 'lost'
      WHEN n ~ '\y(compareceu|comparecimento|realizada|realizado)\y'
        OR n ~ '\y(reuniao|call|visita|demo|apresentacao) (realizada|feita|concluida|aconteceu)\y' THEN 'meeting_held'
      WHEN n ~ '\y(agendado|agendada|agendamento)\y'
        OR n ~ '\y(reuniao|call|visita|demo|apresentacao) (marcada|agendada|confirmada)\y'
        OR n ~ '\ymarcou (reuniao|call|visita|demo)\y' THEN 'meeting_booked'
    END AS name_role
  FROM custom
)
SELECT id,
  CASE
    WHEN name_role = 'won'  AND fpos THEN 'apply'
    WHEN name_role = 'lost' AND fneg THEN 'apply'
    WHEN name_role IN ('meeting_booked', 'meeting_held') THEN 'apply'
    WHEN suggested_stage_role IS NOT NULL THEN 'keep_queue'
    WHEN name_role IN ('won', 'lost') THEN 'queue'
    WHEN fpos OR fneg THEN 'queue'
    ELSE 'mark_open'
  END AS destino,
  CASE
    WHEN name_role = 'won'  AND fpos THEN 'won'
    WHEN name_role = 'lost' AND fneg THEN 'lost'
    WHEN name_role IN ('meeting_booked', 'meeting_held') THEN name_role
    WHEN suggested_stage_role IS NOT NULL THEN NULL
    WHEN name_role IN ('won', 'lost') THEN name_role
    WHEN fpos THEN 'won'
    WHEN fneg THEN 'lost'
  END AS role_alvo,
  CASE
    WHEN name_role = 'won'  AND fpos THEN 'deterministic'
    WHEN name_role = 'lost' AND fneg THEN 'deterministic'
    WHEN name_role IN ('meeting_booked', 'meeting_held') THEN 'deterministic'
    WHEN suggested_stage_role IS NOT NULL THEN NULL
    WHEN name_role IN ('won', 'lost') THEN 'deterministic'
    WHEN fpos OR fneg THEN 'flag'
  END AS fonte
FROM named;

-- ─── 1. Contexto de escrita do fluxo legítimo (guard de money-role) ─────────
GRANT SELECT ON _s620_plan TO service_role;  -- temp table é do postgres; o service_role precisa ler o plano

SET LOCAL ROLE service_role;

DO $$
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'SCRUM-620 ABORTADO: current_user=% — SET LOCAL ROLE service_role não pegou (rodou fora de transação?). O guard de money-role barraria won/lost.', current_user;
  END IF;
END $$;

-- ─── 2. Aplicação determinística (won/lost com 2 sinais; meeting_* por nome)
--        Predicado de aceite DENTRO do UPDATE: reafirma ativa+ungoverned —
--        nada aplicado fora do estado planejado, mesmo se prod mudou. ────────
UPDATE public.pipeline_stages ps SET
  stage_role                  = pl.role_alvo::public.stage_role,
  suggested_stage_role        = NULL,
  stage_role_suggested_at     = now(),
  stage_role_suggestion_source = pl.fonte,
  stage_role_reviewed_at      = CASE WHEN pl.role_alvo IN ('won','lost') THEN now() END,
  stage_role_reviewed_by      = NULL  -- assinatura do script (dinheiro: a confirmação humana é a janela do CTO)
FROM _s620_plan pl
WHERE ps.id = pl.id
  AND pl.destino = 'apply'
  AND ps.is_active
  AND ps.stage_role = 'open'
  AND ps.stage_role_reviewed_at IS NULL;

-- ─── 3. Fila de revisão master (formato que /master/stage-roles lê:
--        suggested_stage_role + suggested_at + source) ──────────────────────
UPDATE public.pipeline_stages ps SET
  suggested_stage_role         = pl.role_alvo::public.stage_role,
  stage_role_suggested_at      = now(),
  stage_role_suggestion_source = pl.fonte
FROM _s620_plan pl
WHERE ps.id = pl.id
  AND pl.destino = 'queue'
  AND ps.is_active
  AND ps.stage_role = 'open'
  AND ps.stage_role_reviewed_at IS NULL
  AND ps.suggested_stage_role IS NULL;

-- ─── 4. Governado como open (sem sinal nenhum) — carimbo de revisão ─────────
UPDATE public.pipeline_stages ps SET
  stage_role_reviewed_at = now(),
  stage_role_reviewed_by = NULL
FROM _s620_plan pl
WHERE ps.id = pl.id
  AND pl.destino = 'mark_open'
  AND ps.is_active
  AND ps.stage_role = 'open'
  AND ps.stage_role_reviewed_at IS NULL
  AND ps.suggested_stage_role IS NULL;

-- ─── 5. Asserções (abortam a transação inteira se falharem) ─────────────────
DO $$
DECLARE
  v_ungoverned  bigint;
  v_fpos_buraco bigint;
  v_reescrito   bigint;
BEGIN
  -- A1: 0 etapas custom ativas sem role E sem sugestão pendente E sem review.
  SELECT count(*) INTO v_ungoverned
  FROM public.pipeline_stages ps
  JOIN public.pipelines p ON p.id = ps.pipeline_id AND p.type = 'custom'
  WHERE ps.is_active AND ps.stage_role = 'open'
    AND ps.stage_role_reviewed_at IS NULL AND ps.suggested_stage_role IS NULL;
  IF v_ungoverned <> 0 THEN
    RAISE EXCEPTION 'SCRUM-620 A1 FALHOU: % etapas custom ativas seguem sem governança', v_ungoverned;
  END IF;

  -- A2 (venda invisível): 0 final-positivas ativas com role open e sem
  -- sugestão pendente — toda final-positiva termina won, meeting_* (nome
  -- venceu a flag) ou na fila do master.
  SELECT count(*) INTO v_fpos_buraco
  FROM public.pipeline_stages ps
  JOIN public.pipelines p ON p.id = ps.pipeline_id AND p.type = 'custom'
  WHERE ps.is_active AND ps.is_final_positive
    AND ps.stage_role = 'open' AND ps.suggested_stage_role IS NULL;
  IF v_fpos_buraco <> 0 THEN
    RAISE EXCEPTION 'SCRUM-620 A2 FALHOU: % etapas final-positivas ativas sem won nem sugestão', v_fpos_buraco;
  END IF;

  -- A3 (armadilha do trigger): nenhum UPDATE de aplicação foi reescrito.
  SELECT count(*) INTO v_reescrito
  FROM _s620_plan pl
  JOIN public.pipeline_stages ps ON ps.id = pl.id
  WHERE pl.destino = 'apply'
    AND ps.stage_role::text IS DISTINCT FROM pl.role_alvo;
  IF v_reescrito <> 0 THEN
    RAISE EXCEPTION 'SCRUM-620 A3 FALHOU: % linhas aplicadas com stage_role divergente do plano (trigger reescreveu?)', v_reescrito;
  END IF;
END $$;

RESET ROLE;
COMMIT;
