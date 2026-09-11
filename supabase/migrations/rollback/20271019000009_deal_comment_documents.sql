-- Rollback only before real attachments exist; never discard user documents.
BEGIN;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.lead_comments WHERE attachments <> '[]'::jsonb)
 OR EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='deal-comment-documents') THEN
  RAISE EXCEPTION 'Rollback recusado: documentos existentes. Preserve os dados.';
 END IF;
END $$;
DROP TRIGGER validate_deal_comment_documents ON public.lead_comments;
DROP FUNCTION public.validate_deal_comment_documents();
DROP POLICY deal_comment_documents_cleanup ON storage.objects;
DROP POLICY deal_comment_documents_select ON storage.objects;
DROP POLICY deal_comment_documents_insert ON storage.objects;
DROP FUNCTION public.deal_document_path_id(text, integer);
DELETE FROM storage.buckets WHERE id='deal-comment-documents';
ALTER TABLE public.lead_comments DROP COLUMN attachments;
COMMIT;
