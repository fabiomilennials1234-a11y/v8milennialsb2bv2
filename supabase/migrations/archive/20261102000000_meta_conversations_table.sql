-- supabase/migrations/20261102000000_meta_conversations_table.sql

CREATE TABLE meta_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  meta_page_id uuid NOT NULL REFERENCES meta_pages(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('messenger', 'instagram')),
  external_user_id text NOT NULL,
  external_username text,
  profile_pic_url text,
  profile_pic_expires_at timestamptz,
  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_message_preview text,
  last_message_direction text CHECK (last_message_direction IN ('incoming', 'outgoing')),
  last_inbound_at timestamptz,
  unread_count integer NOT NULL DEFAULT 0,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meta_conversations_unique_per_user
    UNIQUE (organization_id, channel, meta_page_id, external_user_id)
);

CREATE INDEX idx_meta_conv_org_chan_active
  ON meta_conversations (organization_id, channel, archived_at, last_message_at DESC);

CREATE INDEX idx_meta_conv_lead
  ON meta_conversations (lead_id) WHERE lead_id IS NOT NULL;

CREATE INDEX idx_meta_conv_page
  ON meta_conversations (meta_page_id, last_message_at DESC);

ALTER TABLE meta_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY meta_conv_select_org ON meta_conversations
  FOR SELECT
  USING (organization_id IN (SELECT get_my_organization_ids()));

CREATE POLICY meta_conv_update_org ON meta_conversations
  FOR UPDATE
  USING (organization_id IN (SELECT get_my_organization_ids()))
  WITH CHECK (organization_id IN (SELECT get_my_organization_ids()));

-- INSERT/DELETE only via service_role (trigger + backfill). No client policies.

COMMENT ON TABLE meta_conversations IS
  'Aggregation of Messenger/Instagram Direct conversations per (page, external_user). Maintained by trigger on channel_messages insert.';
