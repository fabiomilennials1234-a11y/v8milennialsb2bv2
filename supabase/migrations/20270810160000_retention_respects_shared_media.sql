-- Retenção passa a respeitar objeto compartilhado por várias mensagens.
--
-- NECESSÁRIO por causa do path por hash de conteúdo (buildMediaPath, mesmo
-- commit): o mesmo binário agora resolve para um único objeto, então N
-- mensagens podem apontar para ele. Antes, path era derivado do message_id e a
-- relação era 1:1 — apagar por idade do objeto era seguro.
--
-- Com 1:N vira armadilha concreta:
--   1. catálogo enviado em janeiro grava o objeto
--   2. mesmo catálogo reenviado em março cai no MESMO path (upsert), e o
--      created_at do objeto continua sendo o de janeiro
--   3. retenção de 30 dias olha created_at, acha "velho", apaga
--   4. a mensagem de março fica com mídia quebrada
--
-- A correção troca "objeto velho" por "objeto cuja referência mais recente
-- também é velha". Um objeto só expira quando nenhuma mensagem dentro da
-- janela de retenção ainda aponta para ele.
--
-- A correção mora na RPC, e não na edge function, de propósito: a versão
-- rodando em prod e a versão do repo divergem (90 vs 30 dias) mas chamam esta
-- mesma função. Consertar aqui protege as duas sem deployar nenhuma delas nem
-- alterar, de carona, a janela de retenção vigente.
--
-- Rollback: supabase/migrations/rollback/20270810160000_retention_respects_shared_media.sql

create or replace function public.list_expired_whatsapp_media(
  p_older_than_days integer default 30,
  p_limit integer default 200
)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'extensions'
as $function$
  with cutoff as (
    select now() - make_interval(days => greatest(p_older_than_days, 0)) as t
  ),
  -- Referência mais recente de cada objeto. Uma mensagem nova apontando para
  -- um objeto antigo mantém o objeto vivo.
  last_ref as (
    select split_part(media_url, '/object/public/media/', 2) as key,
           max(timestamp) as last_ts
      from public.whatsapp_messages
     where media_url like '%/object/public/media/whatsapp-media/%'
     group by 1
  )
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'path', s.name,
      'size', coalesce((s.metadata ->> 'size')::bigint, 0)
    )),
    '[]'::jsonb
  )
  from (
    select o.name, o.metadata
      from storage.objects o
      left join last_ref r on r.key = o.name
     cross join cutoff c
     where o.bucket_id = 'media'
       and o.name like 'whatsapp-media/%'
       and o.created_at < c.t
       and (r.last_ts is null or r.last_ts < c.t)
     order by o.created_at asc
     limit least(greatest(p_limit, 0), 5000)
  ) s;
$function$;

-- DROP/CREATE não ocorreu (CREATE OR REPLACE preserva grants), mas o estado
-- correto é reafirmado: esta função é chamada pela edge function com
-- service_role e não deve estar exposta ao cliente.
revoke all on function public.list_expired_whatsapp_media(integer, integer) from public;
revoke all on function public.list_expired_whatsapp_media(integer, integer) from anon;
revoke all on function public.list_expired_whatsapp_media(integer, integer) from authenticated;
grant execute on function public.list_expired_whatsapp_media(integer, integer) to service_role;

comment on function public.list_expired_whatsapp_media(integer, integer) is
  'Candidatos a expiracao de midia do WhatsApp. Desde 2026-08-10 exclui objeto ainda referenciado por mensagem dentro da janela de retencao - o path virou hash de conteudo e um objeto serve N mensagens.';
