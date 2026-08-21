-- Fila materializada de purga do bucket `media`.
--
-- Substitui a varredura ao vivo de list_purgeable_media: aquele join cruzava
-- ~546k mensagens com ~260k objetos A CADA LOTE e estourava o statement timeout
-- do PostgREST (medido: 500 "canceling statement due to statement timeout").
-- Materializar uma vez e paginar por chave primária resolve, e de quebra deixa
-- trilha do que foi apagado — deleção de Storage é irreversível e merece
-- registro.
--
-- A fila é um SNAPSHOT: o que entra aqui foi classificado como purgável no
-- momento da montagem. O worker não reclassifica nada, só consome.
--
-- Rollback: supabase/migrations/rollback/20270810150002_media_purge_queue.sql

create table if not exists public.media_purge_queue (
  object_name text primary key,
  size_bytes  bigint,
  category    text not null check (category in ('orphans', 'groups')),
  queued_at   timestamptz not null default now(),
  purged_at   timestamptz,
  last_error  text
);

-- Paginação do worker: pendentes de uma categoria, em ordem estável.
create index if not exists idx_media_purge_queue_pending
  on public.media_purge_queue (category, object_name)
  where purged_at is null;

-- Tabela de sistema. RLS ligada sem policy nenhuma = deny-all para anon e
-- authenticated; service_role passa por cima, que é quem o worker usa.
alter table public.media_purge_queue enable row level security;

revoke all on table public.media_purge_queue from public;
revoke all on table public.media_purge_queue from anon;
revoke all on table public.media_purge_queue from authenticated;
grant all on table public.media_purge_queue to service_role;

comment on table public.media_purge_queue is
  'Snapshot dos objetos do bucket media marcados para purga (orfaos + midia de grupo). Populada em 2026-08-10. purged_at carimba a remocao efetiva no Storage.';

-- Popula o snapshot. Roda dentro do banco, onde o join custa segundos.
-- ON CONFLICT DO NOTHING mantém idempotência: reaplicar não duplica nem
-- ressuscita linha já purgada.
--
-- SÓ 'groups'. A categoria 'orphans' foi projetada e DESCARTADA no dry-run de
-- 2026-08-10, e o motivo vale registro porque o critério parecia óbvio:
-- "nenhuma whatsapp_messages.media_url aponta para este objeto" NÃO significa
-- "ninguém precisa dele". Dos 5.434 candidatos, os 5.386 no padrão do
-- downloader tinham mensagem viva — 5.386 de 5.386, nenhuma de grupo — apenas
-- com media_url apontando para outro lugar. Os outros 48 eram áudio gravado
-- pelo vendedor no chat (ChatBubbleComposer), outro produtor com outra
-- convenção de path. Purgar aquilo teria apagado mídia de conversa individual,
-- exatamente o que esta fila promete nunca tocar.
--
-- Reabilitar 'orphans' exige um critério que prove ausência de consumidor em
-- TODOS os produtores do bucket, não só no downloader do webhook.
with msg as (
  select split_part(media_url, '/object/public/media/', 2) as key, is_group
    from public.whatsapp_messages
   where media_url like '%/object/public/media/whatsapp-media/%'
)
insert into public.media_purge_queue (object_name, size_bytes, category)
select o.name,
       (o.metadata->>'size')::bigint,
       'groups'
  from storage.objects o
  join msg m on m.key = o.name
 where o.bucket_id = 'media'
   and o.name like 'whatsapp-media/%'
   and coalesce(m.is_group, false) = true
on conflict (object_name) do nothing;

-- Seletor do worker: barato, indexado, sem join.
create or replace function public.claim_purge_batch(
  p_category text,
  p_limit int default 200
)
returns table (object_name text, size_bytes bigint)
language sql
security definer
set search_path = public, pg_temp
as $$
  select q.object_name, q.size_bytes
    from public.media_purge_queue q
   where q.category = p_category
     and q.purged_at is null
   order by q.object_name
   limit least(greatest(p_limit, 1), 500);
$$;

-- Carimba o lote como removido do Storage.
create or replace function public.mark_purged(p_names text[])
returns int
language sql
security definer
set search_path = public, pg_temp
as $$
  with upd as (
    update public.media_purge_queue
       set purged_at = now()
     where object_name = any(p_names)
       and purged_at is null
    returning 1
  )
  select count(*)::int from upd;
$$;

revoke all on function public.claim_purge_batch(text, int) from public;
revoke all on function public.claim_purge_batch(text, int) from anon;
revoke all on function public.claim_purge_batch(text, int) from authenticated;
grant execute on function public.claim_purge_batch(text, int) to service_role;

revoke all on function public.mark_purged(text[]) from public;
revoke all on function public.mark_purged(text[]) from anon;
revoke all on function public.mark_purged(text[]) from authenticated;
grant execute on function public.mark_purged(text[]) to service_role;

-- Aposenta o seletor por varredura (20270810150001): não tem mais consumidor e
-- deixá-lo vivo é convite a alguém rodar o join caro de novo.
drop function if exists public.list_purgeable_media(text, int);
