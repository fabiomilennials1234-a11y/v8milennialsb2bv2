-- Preserve privacy requests and their audit trail on rollback. Disable callback
-- deployment first. Drop only after verified export/fulfilment and explicit approval.
REVOKE ALL ON TABLE public.meta_privacy_requests FROM PUBLIC, anon, authenticated;
