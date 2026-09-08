-- Execute only after 20271018000000 and explicit authorization for the target.
-- Repairs the legacy projection; the new filter reads relacao_negocios directly.
BEGIN;
CREATE SCHEMA IF NOT EXISTS backup;
CREATE TABLE IF NOT EXISTS backup.lead_first_sale_20260908 (
  lead_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  previous_value timestamptz,
  corrected_value timestamptz,
  captured_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE backup.lead_first_sale_20260908 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON backup.lead_first_sale_20260908 FROM PUBLIC, anon, authenticated;
GRANT ALL ON backup.lead_first_sale_20260908 TO service_role;

INSERT INTO backup.lead_first_sale_20260908 (lead_id,organization_id,previous_value,corrected_value)
SELECT l.id,l.organization_id,l.primeira_venda_at,expected.sold_at
FROM public.leads l
LEFT JOIN LATERAL (
  SELECT min(s.sold_at) AS sold_at
  FROM public.sale_events s
  WHERE s.organization_id=l.organization_id AND s.lead_id=l.id
    AND s.event_type='sale' AND s.reversed_event_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.sale_events r
      WHERE r.organization_id=s.organization_id AND r.reversed_event_id=s.id)
) expected ON true
WHERE l.primeira_venda_at IS DISTINCT FROM expected.sold_at
ON CONFLICT (lead_id) DO NOTHING;

UPDATE public.leads l SET primeira_venda_at=b.corrected_value
FROM backup.lead_first_sale_20260908 b
WHERE l.id=b.lead_id AND l.organization_id=b.organization_id
  AND l.primeira_venda_at IS NOT DISTINCT FROM b.previous_value
  AND l.primeira_venda_at IS DISTINCT FROM b.corrected_value;
COMMIT;

-- Rollback of this recovery ONLY (run deliberately; preserves later changes):
-- UPDATE public.leads l SET primeira_venda_at=b.previous_value
-- FROM backup.lead_first_sale_20260908 b
-- WHERE l.id=b.lead_id AND l.organization_id=b.organization_id
--   AND l.primeira_venda_at IS NOT DISTINCT FROM b.corrected_value;
