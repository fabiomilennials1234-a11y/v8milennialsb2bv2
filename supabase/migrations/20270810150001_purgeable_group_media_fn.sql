-- Seletor de candidatos à purga do bucket `media`.
--
-- A decisão "este objeto pode morrer?" cruza storage.objects com
-- whatsapp_messages — dois schemas. PostgREST não faz esse join, então a
-- verdade mora aqui, numa função, e o worker só consome nomes. Isso também
-- garante que o worker não possa inventar critério próprio: ele apaga o que
-- esta função devolve, e nada além.
--
-- Duas categorias, ambas comprovadamente sem consumidor no produto:
--   'orphans' — objeto sem nenhuma mensagem apontando para ele (5.434 / 1,4 GB)
--   'groups'  — mídia de mensagem de grupo (149.518 / 40 GB); grupo não gera
--               lead nem alimenta copilot/pipeline (ver whatsapp-webhook)
--
-- NUNCA devolve mídia de conversa individual. O teste pgTAP que acompanha esta
-- migration trava esse contrato.
--
-- Rollback: supabase/migrations/rollback/20270810150001_purgeable_group_media_fn.sql

create or replace function public.list_purgeable_media(
  p_category text,
  p_limit int default 500
)
returns table (object_name text, size_bytes bigint)
language sql
security definer
set search_path = public, storage, pg_temp
as $$
  with msg as (
    select split_part(media_url, '/object/public/media/', 2) as key, is_group
      from public.whatsapp_messages
     where media_url like '%/object/public/media/whatsapp-media/%'
  )
  select o.name, (o.metadata->>'size')::bigint
    from storage.objects o
    left join msg m on m.key = o.name
   where o.bucket_id = 'media'
     and o.name like 'whatsapp-media/%'
     and case p_category
           when 'orphans' then m.key is null
           when 'groups'  then coalesce(m.is_group, false) = true
           else false
         end
   order by o.name
   limit least(greatest(p_limit, 1), 1000);
$$;

-- Purga é operação de sistema. Nenhum usuário final — nem admin de org — chama
-- isto. DROP/CREATE de função reseta EXECUTE para PUBLIC, então o revoke é
-- explícito e vem depois do create.
revoke all on function public.list_purgeable_media(text, int) from public;
revoke all on function public.list_purgeable_media(text, int) from anon;
revoke all on function public.list_purgeable_media(text, int) from authenticated;
grant execute on function public.list_purgeable_media(text, int) to service_role;

comment on function public.list_purgeable_media(text, int) is
  'Candidatos à purga no bucket media: orfaos ou midia de grupo. service_role apenas. Nunca devolve midia de conversa individual.';
