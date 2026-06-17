-- =============================================================================
-- Prova que o fix 20261216000000 resolve a perda silenciosa de lead.
-- =============================================================================
-- Cenário do incidente (Basic4u 2026-06-16): hard-delete de lead executado sob
-- `session_replication_role = replica` pulava os triggers de log → lead sumia
-- sem registro em deleted_leads_log.
--
--   ANTES do fix (trigger tgenabled='O'): delete sob replica NÃO loga → rows=0.
--   DEPOIS  do fix (ENABLE ALWAYS):       delete sob replica loga    → rows=1.
--
-- Também valida o soft-delete sob replica role. Tudo em transação + ROLLBACK.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_org_id   UUID;
  v_lead_id  UUID;
  v_lead2_id UUID;
  v_slug     TEXT := '__test_del_audit_' || replace(gen_random_uuid()::text, '-', '');
  v_hard     INT;
  v_soft     INT;
BEGIN
  INSERT INTO organizations (name, slug) VALUES ('__test_del_audit__', v_slug)
  RETURNING id INTO v_org_id;

  -- Seed sob replica (padrão do repo: evita quota/triggers de pipe no fixture).
  SET LOCAL session_replication_role = replica;

  INSERT INTO leads (organization_id, name, phone, created_at)
  VALUES (v_org_id, 'Lead Hard Delete', '+5511900000001', CURRENT_TIMESTAMP)
  RETURNING id INTO v_lead_id;

  INSERT INTO leads (organization_id, name, phone, created_at)
  VALUES (v_org_id, 'Lead Soft Delete', '+5511900000002', CURRENT_TIMESTAMP)
  RETURNING id INTO v_lead2_id;

  -- ═══ ACT: ambos os deletes SOB replica role (a condição exata do bypass) ═══
  DELETE FROM leads WHERE id = v_lead_id;                       -- hard
  UPDATE leads SET deleted_at = now() WHERE id = v_lead2_id;    -- soft (NULL->NOT NULL)

  SET LOCAL session_replication_role = origin;

  -- ═══ ASSERT: deleted_leads_log capturou os dois, apesar do replica role ═══
  SELECT count(*) INTO v_hard FROM deleted_leads_log WHERE lead_id = v_lead_id  AND delete_type = 'hard';
  SELECT count(*) INTO v_soft FROM deleted_leads_log WHERE lead_id = v_lead2_id AND delete_type = 'soft';

  RAISE NOTICE '=== EVIDÊNCIA ===';
  RAISE NOTICE '  deleted_leads_log hard (lead %) = % (esperado 1)', v_lead_id,  v_hard;
  RAISE NOTICE '  deleted_leads_log soft (lead %) = % (esperado 1)', v_lead2_id, v_soft;

  ASSERT v_hard = 1, FORMAT('FALHOU: hard-delete sob replica NÃO logado (rows=%s, esperado 1). Trigger não está ENABLE ALWAYS.', v_hard);
  ASSERT v_soft = 1, FORMAT('FALHOU: soft-delete sob replica NÃO logado (rows=%s, esperado 1).', v_soft);

  RAISE NOTICE '=== PASSOU: hard+soft delete sob replica role auditados em deleted_leads_log ===';
END $$;

ROLLBACK;
