-- ============================================================================
-- copilot-handoff-backfill-20271120.sql
--
-- Backfill do estado de handoff (H2, diagnóstico de 2026-10-13).
--
-- NÃO é migration (guarda F4 da CLAUDE.md raiz: migration é só schema;
-- scripts/db-push-branch.sh recusa DML em migration pendente). Escreve dado de
-- cliente — vive aqui para que um apply com alvo errado vire erro de schema
-- recuperável, e para que a ORDEM abaixo seja decidida por um humano.
--
-- ── ORDEM OBRIGATÓRIA ──────────────────────────────────────────────────────
--   (1) Aplicar a migration 20271120000000_copilot_handoff_disabled_reason.sql
--       (coluna phone_ai_preferences.disabled_reason + trigger/RPC novos).
--   (2) Deployar as 5 edges do mesmo diff: agent-message, whatsapp-webhook,
--       copilot-batch-processor, recover-stuck-conversations, sz-chat-webhook.
--   (3) Ensaio transacional contra prod: rodar este arquivo com o COMMIT final
--       trocado por ROLLBACK e ler o NOTICE (B1/B2a/B2b/travados_restantes):
--         sed 's/^COMMIT;$/ROLLBACK;/' scripts/copilot-handoff-backfill-20271120.sql \
--           > /tmp/copilot-handoff-ensaio.sql
--       GUARDA DO OPERADOR — antes de enviar, conferir o arquivo gerado:
--         grep -cx 'ROLLBACK;' /tmp/copilot-handoff-ensaio.sql   # tem que dar 1
--         grep -cx 'COMMIT;'   /tmp/copilot-handoff-ensaio.sql   # tem que dar 0
--       Qualquer outro resultado → NÃO rodar (o ensaio escreveria em prod).
--       Rodar SEMPRE com parada no primeiro erro (sem ela, o psql segue após
--       um erro e o COMMIT/ROLLBACK final age sobre transação abortada):
--         psql "$DB_URL" -v ON_ERROR_STOP=1 -f /tmp/copilot-handoff-ensaio.sql
--       Contagens medidas em prod 13/10: B1=349 B2a=118 B2b=26, travados=0
--       depois. Divergência grande → parar e reinvestigar.
--   (4) Aplicar este arquivo como está (BEGIN … COMMIT), também com
--       psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/copilot-handoff-backfill-20271120.sql
--   (5) Conferir em prod a ACL da RPC transfer_lead_to_human:
--         SELECT r, has_function_privilege(r, 'public.transfer_lead_to_human(uuid)', 'EXECUTE')
--         FROM unnest(ARRAY['anon','authenticated','service_role']) r;
--       Esperado igual ao de antes da migration (CREATE OR REPLACE preserva ACL;
--       DROP+CREATE resetaria — memória drop-create-function-reseta-grants).
--
-- POR QUE A ORDEM IMPORTA: a edge ANTIGA (whatsapp-webhook / sz-chat-webhook)
-- religa a IA no inbound para toda preferência desligada sem usuário
-- (set_by NULL, #839) e não conhece disabled_reason. Backfill antes do deploy
-- (2) = no próximo inbound a edge antiga religa exatamente as linhas que B1 e
-- B2a marcaram 'handoff' — o backfill se desfaz em silêncio e o lead volta a
-- receber IA no meio do atendimento humano. Sem a migration (1), o script nem
-- roda (coluna ausente). Sem o ensaio (3), não há prova das contagens antes de
-- escrever.
--
-- ── O QUE FAZ ──────────────────────────────────────────────────────────────
-- Três correções, cada uma com a guarda NA PRÓPRIA QUERY (rodar 2× = mesmo
-- resultado; nada depende de contagem prévia):
--
--   B1  Preferência desligada sem usuário cujo lead (o mais recente vivo do
--       telefone) foi desligado por transferência (ai_disabled e
--       ai_disabled_at preenchido — o bulk REALSC de 28/05 não gravou _at):
--       disabled_reason = 'handoff'. Sem isto a religação no inbound seguiria
--       religando esses contatos. Prod 13/10: 349.
--
--   B2a Leads "travados" (lead ai_disabled=true, preferência ligada) com
--       conversa em WAITING_HUMAN e desligamento do lead POSTERIOR à última
--       mudança da preferência: a transferência é o fato mais recente → a
--       preferência passa a desligada, 'handoff', set_at = leads.ai_disabled_at.
--       Prod 13/10: 118.
--
--   B2b Demais travados (sem WAITING_HUMAN, ou desligamento do lead anterior à
--       preferência): a preferência é o fato mais recente → o lead se alinha a
--       ela (ai_disabled=false, ai_disabled_at=NULL). O trigger
--       sync_lead_ai_to_preferences reescreve a preferência (já ligada) com
--       set_at=now() e motivo NULL — efeito colateral aceito. Prod 13/10: 26.
--
-- Cópia integral das linhas tocadas (antes da escrita) em
-- backup.copilot_handoff_backfill_20271120 — sem grant para ninguém.
-- Transação única: o bloco de verificação no fim aborta tudo (RAISE) se
-- sobrar lead travado. Sem meia-carga.

BEGIN;

CREATE SCHEMA IF NOT EXISTS backup;  -- existe em prod; banco novo depende de 20260916164400
CREATE TABLE IF NOT EXISTS backup.copilot_handoff_backfill_20271120 (
  id          bigserial PRIMARY KEY,
  step        text        NOT NULL CHECK (step IN ('B1', 'B2a', 'B2b')),
  table_name  text        NOT NULL,
  row_before  jsonb       NOT NULL,
  backed_at   timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON backup.copilot_handoff_backfill_20271120 FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE backup.copilot_handoff_backfill_20271120_id_seq FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE backup.copilot_handoff_backfill_20271120 IS
  'Estado anterior das linhas tocadas por scripts/copilot-handoff-backfill-20271120.sql (handoff pegajoso).';

-- ── B1 ───────────────────────────────────────────────────────────────────────
WITH alvo AS (
  SELECT p.organization_id, p.normalized_phone
  FROM public.phone_ai_preferences p
  CROSS JOIN LATERAL (
    SELECT l.ai_disabled, l.ai_disabled_at
    FROM public.leads l
    WHERE l.organization_id = p.organization_id
      AND l.normalized_phone = p.normalized_phone
      AND l.deleted_at IS NULL
    ORDER BY l.created_at DESC
    LIMIT 1
  ) recente
  WHERE p.ai_disabled
    AND p.set_by IS NULL
    AND p.disabled_reason IS NULL
    AND recente.ai_disabled
    AND recente.ai_disabled_at IS NOT NULL
),
copia AS (
  INSERT INTO backup.copilot_handoff_backfill_20271120 (step, table_name, row_before)
  SELECT 'B1', 'phone_ai_preferences', to_jsonb(p)
  FROM public.phone_ai_preferences p
  JOIN alvo a USING (organization_id, normalized_phone)
  RETURNING 1
)
UPDATE public.phone_ai_preferences p
SET disabled_reason = 'handoff'
FROM alvo a
WHERE p.organization_id = a.organization_id
  AND p.normalized_phone = a.normalized_phone
  -- guarda repetida no alvo da escrita (idempotência sem depender do CTE)
  AND p.ai_disabled
  AND p.set_by IS NULL
  AND p.disabled_reason IS NULL;

-- ── B2a ──────────────────────────────────────────────────────────────────────
WITH alvo AS (
  SELECT DISTINCT ON (p.organization_id, p.normalized_phone)
    p.organization_id, p.normalized_phone, l.ai_disabled_at
  FROM public.phone_ai_preferences p
  JOIN public.leads l
    ON l.organization_id = p.organization_id
   AND l.normalized_phone = p.normalized_phone
  WHERE NOT p.ai_disabled
    AND l.deleted_at IS NULL
    AND l.ai_disabled
    AND l.ai_disabled_at IS NOT NULL
    AND l.ai_disabled_at > p.set_at
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.lead_id = l.id AND c.state = 'WAITING_HUMAN'
    )
  ORDER BY p.organization_id, p.normalized_phone, l.ai_disabled_at DESC
),
copia AS (
  INSERT INTO backup.copilot_handoff_backfill_20271120 (step, table_name, row_before)
  SELECT 'B2a', 'phone_ai_preferences', to_jsonb(p)
  FROM public.phone_ai_preferences p
  JOIN alvo a USING (organization_id, normalized_phone)
  RETURNING 1
)
UPDATE public.phone_ai_preferences p
SET ai_disabled = true,
    disabled_reason = 'handoff',
    set_at = a.ai_disabled_at
FROM alvo a
WHERE p.organization_id = a.organization_id
  AND p.normalized_phone = a.normalized_phone
  AND NOT p.ai_disabled;

-- ── B2b ──────────────────────────────────────────────────────────────────────
-- Roda DEPOIS de B2a: os telefones de B2a já têm a preferência desligada e
-- ficam fora pela própria guarda `NOT p.ai_disabled`.
WITH alvo AS (
  SELECT l.id
  FROM public.leads l
  JOIN public.phone_ai_preferences p
    ON p.organization_id = l.organization_id
   AND p.normalized_phone = l.normalized_phone
  WHERE l.deleted_at IS NULL
    AND l.ai_disabled
    AND NOT p.ai_disabled
    AND NOT (
      l.ai_disabled_at IS NOT NULL
      AND l.ai_disabled_at > p.set_at
      AND EXISTS (
        SELECT 1 FROM public.conversations c
        WHERE c.lead_id = l.id AND c.state = 'WAITING_HUMAN'
      )
    )
),
copia AS (
  INSERT INTO backup.copilot_handoff_backfill_20271120 (step, table_name, row_before)
  SELECT 'B2b', 'leads',
         jsonb_build_object('id', l.id, 'organization_id', l.organization_id,
                            'normalized_phone', l.normalized_phone, 'ai_disabled', l.ai_disabled,
                            'ai_disabled_at', l.ai_disabled_at, 'ai_disabled_by', l.ai_disabled_by)
  FROM public.leads l
  JOIN alvo a ON a.id = l.id
  RETURNING 1
)
UPDATE public.leads l
SET ai_disabled = false,
    ai_disabled_at = NULL
FROM alvo a
WHERE l.id = a.id
  AND l.ai_disabled;

-- ── Verificação ──────────────────────────────────────────────────────────────
-- Aborta a transação se sobrar lead travado; NOTICE com as contagens do backup
-- (cumulativas — a 2ª execução não acrescenta linha, prova da idempotência).
DO $$
DECLARE
  v_travados int;
  v_b1 int; v_b2a int; v_b2b int;
BEGIN
  SELECT count(*) INTO v_travados
  FROM public.leads l
  JOIN public.phone_ai_preferences p
    ON p.organization_id = l.organization_id AND p.normalized_phone = l.normalized_phone
  WHERE l.deleted_at IS NULL AND l.ai_disabled AND NOT p.ai_disabled;

  SELECT count(*) FILTER (WHERE step = 'B1'),
         count(*) FILTER (WHERE step = 'B2a'),
         count(*) FILTER (WHERE step = 'B2b')
    INTO v_b1, v_b2a, v_b2b
  FROM backup.copilot_handoff_backfill_20271120;  -- cumulativo: 2ª execução não acrescenta

  RAISE NOTICE 'copilot_handoff_backfill: B1=% B2a=% B2b=% travados_restantes=%',
    v_b1, v_b2a, v_b2b, v_travados;

  IF v_travados <> 0 THEN
    RAISE EXCEPTION 'copilot_handoff_backfill: % lead(s) ainda travado(s) após o backfill', v_travados;
  END IF;
END;
$$;

COMMIT;
