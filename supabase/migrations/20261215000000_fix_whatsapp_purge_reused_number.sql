-- 20261215000000_fix_whatsapp_purge_reused_number.sql
--
-- FIX DE PERDA DE DADOS — cron `purge-deleted-whatsapp-conversations` (jobid 6,
-- criado em 20260330000000). Incidente 2026-06-12 (org Bertin, lead reusando
-- número): o purge apagava mensagens por `(instance_id, phone_number)` de
-- conversas soft-deletadas há +30 dias, SEM comparar o timestamp da mensagem
-- com o `deleted_at` da conversa.
--
-- Consequência: quando um número cujo histórico foi soft-deletado volta a
-- conversar (lead novo reusa o telefone, ou o contato retorna), o próximo run
-- noturno (03:00 UTC) apagava TODO o histórico daquele número/instância —
-- inclusive as mensagens NOVAS, que não tinham relação com a conversa excluída.
-- E o 2º statement deletava a própria conversa soft-deletada, fazendo a
-- evidência se autodestruir.
--
-- Correção:
--   1. Só apagar mensagens ANTERIORES ao delete (`timestamp <= deleted_at`).
--      Mensagens posteriores pertencem a uma "nova vida" do número e são
--      preservadas.
--   2. Só apagar o registro de conversa soft-deletada quando o número NÃO
--      voltou (sem mensagens posteriores ao delete). Se voltou, o registro é
--      mantido — sem perda de dados e sem reescrever a semântica de "excluída"
--      (o reaparecimento na lista é follow-up de produto, fora deste hotfix).
--
-- Reaplica o mesmo cron name → cron.schedule faz upsert do job (mesmo jobid).

DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'purge-deleted-whatsapp-conversations',
      '0 3 * * *',
      $$
        -- 1. Apagar SÓ as mensagens anteriores/iguais ao momento do delete.
        --    Preserva histórico novo de número reusado (timestamp > deleted_at).
        DELETE FROM public.whatsapp_messages m
        USING public.whatsapp_conversations c
        WHERE c.deleted_at IS NOT NULL
          AND c.deleted_at < now() - interval '30 days'
          AND m.instance_id  = c.instance_id
          AND m.phone_number = c.phone_number
          AND m."timestamp" <= c.deleted_at;

        -- 2. Apagar o registro de conversa SÓ quando o número não voltou
        --    (nenhuma mensagem posterior ao delete). CASCADE limpa as tags.
        --    Se houver mensagens novas, o registro é mantido (sem perda).
        DELETE FROM public.whatsapp_conversations c
        WHERE c.deleted_at IS NOT NULL
          AND c.deleted_at < now() - interval '30 days'
          AND NOT EXISTS (
            SELECT 1 FROM public.whatsapp_messages m
            WHERE m.instance_id  = c.instance_id
              AND m.phone_number = c.phone_number
              AND m."timestamp" > c.deleted_at
          );
      $$
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END
$outer$;
