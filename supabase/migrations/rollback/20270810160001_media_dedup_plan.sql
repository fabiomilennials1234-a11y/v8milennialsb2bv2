-- Rollback de 20270810160001_media_dedup_plan.sql
--
-- NÃO desfaz o reapontamento das mensagens, e isso é intencional: o keeper tem
-- conteúdo byte-a-byte idêntico ao que a mensagem apontava antes, então a URL
-- nova serve exatamente o mesmo arquivo. Reverter para o path original só faria
-- sentido se as cópias ainda existissem — e depois da purga elas não existem.
--
-- Remove apenas a fila de deleção pendente e o plano.

delete from public.media_purge_queue where category = 'dedup' and purged_at is null;

alter table public.media_purge_queue drop constraint if exists media_purge_queue_category_check;
alter table public.media_purge_queue add constraint media_purge_queue_category_check
  check (category in ('orphans', 'groups'));

drop table if exists public.media_dedup_plan;
