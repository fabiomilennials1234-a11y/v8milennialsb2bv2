-- ============================================================================
-- Copilot v2 — Slice 6: send-media ganha kind 'audio' (ptt) [Emenda ADR §1]
-- + bucket de storage privado org-scoped para a send-media library.
--
-- Estende o enum criado em 20260531214954 (imutável). Acervo de KNOWLEDGE
-- (copilot_v2_knowledge) NÃO é tocado — acervos são separados (ADR #12).
-- committed-not-applied: aplicar em dev via MCP só após pre-check da fundação.
-- PROD proibido sem autorização CTO.
-- ============================================================================

-- (a) Adiciona 'audio' ao enum da send-media library (idempotente).
do $$ begin
  if not exists (
    select 1 from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'copilot_v2_media_kind' and e.enumlabel = 'audio'
  ) then
    alter type public.copilot_v2_media_kind add value 'audio';
  end if;
end $$;

-- (b) Bucket privado dedicado à send-media library (org-scoped por path).
--     Privado (public=false) — entrega ao lead via signed URL no send_media.
--     MIME allow-list cobre os 3 tipos (image/video/audio-ptt ogg/opus).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'copilot-v2-send-media',
  'copilot-v2-send-media',
  false,
  26214400, -- 25MB
  array[
    'image/jpeg','image/png','image/webp',
    'video/mp4','video/webm',
    'audio/ogg','audio/ogg; codecs=opus','audio/mpeg','audio/mp4','audio/aac'
  ]
)
on conflict (id) do nothing;

-- Storage policies: leitura/escrita só autenticado, escopo org pelo 1º segmento
-- do path (= organization_id). service_role bypassa RLS (worker gera signed URL).
do $$ begin
  create policy "copilot_v2_send_media_read" on storage.objects
    for select to authenticated
    using (
      bucket_id = 'copilot-v2-send-media'
      and (storage.foldername(name))[1] in (select get_my_organization_ids()::text)
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "copilot_v2_send_media_write" on storage.objects
    for insert to authenticated
    with check (
      bucket_id = 'copilot-v2-send-media'
      and (storage.foldername(name))[1] in (select get_my_organization_ids()::text)
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "copilot_v2_send_media_delete" on storage.objects
    for delete to authenticated
    using (
      bucket_id = 'copilot-v2-send-media'
      and (storage.foldername(name))[1] in (select get_my_organization_ids()::text)
    );
exception when duplicate_object then null; end $$;
