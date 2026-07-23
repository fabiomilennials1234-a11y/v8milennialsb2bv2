-- ============================================================================
-- Post-deploy validation: check distribution equality across campaigns/pipes
-- Logs warnings for any campaign or pipe with max-min lead difference > 1.
-- This is advisory — it does NOT block the migration.
-- ============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  -- Check campaigns with round_robin mode
  FOR r IN
    SELECT c.id, c.name,
      MAX(sub.member_count) AS max_leads,
      MIN(sub.member_count) AS min_leads,
      MAX(sub.member_count) - MIN(sub.member_count) AS diff
    FROM campanhas c
    CROSS JOIN LATERAL (
      SELECT cm.team_member_id, COUNT(cl.id) AS member_count
      FROM campanha_members cm
      LEFT JOIN campanha_leads cl
        ON cl.campanha_id = c.id AND cl.responsible_id = cm.team_member_id
      WHERE cm.campanha_id = c.id
      GROUP BY cm.team_member_id
    ) sub
    WHERE c.lead_distribution_mode = 'round_robin'
    GROUP BY c.id, c.name
    HAVING MAX(sub.member_count) - MIN(sub.member_count) > 1
  LOOP
    RAISE WARNING 'Uneven distribution in campaign "%" (id=%): min=%, max=%, diff=%',
      r.name, r.id, r.min_leads, r.max_leads, r.diff;
  END LOOP;

  RAISE NOTICE 'Distribution equality check complete.';
END $$;
