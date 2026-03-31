-- Add new feature keys to all plans (enabled=true for now, no real gating)
INSERT INTO plan_features (plan_id, feature_key, enabled)
SELECT p.id, f.feature_key, true
FROM subscription_plans p
CROSS JOIN (VALUES
  ('funnels_custom'),
  ('carteira'),
  ('campaigns_indicacao'),
  ('campaigns_prospeccao'),
  ('campaigns_reativacao')
) AS f(feature_key)
WHERE NOT EXISTS (
  SELECT 1 FROM plan_features pf
  WHERE pf.plan_id = p.id AND pf.feature_key = f.feature_key
);

-- Add new limits for all existing plans (high values = no real restriction)
INSERT INTO plan_limits (plan_id, limit_key, limit_value)
SELECT p.id, l.limit_key, l.limit_value
FROM subscription_plans p
CROSS JOIN (VALUES
  ('max_active_campaigns', 999)
) AS l(limit_key, limit_value)
WHERE NOT EXISTS (
  SELECT 1 FROM plan_limits pl
  WHERE pl.plan_id = p.id AND pl.limit_key = l.limit_key
);
