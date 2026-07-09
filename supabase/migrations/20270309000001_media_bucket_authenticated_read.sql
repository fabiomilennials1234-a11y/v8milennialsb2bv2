-- 20270309000001_media_bucket_authenticated_read.sql
--
-- Onda 0 / Slice 0.2 (SPEC .specs/features/db-optimization/SPEC.md) — stop the
-- anonymous enumeration of the public `media` bucket (audit ADV-2, 2026-07-09).
--
-- PROBLEM (proven empirically with the prod anon key):
--   POST /storage/v1/object/list/media  → lists whatsapp-media/{org_id}/ for all
--   ~30 orgs, down to individual objects whose NAME is the customer phone number
--   (e.g. "5511975556269:2A67...jpg"). The "path is unguessable" defence in
--   useWhatsAppSend.ts is defeated — .list() hands the full path over. 66GB of
--   PII enumerable WITHOUT LOGIN.
--
-- ROOT CAUSE: a broad SELECT policy ("Allow public read") on storage.objects
-- grants the anon role list/read on the bucket. A PUBLIC bucket already serves
-- object GET via /object/public WITHOUT any SELECT policy, so this policy adds
-- only the harmful capability (listing + authenticated-info reads) with no
-- upside.
--
-- FIX: replace the anon-facing SELECT policy with an authenticated-scoped one.
--   • getPublicUrl (/object/public) keeps returning 200 — bucket stays `public`.
--   • authenticated flows keep working — upsert needs SELECT, download, remove.
--   • anon loses .list() and /object/authenticated. Enumeration without login dies.
--
-- RESIDUAL (accepted, deferred to S2 privatisation): the replacement is
-- bucket-wide, so a logged-in user of ANY org can still list cross-tenant. The
-- real end state is per-org paths + private bucket + signed URLs (roadmap S2).
-- This slice's job is only to kill enumeration WITHOUT LOGIN.
--
-- ⚠️ PRE-APPLY GATE (storage schema is not readable by the MCP read-only role;
--    apply + these checks run as admin via `supabase db push` / Management API):
--
--   -- 1. Confirm the policy names + that "Allow public read" is media-scoped.
--   SELECT policyname, roles::text, cmd, qual, with_check
--   FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
--   ORDER BY policyname;
--
--   If "Allow public read".qual is BROADER than bucket_id = 'media' (i.e. it also
--   covers other buckets), DO NOT drop it blindly — narrow this migration to only
--   remove the anon grantee, or scope the new policy to match. Given the paired
--   naming ("Allow public read" + "help_media_read"), media-scoped is expected.
--
-- NOT APPLIED TO PROD BY THIS FILE — gated on explicit CTO "vai". Dev-first is
-- blocked (dev 402). The 6-scenario verification below is the acceptance artifact.

-- ─────────────────────────────────────────────────────────────────────────────
-- media bucket: anon SELECT → authenticated SELECT
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow public read" ON storage.objects;

CREATE POLICY "media_read_authenticated"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'media');

-- ─────────────────────────────────────────────────────────────────────────────
-- help-media bucket: same treatment (also flagged public_bucket_allows_listing)
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "help_media_read" ON storage.objects;

CREATE POLICY "help_media_read_authenticated"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'help-media');

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFY (dev-first; all 6 must pass before prod apply):
--   1. anon POST /storage/v1/object/list/media           → empty / error
--   2. getPublicUrl of an existing whatsapp-media object  → 200
--   3. authenticated upload (upsert:true) of a NEW file   → success  (send image in chat)
--   4. authenticated upload (upsert:true) OVERWRITING     → success  (re-upload avatar)
--   5. authenticated .remove() of a copilot audio         → success
--   6. admin help-center image upload + display           → success
-- ─────────────────────────────────────────────────────────────────────────────
