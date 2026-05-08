-- Wave 2.2 — Unified Inbox
-- Expand channel_type enum to support email and SMS channels.
-- View and RPC in separate migration (20260951100000) to avoid enum TDZ.

ALTER TYPE channel_type ADD VALUE IF NOT EXISTS 'email';
ALTER TYPE channel_type ADD VALUE IF NOT EXISTS 'sms';
