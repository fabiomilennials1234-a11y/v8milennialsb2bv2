-- Run in a disposable PostgreSQL database using the contract schema fixture,
-- or adapt seeded identities to a full Supabase instance. No production rows.
BEGIN;
INSERT INTO auth.users VALUES ('40000000-0000-0000-0000-000000000001'),('40000000-0000-0000-0000-000000000002');
INSERT INTO public.pipeline_entries(id,organization_id,lead_id) VALUES
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000001',true), set_config('test.org','20000000-0000-0000-0000-000000000001',true);
DO $$
DECLARE
 path text := '20000000-0000-0000-0000-000000000001/10000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001/50000000-0000-0000-0000-000000000001/file.pdf';
 attachment jsonb;
BEGIN
 INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ('deal-comment-documents',path,'{"size":123,"mimetype":"application/pdf"}');
 IF (SELECT count(*) FROM storage.objects) <> 1 THEN RAISE EXCEPTION 'Author cannot read draft'; END IF;
 BEGIN
  INSERT INTO storage.objects(bucket_id,name) VALUES ('deal-comment-documents',replace(path,'20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002'));
  RAISE EXCEPTION 'Cross-org upload allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 attachment := jsonb_build_array(jsonb_build_object('path',path,'name','Proposta.pdf','size',123,'type','application/pdf'));
 BEGIN
  INSERT INTO public.lead_comments(id,organization_id,lead_id,author_user_id,pipeline_entry_id,body,attachments)
  VALUES ('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002',auth.uid(),'10000000-0000-0000-0000-000000000001','Documento',attachment);
  RAISE EXCEPTION 'Mismatched lead allowed';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  INSERT INTO public.lead_comments(id,organization_id,lead_id,author_user_id,pipeline_entry_id,body,attachments)
  VALUES ('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',auth.uid(),'10000000-0000-0000-0000-000000000001','Documento',jsonb_set(attachment,'{0,size}','999'));
  RAISE EXCEPTION 'Forged metadata allowed';
 EXCEPTION WHEN check_violation THEN NULL; END;
 INSERT INTO public.lead_comments(id,organization_id,lead_id,author_user_id,pipeline_entry_id,body,attachments)
 VALUES ('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',auth.uid(),'10000000-0000-0000-0000-000000000001','Documento',attachment);
 UPDATE public.lead_comments SET body='Texto editado';
 BEGIN
  UPDATE public.lead_comments SET attachments='[]';
  RAISE EXCEPTION 'Attachments mutated';
 EXCEPTION WHEN check_violation THEN NULL; END;
 DELETE FROM storage.objects WHERE name=path;
 IF (SELECT count(*) FROM storage.objects) <> 1 THEN RAISE EXCEPTION 'Published file physically deleted'; END IF;
 UPDATE storage.objects SET metadata='{}' WHERE name=path;
 IF (SELECT metadata->>'size' FROM storage.objects WHERE name=path) <> '123' THEN RAISE EXCEPTION 'Published file overwritten'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000002',true), set_config('test.org','20000000-0000-0000-0000-000000000002',true);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM storage.objects) THEN RAISE EXCEPTION 'Cross-org download allowed'; END IF;
END $$;
SELECT set_config('test.master','true',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM storage.objects) <> 1 THEN RAISE EXCEPTION 'Master cannot download'; END IF;
END $$;
SELECT set_config('test.master','false',true),set_config('test.org','20000000-0000-0000-0000-000000000001',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM storage.objects) <> 1 THEN RAISE EXCEPTION 'Same-org teammate cannot download'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000001',true);
UPDATE public.lead_comments SET deleted_at=now();
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM storage.objects) THEN RAISE EXCEPTION 'Deleted comment file still readable'; END IF;
END $$;
RESET ROLE;
DELETE FROM public.pipeline_entries;
DELETE FROM auth.users;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.lead_comments WHERE pipeline_entry_id IS NOT NULL OR author_user_id IS NOT NULL) THEN RAISE EXCEPTION 'Referential nullification failed'; END IF;
 IF (SELECT count(*) FROM public.lead_comments) <> 1 THEN RAISE EXCEPTION 'Comment lost on parent deletion'; END IF;
END $$;
ROLLBACK;
