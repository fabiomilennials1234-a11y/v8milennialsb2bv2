BEGIN;

-- SCRUM-614 / PR #2092: transfer the navigation state left behind when
-- pipelines became the only funnel registry. This is a one-time import, not
-- a runtime distinction between system and custom funnels.
-- The cutoff is the exact merge time of #2092. Explicitly created later
-- entities retain the normal visible/display_order defaults.
-- Only navigation config and display_order change. Existing UPDATE trigger
-- refreshes updated_at; entries,
-- stages, money, is_active, names, org defaults and permissions are untouched.
-- Fail closed on ambiguous subscription state, rather than choosing a plan
-- differently from the existing feature resolver.
DO $$ BEGIN
  IF EXISTS (SELECT organization_id FROM public.org_subscriptions
             WHERE cancelled_at IS NULL GROUP BY organization_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Ambiguous active subscription; reconcile before navigation import';
  END IF;
END $$;
WITH feature_base AS (
  SELECT o.id AS organization_id,
         CASE WHEN os.id IS NOT NULL THEN os.features ELSE COALESCE(sp.features, '{}'::jsonb) END AS features
  FROM public.organizations o
  LEFT JOIN public.org_subscriptions os ON os.organization_id=o.id AND os.cancelled_at IS NULL
  LEFT JOIN public.subscription_plans sp ON sp.name=o.subscription_plan
), effective_merge AS (
  -- Same precedence as org_get_features_and_limits, excluding user-specific
  -- master privileges: snapshot/plan -> unexpired org override -> catalog.
  SELECT b.organization_id,
         CASE WHEN f.id IS NOT NULL THEN f.enabled IS TRUE
              WHEN b.features ? 'merged_opportunity_funnel'
                THEN b.features -> 'merged_opportunity_funnel' = 'true'::jsonb
              ELSE COALESCE(c.default_enabled, false)
         END AS enabled
  FROM feature_base b
  LEFT JOIN public.organization_features f ON f.organization_id=b.organization_id
    AND f.feature_key='merged_opportunity_funnel'
    AND (f.expires_at IS NULL OR f.expires_at > now())
  LEFT JOIN public.feature_catalog c ON c.key='merged_opportunity_funnel'
), historical AS (
  SELECT p.id, p.organization_id, p.created_at, p.display_order, p.config,
         p.type = 'system' AS seeded, -- metric-lint-allow: one-off legacy origin marker, never a metric filter
         p.config ->> 'lifecycle_type' = 'temporary' AS temporary,
         d.position AS legacy_position,
         CASE
           WHEN p.type = 'system' THEN -- metric-lint-allow: one-off import of the former display registry
             COALESCE(d.is_visible, false)
             AND p.slug <> 'upsell'
             AND NOT (p.slug = 'confirmacao' AND EXISTS (
               SELECT 1 FROM effective_merge f
               WHERE f.organization_id = p.organization_id AND f.enabled IS TRUE
             ))
           ELSE true
         END AS is_visible
    FROM public.pipelines p
    LEFT JOIN public.pipeline_display_config d
      ON d.organization_id = p.organization_id AND d.pipe_type = p.slug
   WHERE p.created_at < timestamptz '2026-09-10 21:13:04+00'
), ranked AS (
  SELECT id, is_visible,
         row_number() OVER (
           PARTITION BY organization_id
           ORDER BY CASE WHEN seeded THEN 0 WHEN temporary THEN 2 ELSE 1 END,
                    CASE WHEN seeded THEN legacy_position END ASC NULLS LAST,
                    CASE WHEN NOT seeded AND NOT COALESCE(temporary, false)
                         THEN display_order END ASC NULLS LAST,
                    CASE WHEN NOT seeded AND temporary THEN created_at END DESC,
                    id
         )::integer AS position
    FROM historical
)
UPDATE public.pipelines p
   SET config = COALESCE(p.config, '{}'::jsonb) || jsonb_build_object(
     'navigation', COALESCE(p.config -> 'navigation', '{}'::jsonb)
       || jsonb_build_object('is_visible', r.is_visible)
   ),
       display_order = r.position
  FROM ranked r
 WHERE p.id = r.id
   -- Never overwrite a decision already stored in the canonical entity;
   -- this also makes a second application a no-op (including updated_at).
   AND NOT (COALESCE(p.config -> 'navigation', '{}'::jsonb) ? 'is_visible')
   AND (p.config -> 'navigation' IS NULL OR jsonb_typeof(p.config -> 'navigation') = 'object')
   AND (p.config IS NULL OR jsonb_typeof(p.config) = 'object');

COMMIT;
