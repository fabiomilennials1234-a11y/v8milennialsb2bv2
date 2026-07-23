-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260710001056  name: support_attachments_bucket
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'support-attachments',
  'support-attachments',
  false,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.can_read_support_attachment(object_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ticket_id UUID;
BEGIN
  BEGIN
    ticket_id := split_part(object_name, '/', 1)::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;

  RETURN public.can_read_support_ticket(ticket_id);
END;
$$;

COMMENT ON FUNCTION public.can_read_support_attachment(TEXT) IS
  'Autoriza um objeto de support-attachments pelo primeiro segmento do caminho (o id do Chamado). Devolve false, nunca levanta, para nao quebrar a listagem de outros buckets.';

REVOKE ALL ON FUNCTION public.can_read_support_attachment(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_support_attachment(TEXT) TO authenticated;

DROP POLICY IF EXISTS support_attachments_select ON storage.objects;
CREATE POLICY support_attachments_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'support-attachments'
    AND public.can_read_support_attachment(name)
  );

DROP POLICY IF EXISTS support_attachments_insert ON storage.objects;
CREATE POLICY support_attachments_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'support-attachments'
    AND public.can_read_support_attachment(name)
  );

DROP POLICY IF EXISTS support_attachments_update ON storage.objects;

DROP POLICY IF EXISTS support_attachments_delete ON storage.objects;
CREATE POLICY support_attachments_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'support-attachments'
    AND public.is_master_user()
  );
