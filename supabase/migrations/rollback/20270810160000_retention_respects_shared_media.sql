-- Rollback de 20270810160000_retention_respects_shared_media.sql
--
-- PERIGO: só reverta junto com o path por hash (buildMediaPath). Enquanto o
-- path for derivado do conteúdo, esta versão antiga apaga objeto ainda
-- referenciado por mensagem recente e quebra mídia viva no chat.

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
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'path', name,
      'size', coalesce((metadata ->> 'size')::bigint, 0)
    )),
    '[]'::jsonb
  )
  from (
    select name, metadata
    from storage.objects
    where bucket_id = 'media'
      and name like 'whatsapp-media/%'
      and created_at < now() - make_interval(days => greatest(p_older_than_days, 0))
    order by created_at asc
    limit least(greatest(p_limit, 0), 5000)
  ) s;
$function$;
