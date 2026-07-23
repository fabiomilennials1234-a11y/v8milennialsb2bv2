-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260715130326  name: sec_scope_media_bucket_rls
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

-- Security hardening — Audit 2026-07-14, Onda 1 / Fatia 3 (findings #1 + #2).
-- Replace bucket-wide 'media' storage.objects policies with org-scoped ones.
-- Org id at path segment 2 for org-owned prefixes; flat shared prefixes (avatars/templates/
-- quick-blast/disparo) stay open. Strict-uuid regex guards the ::uuid cast. Reads use public
-- URL (RLS not consulted) so no legit flow breaks; service_role bypasses RLS. Bucket stays
-- public (residual audit #23: privatize + signed URLs is a separate change).

DROP POLICY IF EXISTS "media_read_authenticated"     ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated uploads"  ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated updates"  ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated deletes"  ON storage.objects;

CREATE POLICY "media_select_org_scoped" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'media' AND (
      is_master_user()
      OR (storage.foldername(name))[1] = ANY (ARRAY['avatars','templates','quick-blast','disparo'])
      OR (
        (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND ((storage.foldername(name))[2])::uuid IN (SELECT get_my_organization_ids())
      )
    )
  );

CREATE POLICY "media_insert_org_scoped" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'media' AND (
      is_master_user()
      OR (storage.foldername(name))[1] = ANY (ARRAY['avatars','templates','quick-blast','disparo'])
      OR (
        (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND ((storage.foldername(name))[2])::uuid IN (SELECT get_my_organization_ids())
      )
    )
  );

CREATE POLICY "media_update_org_scoped" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'media' AND (
      is_master_user()
      OR (storage.foldername(name))[1] = ANY (ARRAY['avatars','templates','quick-blast','disparo'])
      OR (
        (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND ((storage.foldername(name))[2])::uuid IN (SELECT get_my_organization_ids())
      )
    )
  )
  WITH CHECK (
    bucket_id = 'media' AND (
      is_master_user()
      OR (storage.foldername(name))[1] = ANY (ARRAY['avatars','templates','quick-blast','disparo'])
      OR (
        (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND ((storage.foldername(name))[2])::uuid IN (SELECT get_my_organization_ids())
      )
    )
  );

CREATE POLICY "media_delete_org_scoped" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'media' AND (
      is_master_user()
      OR (storage.foldername(name))[1] = ANY (ARRAY['avatars','templates','quick-blast','disparo'])
      OR (
        (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND ((storage.foldername(name))[2])::uuid IN (SELECT get_my_organization_ids())
      )
    )
  );
