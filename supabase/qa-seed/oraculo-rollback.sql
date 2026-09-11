-- Disposable branch only. Install with scripts/seed-branch.mjs (rejects production).
-- Inject a storage failure AFTER both turn rows have been inserted by the RPC.
CREATE OR REPLACE FUNCTION public.qa_oraculo_fail_summary() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.summary = '__qa_oraculo_fail_summary__' THEN
    RAISE EXCEPTION 'Synthetic summary write failure' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.qa_oraculo_fail_summary() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER qa_oraculo_fail_summary BEFORE UPDATE ON public.oraculo_conversations
FOR EACH ROW EXECUTE FUNCTION public.qa_oraculo_fail_summary();
-- Removed with branch teardown; never deploy this QA fixture.
