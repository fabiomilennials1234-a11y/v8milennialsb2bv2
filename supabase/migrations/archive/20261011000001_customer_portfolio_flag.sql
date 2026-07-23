INSERT INTO feature_flags (key, name, default_enabled, description, category)
VALUES (
  'customer_portfolio',
  'Customer Portfolio & Reorder',
  false,
  'Enables customer portfolio management: health scores, reorder prediction, retention copilot, and client 360 view',
  'features'
)
ON CONFLICT (key) DO NOTHING;
