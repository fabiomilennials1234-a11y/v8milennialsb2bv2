-- Browser-only data. Never run against production; separate from integration
-- seed so isolation tests can continue asserting an empty agent catalogue.
BEGIN;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
SET LOCAL session_replication_role = replica;
INSERT INTO public.feature_catalog (key, name, category, default_enabled, is_sellable)
VALUES ('copilot', 'Copilot', 'core', false, true) ON CONFLICT (key) DO NOTHING;
INSERT INTO public.organization_features (organization_id, feature_key, enabled)
VALUES ('00000000-0000-0000-0000-000000000001', 'copilot', true)
ON CONFLICT (organization_id, feature_key) DO UPDATE SET enabled = true;
-- All legacy board call sites must contain a real, independently scoped deal.
INSERT INTO public.pipeline_stages (organization_id, pipeline_id, name, stage_key, position, stage_role)
SELECT p.organization_id, p.id, 'Novo', 'novo', 0, 'open'
FROM public.pipelines p WHERE p.organization_id = '00000000-0000-0000-0000-000000000001'
  AND p.slug IN ('confirmacao', 'propostas')
ON CONFLICT (pipeline_id, stage_key) DO NOTHING;
INSERT INTO public.deals (source, id, organization_id, source_lead_id, title)
SELECT 'human', md5('e2e-deal:' || p.id::text)::uuid, p.organization_id,
  '00000000-0000-0000-0000-000000001001', 'Lead Alpha · ' || p.name
FROM public.pipelines p WHERE p.organization_id = '00000000-0000-0000-0000-000000000001'
  AND p.slug IN ('confirmacao', 'propostas') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.pipeline_entries (organization_id, pipeline_id, lead_id, deal_id, stage_id, stage_key)
SELECT p.organization_id, p.id, '00000000-0000-0000-0000-000000001001',
  md5('e2e-deal:' || p.id::text)::uuid, s.id, s.stage_key
FROM public.pipelines p JOIN public.pipeline_stages s ON s.pipeline_id = p.id AND s.stage_key = 'novo'
WHERE p.organization_id = '00000000-0000-0000-0000-000000000001'
  AND p.slug IN ('confirmacao', 'propostas')
  AND NOT EXISTS (SELECT 1 FROM public.pipeline_entries e WHERE e.deal_id = md5('e2e-deal:' || p.id::text)::uuid);
INSERT INTO public.follow_ups (organization_id, lead_id, assigned_to, title, due_date)
VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001001',
  '00000000-0000-0000-0000-000000000120', 'Lead Alpha · E2E follow-up', now() + interval '10 minutes');
-- These scenarios exercise existing CRM users, not the first-run feedback
-- campaign. Persist their prior dismissal so its timed modal cannot race a
-- lead/meeting action. Prompt behavior remains covered by dedicated tests.
INSERT INTO public.user_prompt_impressions (user_id, prompt_key, outcome)
SELECT id, 'feature_suggestions_2026_10', 'dismissed' FROM auth.users
WHERE email IN ('admin@test.com', 'sdr@test.com', 'member1@test.com', 'member2@test.com')
ON CONFLICT (user_id, prompt_key) DO UPDATE SET outcome = 'dismissed';
COMMIT;
