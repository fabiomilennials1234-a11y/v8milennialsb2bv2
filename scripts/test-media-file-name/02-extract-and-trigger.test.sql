\set ON_ERROR_STOP 1
-- ── 1. função de extração ────────────────────────────────────────────────
DO $$
DECLARE f text;
BEGIN
  ASSERT public.whatsapp_messages_extract_media_file_name(NULL) IS NULL, 'payload NULL';
  ASSERT public.whatsapp_messages_extract_media_file_name('{}') IS NULL, 'payload vazio';
  ASSERT public.whatsapp_messages_extract_media_file_name('[1,2]') IS NULL, 'payload array';
  ASSERT public.whatsapp_messages_extract_media_file_name('{"content":"texto"}') IS NULL, 'content string';
  ASSERT public.whatsapp_messages_extract_media_file_name('{"content":{"fileName":123}}') = '123', 'fileName numérico vira texto';
  ASSERT public.whatsapp_messages_extract_media_file_name('{"content":{"fileName":"  "}, "document":{"filename":"m.pdf"}}') = 'm.pdf', 'vazio cai no próximo';
  ASSERT public.whatsapp_messages_extract_media_file_name('{"content":{"title":"T.pdf"}}') = 'T.pdf', 'title';
  ASSERT public.whatsapp_messages_extract_media_file_name('{"document":{"filename":"NF.xml"}}') = 'NF.xml', 'meta';
  f := public.whatsapp_messages_extract_media_file_name(jsonb_build_object('content', jsonb_build_object('fileName', repeat('a', 100000))));
  ASSERT length(f) = 255, 'gigante corta em 255';
  ASSERT public.whatsapp_messages_extract_media_file_name(jsonb_build_object('content', jsonb_build_object('fileName', 'fatura' || U&'\202E' || 'fdp.exe'))) = 'faturafdp.exe', 'bidi U+202E';
  ASSERT public.whatsapp_messages_extract_media_file_name(jsonb_build_object('content', jsonb_build_object('fileName', U&'\2066a\200Eb\200F\202Ac\2069.pdf'))) = 'abc.pdf', 'bidi isolates/marks';
  ASSERT public.whatsapp_messages_extract_media_file_name(jsonb_build_object('content', jsonb_build_object('fileName', U&'\202E\200F', 'title', 'B.pdf'))) = 'B.pdf', 'só bidi cai no próximo';
  ASSERT public.whatsapp_messages_extract_media_file_name(jsonb_build_object('content', jsonb_build_object('fileName', 'nota' || chr(7) || chr(31) || chr(127) || E'\n.pdf'))) = 'nota.pdf', 'controle ASCII';
  RAISE NOTICE 'extract: 13 asserts OK';
END $$;

-- ── 2. trigger BEFORE INSERT ─────────────────────────────────────────────
INSERT INTO public.whatsapp_messages(message_type, raw_payload) VALUES
  ('document', jsonb_build_object('content', jsonb_build_object('fileName', 'novo' || U&'\202E' || 'fdp.exe'))),
  ('document', jsonb_build_object('content', jsonb_build_object('fileName', repeat('g', 5000)))),
  ('document', NULL),
  ('image', '{"content":{"fileName":"y.jpg"}}'),
  ('audio', '{"content":{"fileName":"z.ogg"}}');
INSERT INTO public.whatsapp_messages(message_type, raw_payload, media_file_name)
  VALUES ('document', '{"content":{"fileName":"payload.pdf"}}', 'explicito.pdf');
DO $$
BEGIN
  ASSERT (SELECT media_file_name FROM public.whatsapp_messages WHERE raw_payload->'content'->>'fileName' LIKE 'novo%') = 'novofdp.exe', 'trigger bidi';
  ASSERT (SELECT length(media_file_name) FROM public.whatsapp_messages WHERE raw_payload->'content'->>'fileName' LIKE 'ggg%') = 255, 'trigger gigante';
  ASSERT (SELECT count(*) FROM public.whatsapp_messages WHERE message_type IN ('image','audio') AND media_file_name IS NOT NULL) = 0, 'trigger tipo errado';
  ASSERT (SELECT media_file_name FROM public.whatsapp_messages WHERE raw_payload->'content'->>'fileName' = 'payload.pdf') = 'explicito.pdf', 'trigger respeita valor explícito';
  ASSERT (SELECT count(*) FROM public.whatsapp_messages WHERE created_at > now() - interval '1 minute' AND message_type='document' AND raw_payload IS NULL AND media_file_name IS NOT NULL) = 0, 'trigger payload NULL';
  -- linhas antigas NÃO foram tocadas pela migration (backfill saiu dela)
  ASSERT (SELECT count(*) FROM public.whatsapp_messages WHERE created_at < now() - interval '30 minutes' AND media_file_name IS NOT NULL) = 0, 'migration não faz backfill';
  RAISE NOTICE 'trigger: 6 asserts OK';
END $$;
