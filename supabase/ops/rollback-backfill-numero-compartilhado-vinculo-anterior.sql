-- Rollback de supabase/ops/backfill-numero-compartilhado-vinculo-anterior.sql
--
-- Desfaz SÓ o que o backfill gravou (trilha em private.backfill_numero_compartilhado_*):
-- volta lead_id a NULL nas mensagens e resumos que ele vinculou e que ainda têm
-- o MESMO lead (se alguém revinculou depois, a linha fica como está).
-- UPDATE de lead_id para NULL não dispara efeito: os gatilhos AFTER UPDATE OF
-- lead_id (first_human_outbound_stage, riofix_proposal) saem cedo com lead NULL.

BEGIN;
SET LOCAL lock_timeout = '5s';

UPDATE public.whatsapp_messages m
   SET lead_id = NULL
  FROM private.backfill_numero_compartilhado_mensagens b
 WHERE m.id = b.message_id
   AND m.lead_id = b.lead_id;

UPDATE public.whatsapp_conversation_summary s
   SET lead_id = NULL,
       updated_at = now()
  FROM private.backfill_numero_compartilhado_resumos b
 WHERE s.organization_id = b.organization_id
   AND s.instance_id = b.instance_id
   AND s.normalized_phone = b.normalized_phone
   AND s.lead_id = b.lead_id;

DROP TABLE IF EXISTS private.backfill_numero_compartilhado_mensagens;
DROP TABLE IF EXISTS private.backfill_numero_compartilhado_resumos;

COMMIT;
