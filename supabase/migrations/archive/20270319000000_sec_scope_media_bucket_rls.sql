-- Security hardening — Audit 2026-07-14, Onda 1 / Fatia 3 (findings #1 + #2).
-- The 'media' bucket held four bucket-wide storage.objects policies
-- (SELECT/INSERT/UPDATE/DELETE all just USING/WITH CHECK bucket_id='media', role
-- authenticated). Because the bucket is public and paths are laid out per org
-- (whatsapp-media/<orgId>/..., 167k+ WhatsApp lead-media objects across 40 orgs), any
-- authenticated user of any tenant could .list() and enumerate, then download, overwrite
-- (upsert) or delete every OTHER tenant's media — a live cross-tenant PII breach and a
-- destructive-write vector (no PITR on this project).
--
-- Fix: replace the four bucket-wide policies with org-scoped equivalents. The org id lives
-- at path segment 2 for every org-owned prefix (whatsapp-media, workflow-audios,
-- workflow-assets, campaign-templates, scheduled-messages, copilot-audios, tts-audio);
-- a small set of shared/non-org prefixes (avatars/<userId>, templates/, quick-blast/,
-- disparo/) are flat and stay open to authenticated. A strict-uuid regex guards the ::uuid
-- cast so a malformed segment can never raise a cast error at policy-eval time.
-- Verified against the frontend: every browser upload path matches this shape and reads use
-- getPublicUrl (public bucket -> RLS not consulted), so no legitimate flow is affected.
-- service_role writers (inbound-media edge fns) bypass RLS entirely and are unaffected.
--
-- Residual (NOT closed here, tracked as audit #23): the bucket is still public, so a leaked
-- exact public URL remains fetchable. Privatizing + signed URLs is a separate, larger change.

DROP POLICY IF EXISTS "media_read_authenticated"     ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated uploads"  ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated updates"  ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated deletes"  ON storage.objects;

-- SELECT — org members see only their org's media; shared flat prefixes stay readable.
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

-- INSERT — can only upload into own org's path (or a shared flat prefix).
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

-- UPDATE — both USING (row must be own org) and WITH CHECK (cannot relocate into another org).
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

-- DELETE — can only delete own org's objects (or shared flat prefixes).
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
