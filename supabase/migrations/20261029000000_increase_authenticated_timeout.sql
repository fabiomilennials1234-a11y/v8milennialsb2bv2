-- P0: Increase authenticated statement_timeout from 8s to 15s
-- Reason: PostgREST lateral joins on leads (5 FK embeds + lead_tags + tags)
-- combined with heavy leads RLS (6+ functions/row) cause timeouts for orgs
-- with 1000+ pipeline entries.

ALTER ROLE authenticated SET statement_timeout = '15s';
