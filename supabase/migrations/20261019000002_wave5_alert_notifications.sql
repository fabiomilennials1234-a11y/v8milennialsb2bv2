-- =============================================================================
-- Wave 5.2: WhatsApp alert notifications to salespeople
-- Adds phone to team_members, notified_at to client_alerts, feature flag
-- =============================================================================

-- Team members need phone for receiving notifications
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS phone TEXT;

-- Track when alert notification was sent (rate limiting + audit)
ALTER TABLE client_alerts ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;

-- Feature flag: portfolio alerts via WhatsApp (default off)
INSERT INTO feature_flags (key, name, description, default_enabled, category)
VALUES (
  'portfolio_alerts_whatsapp',
  'Portfolio Alerts via WhatsApp',
  'Send WhatsApp notifications to salespeople when critical portfolio alerts fire',
  false,
  'features'
) ON CONFLICT (key) DO NOTHING;
