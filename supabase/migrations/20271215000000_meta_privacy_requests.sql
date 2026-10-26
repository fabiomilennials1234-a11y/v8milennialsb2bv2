-- Intake only: completion requires verified, app-scoped operator fulfilment.
-- No client organization or whole-tenant deletion is inferred from a Meta user ID.
CREATE TABLE public.meta_privacy_requests (
  confirmation_code text PRIMARY KEY CHECK (confirmation_code ~ '^[a-f0-9]{64}$'),
  app_id text NOT NULL CHECK (app_id ~ '^[0-9]{1,64}$'),
  meta_user_id text NOT NULL CHECK (meta_user_id ~ '^[0-9]{1,64}$'),
  kind text NOT NULL CHECK (kind IN ('deletion', 'deauthorization')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  resolution_note text,
  CONSTRAINT meta_privacy_completion CHECK (
    (status = 'completed' AND completed_at IS NOT NULL AND nullif(btrim(resolution_note), '') IS NOT NULL)
    OR (status <> 'completed' AND completed_at IS NULL)
  )
);
CREATE INDEX meta_privacy_requests_pending ON public.meta_privacy_requests (created_at) WHERE status <> 'completed';
ALTER TABLE public.meta_privacy_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.meta_privacy_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.meta_privacy_requests TO service_role;
COMMENT ON TABLE public.meta_privacy_requests IS 'Private Meta callback intake. No request payloads or access tokens. Status is exposed only by an opaque receipt through the edge function; fulfilment is manual and audited.';
