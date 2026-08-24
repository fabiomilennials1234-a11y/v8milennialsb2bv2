-- ============================================================================
-- ROLLBACK de 20270823000000_blast_recipient_delivery_state.sql (#1721)
--
-- Mesmo nome do arquivo que reverte, como manda o diretório rollback/.
-- Devolve a tabela à forma medida em 2026-08-23 no baseline de produção
-- (20260101000000_baseline_prod_schema.sql:21877-21896).
--
-- SEGURO PORQUE A MIGRATION É INERTE: as seis colunas nascem NULL e ninguém
-- escreve nelas nesta fatia, então derrubá-las não perde dado nenhum. Se algum
-- slice posterior já estiver gravando entrega ou custo, ESTE arquivo deixa de
-- ser seguro — e aí o revert é migration nova, não este.
--
-- Executado e provado dentro do ensaio transacional (scripts/ensaio-1721.sh,
-- asserções 12 a 14), como exige o preflight de aplicar-migration-prod.md.
-- ============================================================================

DROP INDEX IF EXISTS public.idx_blast_plan_recipients_provider_message_id;

ALTER TABLE public.blast_plan_recipients
  DROP COLUMN IF EXISTS sent_at,
  DROP COLUMN IF EXISTS delivered_at,
  DROP COLUMN IF EXISTS claimed_at,
  DROP COLUMN IF EXISTS provider_message_id,
  DROP COLUMN IF EXISTS estimated_cost,
  DROP COLUMN IF EXISTS actual_cost;

ALTER TABLE public.blast_plan_recipients
  DROP CONSTRAINT IF EXISTS blast_plan_recipients_status_check;

ALTER TABLE public.blast_plan_recipients
  ADD CONSTRAINT blast_plan_recipients_status_check
  CHECK (status IN ('pending', 'sent', 'skipped', 'failed'));

-- VERBATIM do comentário vivo, copiado de
-- 20260101000000_baseline_prod_schema.sql:21896. Um rollback que devolve o
-- comentário pela metade não devolveu a tabela ao que ela era — e a asserção 13
-- do ensaio compara índices, constraints, colunas, policies e grants, NÃO
-- comentários, então ela passaria por cima desta perda. Achado do /code-review.
COMMENT ON COLUMN public.blast_plan_recipients.status IS
  'pending | sent | skipped | failed. `sent` = accepted by the sending queue at dispatch (optimistic, ADR-0016 §4); the mass-send-status poll may reclassify it to `failed` when the provider reports a delivery failure, with `reason` = canonical failure code.';
