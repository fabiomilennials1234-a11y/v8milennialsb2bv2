\set ON_ERROR_STOP 1
DO $$
BEGIN
  ASSERT (SELECT media_file_name FROM public.whatsapp_messages WHERE raw_payload->'content'->>'fileName' = 'Pedido JURERE - 03.10.26.pdf') = 'Pedido JURERE - 03.10.26.pdf', 'backfill uazapi';
  ASSERT (SELECT media_file_name FROM public.whatsapp_messages WHERE raw_payload->'content'->>'title' = '  Contrato.docx ') = 'Contrato.docx', 'backfill title (outgoing)';
  ASSERT (SELECT media_file_name FROM public.whatsapp_messages WHERE raw_payload->'document'->>'filename' = 'NF.xml') = 'NF.xml', 'backfill meta';
  ASSERT (SELECT media_file_name FROM public.whatsapp_messages WHERE raw_payload->'content'->>'fileName' = 'velho.pdf') IS NULL, 'fora da janela de 15 dias não é tocado';
  ASSERT (SELECT media_file_name FROM public.whatsapp_messages WHERE message_type = 'image' AND raw_payload->'content'->>'fileName' = 'x.jpg') IS NULL, 'imagem não é tocada';
  ASSERT (SELECT media_file_name FROM public.whatsapp_messages WHERE raw_payload->'content'->>'fileName' = 'payload.pdf') = 'explicito.pdf', 'backfill não sobrescreve';
  RAISE NOTICE 'backfill: 6 asserts OK';
END $$;
-- tabela de teste é minúscula: desliga seq scan só para provar que o predicado casa o índice
SET enable_seqscan = off;
EXPLAIN (COSTS OFF) UPDATE public.whatsapp_messages SET media_file_name = 'x'
 WHERE direction IN ('incoming','outgoing') AND created_at >= now() - interval '2 hours' AND created_at < now() - interval '1 hour'
   AND message_type = 'document' AND media_file_name IS NULL AND (raw_payload ? 'content' OR raw_payload ? 'document');
