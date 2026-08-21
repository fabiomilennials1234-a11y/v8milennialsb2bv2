-- Deduplicação retroativa do bucket `media`.
--
-- Estado medido em prod (2026-08-10, após a purga de grupo): 60 GB no bucket,
-- dos quais 43 GB são cópias byte-a-byte idênticas — 61.998 arquivos
-- redundantes em 10.159 conteúdos distintos. Um caso real: 1 PDF de 22 MB
-- gravado 299 vezes, uma por destinatário de um disparo.
--
-- A causa foi corrigida no mesmo commit (buildMediaPath, path por hash de
-- conteúdo). Esta migration limpa o passivo.
--
-- ORDEM É TUDO. Aqui repontamos as mensagens para a cópia sobrevivente; só
-- depois o worker apaga as redundantes. Inverter a ordem deixaria o chat do
-- cliente com mídia quebrada no intervalo entre as duas etapas.
--
-- Agrupamento por (org, eTag, size), nunca só por (eTag, size): duas orgs com
-- o mesmo arquivo mantêm cópias separadas. Compartilhar o objeto pouparia
-- bytes e quebraria o isolamento multi-tenant.
--
-- Sobre o eTag: é o MD5 que o S3 grava. Para os 1.146 objetos enviados em
-- multipart o eTag depende do fatiamento, o que pode fazer duas cópias do
-- mesmo arquivo NÃO casarem — perda de oportunidade, não risco. O inverso
-- (arquivos diferentes com mesmo MD5, mesmo tamanho exato e mesma org) é o que
-- causaria dano, e é o que não acontece.
--
-- Rollback: supabase/migrations/rollback/20270810160001_media_dedup_plan.sql

create table if not exists public.media_dedup_plan (
  dup_path     text primary key,
  keeper_path  text not null,
  size_bytes   bigint,
  org_id       text,
  repointed    int,
  created_at   timestamptz not null default now()
);

alter table public.media_dedup_plan enable row level security;
revoke all on table public.media_dedup_plan from public, anon, authenticated;
grant all on table public.media_dedup_plan to service_role;

comment on table public.media_dedup_plan is
  'Plano de deduplicacao do bucket media: cada dup_path aponta para o keeper_path com conteudo identico. repointed = mensagens que tiveram media_url reapontada.';

-- ── 1. Monta o plano ────────────────────────────────────────────────────────
with grp as (
  select split_part(name, '/', 2) as org,
         metadata->>'eTag' as etag,
         (metadata->>'size')::bigint as sz,
         min(name) as keeper
    from storage.objects
   where bucket_id = 'media' and name like 'whatsapp-media/%'
   group by 1, 2, 3
  having count(*) > 1
)
insert into public.media_dedup_plan (dup_path, keeper_path, size_bytes, org_id)
select o.name, g.keeper, (o.metadata->>'size')::bigint, g.org
  from storage.objects o
  join grp g
    on g.org = split_part(o.name, '/', 2)
   and g.etag = o.metadata->>'eTag'
   and g.sz = (o.metadata->>'size')::bigint
 where o.bucket_id = 'media'
   and o.name <> g.keeper
on conflict (dup_path) do nothing;

-- ── 2. Reaponta as mensagens para o sobrevivente ────────────────────────────
-- replace() sobre a URL inteira preserva o domínio real do projeto em vez de
-- reconstruí-lo a partir de uma constante que pode divergir do ambiente.
with upd as (
  update public.whatsapp_messages m
     set media_url = replace(m.media_url, p.dup_path, p.keeper_path)
    from public.media_dedup_plan p
   where split_part(m.media_url, '/object/public/media/', 2) = p.dup_path
  returning p.dup_path
)
update public.media_dedup_plan d
   set repointed = c.n
  from (select dup_path, count(*) as n from upd group by 1) c
 where d.dup_path = c.dup_path;

-- ── 3. Enfileira as redundantes para deleção ────────────────────────────────
alter table public.media_purge_queue drop constraint if exists media_purge_queue_category_check;
alter table public.media_purge_queue add constraint media_purge_queue_category_check
  check (category in ('orphans', 'groups', 'dedup'));

insert into public.media_purge_queue (object_name, size_bytes, category)
select dup_path, size_bytes, 'dedup'
  from public.media_dedup_plan
on conflict (object_name) do nothing;
