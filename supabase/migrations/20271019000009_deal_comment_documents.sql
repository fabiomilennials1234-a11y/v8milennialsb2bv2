-- Private documents belong to the immutable comment/entry/author identity.
ALTER TABLE public.lead_comments ADD COLUMN attachments jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.lead_comments ADD CONSTRAINT lead_comment_attachments_array
  CHECK (jsonb_typeof(attachments) = 'array' AND jsonb_array_length(attachments) <= 5);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('deal-comment-documents', 'deal-comment-documents', false, 20971520, ARRAY[
 'application/pdf','application/msword',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
 'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
 'text/plain','text/csv','image/png','image/jpeg','image/webp']);

-- Invalid paths must return NULL, not break reads of unrelated buckets.
CREATE FUNCTION public.deal_document_path_id(path text, segment integer) RETURNS uuid
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
 SELECT CASE WHEN split_part(path, '/', segment) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 THEN split_part(path, '/', segment)::uuid ELSE NULL END
$$;
REVOKE ALL ON FUNCTION public.deal_document_path_id(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deal_document_path_id(text, integer) TO authenticated;

CREATE POLICY deal_comment_documents_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
 bucket_id = 'deal-comment-documents'
 AND split_part(name, '/', 3) = (SELECT auth.uid())::text
 AND array_length(string_to_array(name, '/'), 1) = 5
 AND EXISTS (SELECT 1 FROM public.pipeline_entries e
   WHERE e.id = public.deal_document_path_id(name, 2) AND e.organization_id::text = split_part(name, '/', 1)
     AND (e.organization_id IN (SELECT public.get_my_organization_ids()) OR (SELECT public.is_master_user())))
 AND NOT EXISTS (SELECT 1 FROM public.lead_comments c WHERE c.id = public.deal_document_path_id(name, 4))
);

CREATE POLICY deal_comment_documents_select ON storage.objects FOR SELECT TO authenticated
USING (
 bucket_id = 'deal-comment-documents' AND (
   EXISTS (SELECT 1 FROM public.lead_comments c
     WHERE c.id = public.deal_document_path_id(name, 4) AND c.deleted_at IS NULL
       AND c.organization_id::text = split_part(name, '/', 1)
       AND c.attachments @> jsonb_build_array(jsonb_build_object('path', name)))
   OR (split_part(name, '/', 3) = (SELECT auth.uid())::text
     AND EXISTS (SELECT 1 FROM public.pipeline_entries e
       WHERE e.id = public.deal_document_path_id(name, 2) AND e.organization_id::text = split_part(name, '/', 1)
         AND (e.organization_id IN (SELECT public.get_my_organization_ids()) OR (SELECT public.is_master_user())))
     AND NOT EXISTS (SELECT 1 FROM public.lead_comments c WHERE c.id = public.deal_document_path_id(name, 4)))
 )
);

-- Published files are retained with their soft-deleted comment, not destructively removed.
CREATE POLICY deal_comment_documents_cleanup ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'deal-comment-documents'
 AND split_part(name, '/', 3) = (SELECT auth.uid())::text
 AND NOT EXISTS (SELECT 1 FROM public.lead_comments c WHERE c.id = public.deal_document_path_id(name, 4)));

CREATE FUNCTION public.validate_deal_comment_documents() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE a jsonb; expected_prefix text; seen text[] := '{}';
BEGIN
 -- ON DELETE SET NULL for author/entry must preserve the comment and its paths.
 IF TG_OP = 'UPDATE' THEN
   IF NEW.attachments IS DISTINCT FROM OLD.attachments OR
      ((OLD.attachments <> '[]'::jsonb) AND
       ((NEW.id, NEW.organization_id, NEW.lead_id)
        IS DISTINCT FROM (OLD.id, OLD.organization_id, OLD.lead_id)
        OR (NEW.author_user_id IS NOT NULL AND NEW.author_user_id IS DISTINCT FROM OLD.author_user_id)
        OR (NEW.pipeline_entry_id IS NOT NULL AND NEW.pipeline_entry_id IS DISTINCT FROM OLD.pipeline_entry_id))) THEN
     RAISE EXCEPTION 'Documentos e vínculo do comentário são imutáveis' USING ERRCODE = '23514';
   END IF;
   RETURN NEW;
 END IF;
 IF NEW.attachments = '[]'::jsonb THEN RETURN NEW; END IF;
 IF NEW.author_user_id IS DISTINCT FROM auth.uid() OR NOT EXISTS (
   SELECT 1 FROM public.pipeline_entries e WHERE e.id = NEW.pipeline_entry_id
    AND e.lead_id = NEW.lead_id AND e.organization_id = NEW.organization_id
 ) THEN RAISE EXCEPTION 'Negócio inválido para os documentos' USING ERRCODE = '23514'; END IF;
 expected_prefix := NEW.organization_id::text || '/' || NEW.pipeline_entry_id::text || '/' || NEW.author_user_id::text || '/' || NEW.id::text || '/';
 FOR a IN SELECT value FROM jsonb_array_elements(NEW.attachments) LOOP
   IF jsonb_typeof(a) <> 'object' OR a->>'path' IS NULL OR a->>'name' IS NULL
     OR a->>'size' IS NULL OR a->>'type' IS NULL
     OR length(a->>'name') NOT BETWEEN 1 AND 200
     OR a->>'name' ~ '[[:cntrl:]/\\]'
     OR a->>'name' ~ '[‎‏‪-‮⁦-⁩]'
     OR left(a->>'path', length(expected_prefix)) <> expected_prefix
     OR array_length(string_to_array(a->>'path', '/'), 1) <> 5
     OR (a->>'path') = ANY(seen)
     OR NOT EXISTS (SELECT 1 FROM storage.objects o
       WHERE o.bucket_id = 'deal-comment-documents' AND o.name = a->>'path'
         AND (o.metadata->>'size')::bigint = (a->>'size')::bigint
         AND (a->>'size')::bigint BETWEEN 1 AND 20971520
         AND o.metadata->>'mimetype' = a->>'type') THEN
       RAISE EXCEPTION 'Documento inválido ou upload incompleto' USING ERRCODE = '23514';
   END IF;
   seen := array_append(seen, a->>'path');
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.validate_deal_comment_documents() FROM PUBLIC;
CREATE TRIGGER validate_deal_comment_documents BEFORE INSERT OR UPDATE ON public.lead_comments
FOR EACH ROW EXECUTE FUNCTION public.validate_deal_comment_documents();
