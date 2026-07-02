-- apply_22 ROLLBACK — DNA de Almas (2026-07-02)
-- Reverte apply_22: 7 leads voltam a whatsapp/novo; 3 entries confirmacao são re-inseridos
-- com os valores exatos snapshotados antes do delete (metadata {}, assigned_to null).

BEGIN;

-- (1) Reverte backfill: novo_lead → novo (só os 7 tocados)
UPDATE pipeline_entries pe
SET stage_key = 'novo', stage_changed_at = now()
FROM pipelines p
WHERE pe.pipeline_id = p.id
  AND p.organization_id = 'd67ae17a-815d-476d-b3a9-287c7b267997'
  AND p.slug = 'whatsapp'
  AND pe.stage_key = 'novo_lead'
  AND pe.id IN (
    '04629abf-61b9-4eb7-948d-3ae1c4e83fa3',
    '591c8b67-3ed2-47ab-8542-5db902919578',
    '45e325c5-1ec3-4a75-acf7-115824ac7603',
    'e2f23db4-9aaa-44d9-918e-5cc63f264322',
    'b092d41b-7e55-4767-94aa-591762792aef',
    '86e0b18c-dfc9-48cd-a725-492fb8925fe5',
    '718a9b85-0c85-4d53-95aa-359763862320'
  );

-- (2) Re-insere os 3 entries confirmacao removidos
INSERT INTO pipeline_entries
  (id, lead_id, pipeline_id, organization_id, stage_key, metadata, notes, deal_id,
   assigned_to, closed_at, created_at, entered_at, updated_at, stage_changed_at)
VALUES
  ('2f91bf16-cb0f-413e-9d19-5bd938a9ccba','7a817010-ab9b-4dea-b74d-cd19f2e0658c','9ca57022-8b44-48a4-84ea-f641e69d85e5','d67ae17a-815d-476d-b3a9-287c7b267997','ganho','{}'::jsonb,NULL,NULL,NULL,NULL,'2026-06-25T09:37:08.48559+00:00','2026-06-25T09:37:08.48559+00:00','2026-06-25T09:37:08.48559+00:00','2026-06-25T09:37:08.48559+00:00'),
  ('329bbe08-9ef3-42d5-b34f-bbd90f08f36b','2977bbb0-970a-4c41-8a1d-78d9b360f8a9','9ca57022-8b44-48a4-84ea-f641e69d85e5','d67ae17a-815d-476d-b3a9-287c7b267997','ganho','{}'::jsonb,NULL,NULL,NULL,NULL,'2026-06-05T14:40:41.176492+00:00','2026-06-05T14:40:41.176492+00:00','2026-06-05T14:40:41.176492+00:00','2026-06-05T14:40:41.176492+00:00'),
  ('711c724f-fb95-41c4-86cf-7bef6a5d8b2d','a20688a0-4b9b-4d2d-bdb7-016042bd6a1e','9ca57022-8b44-48a4-84ea-f641e69d85e5','d67ae17a-815d-476d-b3a9-287c7b267997','upgrade','{}'::jsonb,NULL,NULL,NULL,NULL,'2026-06-04T13:14:55.833111+00:00','2026-06-04T13:14:55.833111+00:00','2026-06-04T13:14:55.833111+00:00','2026-06-04T13:14:55.833111+00:00')
ON CONFLICT (id) DO NOTHING;

COMMIT;
