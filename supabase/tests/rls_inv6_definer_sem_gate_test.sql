-- supabase/tests/rls_inv6_definer_sem_gate_test.sql
--
-- INV-6 (SCRUM-339): no SECURITY DEFINER function in `public` that anon or
-- authenticated can EXECUTE may lack an authorization gate.
--
-- WHY THIS EXISTS. On 2026-08-11 we closed 23 functions that were all the same
-- shape: SECURITY DEFINER, reachable from the browser, taking an id by
-- parameter, and asking nobody whether the caller was entitled to that tenant.
-- Proven consequences, each executed as role `authenticated` with no JWT at
-- all: a WhatsApp message written by one org dispatched through another org's
-- own number; webhook deliveries queued to a victim's endpoint with an
-- attacker-chosen body; writes into `organizations`; and readers that returned
-- lead phone numbers from any organization.
--
-- Billing Fatia 5 (SCRUM-286) is about to add new RPCs. Without a gate in CI,
-- the 24th lands and nobody sees it. This file is that gate.
--
-- SHAPE: ratchet, not hard zero — see rls_invariants_baseline.sql for why the
-- ceiling is what it is and what has to happen before it can become 0.
--
-- Everything runs inside a transaction that is ROLLED BACK; the planted objects
-- never persist.
--
--   pg_prove --ext .sql -d "$DATABASE_URL" supabase/tests/rls_inv6_definer_sem_gate_test.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

\ir _rls_invariants_detectors.sql
\ir rls_invariants_baseline.sql

SELECT plan(5);

-- ===========================================================================
-- (1) THE GATE — live count must not exceed the frozen ceiling.
--
-- Measured BEFORE anything is planted below, so the fixture cannot inflate it.
-- ===========================================================================

SELECT diag('INV-6 ungated DEFINER: ' || schemaname || '.' || functionname ||
            '(' || identity_args || ')' ||
            ' anon=' || anon_can_execute || ' authenticated=' || auth_can_execute)
FROM public._rls_inv_definer_without_gate()
ORDER BY functionname;

-- Printed unconditionally: this is the number the ceiling must be tightened to.
SELECT diag('INV-6 LIVE COUNT = ' ||
            (SELECT count(*)::text FROM public._rls_inv_definer_without_gate()) ||
            '  (ceiling = ' ||
            (SELECT max_violations::text FROM _rls_inv_baseline WHERE invariant = 'INV-6') || ')');

SELECT cmp_ok(
  (SELECT count(*)::int FROM public._rls_inv_definer_without_gate()),
  '<=',
  (SELECT max_violations FROM _rls_inv_baseline WHERE invariant = 'INV-6'),
  'INV-6: DEFINER functions reachable by anon/authenticated without an authorization gate do not exceed ratchet baseline'
);

-- ===========================================================================
-- (2)(3)(4) PROOF THAT IT BITES.
--
-- A gate nobody has watched fail is a gate nobody knows works. Plant the exact
-- shape of the 23 functions closed on 2026-08-11 and assert the detector sees
-- it; then fix it by each of the two real remediation paths and assert it
-- clears. Each assertion is killed by its own single change and by no other.
-- ===========================================================================

-- The planted violation. Note what it is NOT: it takes no `organization_id`
-- (only a `whatsapp_instance_id`, the parameter shape that let
-- `schedule_rule_steps_from_position` slip past three sweeps) and it only
-- READS (no INSERT/UPDATE/DELETE, the shape the write-filtered first cut was
-- blind to). It must be flagged on reachability alone.
CREATE OR REPLACE FUNCTION public._rls_inv6_bad_reader(p_whatsapp_instance_id uuid)
RETURNS TABLE (leaked text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $bad$
  -- no authorization of any kind: the caller picks the instance, we obey
  SELECT i.instance_name::text
  FROM public.whatsapp_instances i
  WHERE i.id = p_whatsapp_instance_id;
$bad$;

-- Granted explicitly rather than relying on Supabase's ALTER DEFAULT
-- PRIVILEGES, so this fixture asserts the detector and not the base image.
GRANT EXECUTE ON FUNCTION public._rls_inv6_bad_reader(uuid) TO authenticated;

SELECT isnt(
  (SELECT count(*)::int FROM public._rls_inv_definer_without_gate()
     WHERE functionname = '_rls_inv6_bad_reader'),
  0,
  'INV-6 RED: detector flags an ungated DEFINER reachable by authenticated — no org_id parameter, no write'
);

-- --------------------------------------------------------------------------
-- The detector must not be satisfied by PROSE. Naming a helper in a comment is
-- the cheapest possible way to fake compliance, and it would be invisible in
-- review. Same ungated body, now with the most respectable-looking comment in
-- the repo: it must STILL be flagged.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._rls_inv6_bad_reader(p_whatsapp_instance_id uuid)
RETURNS TABLE (leaked text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $bad$
  -- authorization handled upstream; equivalent to assert_org_access(auth.uid())
  /* see get_my_organization_ids() — checked by the caller */
  SELECT i.instance_name::text
  FROM public.whatsapp_instances i
  WHERE i.id = p_whatsapp_instance_id;
$bad$;

SELECT isnt(
  (SELECT count(*)::int FROM public._rls_inv_definer_without_gate()
     WHERE functionname = '_rls_inv6_bad_reader'),
  0,
  'INV-6 RED: a gate named only inside a comment does not count — comments are stripped before matching'
);

-- --------------------------------------------------------------------------
-- Remediation path A — add the gate, keep it reachable. This is what the
-- `_unchecked` + wrapper molde produces for the functions the browser must
-- keep calling.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._rls_inv6_bad_reader(p_whatsapp_instance_id uuid)
RETURNS TABLE (leaked text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $fixed$
  SELECT i.instance_name::text
  FROM public.whatsapp_instances i
  WHERE i.id = p_whatsapp_instance_id
    AND i.organization_id IN (SELECT public.get_my_organization_ids());
$fixed$;

SELECT is(
  (SELECT count(*)::int FROM public._rls_inv_definer_without_gate()
     WHERE functionname = '_rls_inv6_bad_reader'),
  0,
  'INV-6 GREEN-after-fix (A): scoping the body to get_my_organization_ids() clears the violation'
);

-- --------------------------------------------------------------------------
-- Remediation path B — leave the body ungated but take away reachability, the
-- REVOKE applied to the functions only edge functions call.
--
-- The revoke names PUBLIC *and* anon *and* authenticated on purpose: Supabase's
-- ALTER DEFAULT PRIVILEGES hands every new function in `public` an explicit
-- grant to each of those roles, so `REVOKE ... FROM PUBLIC` alone leaves the
-- function reachable. That exact trap is pinned down in
-- rls_invariants_red_fixture.sql.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._rls_inv6_bad_reader(p_whatsapp_instance_id uuid)
RETURNS TABLE (leaked text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $bad$
  SELECT i.instance_name::text
  FROM public.whatsapp_instances i
  WHERE i.id = p_whatsapp_instance_id;
$bad$;
REVOKE EXECUTE ON FUNCTION public._rls_inv6_bad_reader(uuid) FROM PUBLIC, anon, authenticated;

SELECT is(
  (SELECT count(*)::int FROM public._rls_inv_definer_without_gate()
     WHERE functionname = '_rls_inv6_bad_reader'),
  0,
  'INV-6 GREEN-after-fix (B): revoking EXECUTE from PUBLIC, anon and authenticated clears the violation'
);

SELECT * FROM finish();

ROLLBACK;
