-- ===========================================================================
-- ROLLBACK — 20270821100000 (SCRUM-326)
-- ===========================================================================
-- 🔴 LEIA ANTES DE RODAR: este rollback REABRE a falha de propósito.
--
-- Ele devolve o corpo que autoriza por `role = 'admin'` SEM `is_active`, o que
-- em produção significa 15 admins DESATIVADOS voltando a exportar lead completo
-- — incluindo conversas, mensagens e registros de consentimento. E devolve o
-- `LIMIT 1`, que faz admin de duas orgs receber NULL em silêncio para leads da
-- org não sorteada.
--
-- Só existe porque migration sem rollback é migration que ninguém ousa aplicar.
-- Se o problema for a exportação ter parado de funcionar para alguém, o
-- diagnóstico provável NÃO é este arquivo: é a pessoa estar com `is_active =
-- false` em `team_members`, e a correção é reativá-la, não reabrir a função.
--
-- Os grants de `anon` e PUBLIC NÃO são restaurados. Eles nunca tiveram uso
-- legítimo — `auth.uid()` de anon é NULL e o corpo sempre levantou
-- 'Unauthorized'. Restaurá-los seria reintroduzir superfície por simetria, sem
-- devolver funcionalidade nenhuma.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.export_lead_data(p_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public, extensions'
AS $$
DECLARE
  v_org_id uuid;
  v_result jsonb;
BEGIN
  SELECT tm.organization_id INTO v_org_id
  FROM team_members tm WHERE tm.user_id = auth.uid() AND tm.role = 'admin' LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  SELECT jsonb_build_object(
    'lead', row_to_json(l),
    'tags', COALESCE((
      SELECT jsonb_agg(t.name)
      FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id
      WHERE lt.lead_id = p_lead_id
    ), '[]'::jsonb),
    'history', COALESCE((
      SELECT jsonb_agg(row_to_json(lh) ORDER BY lh.created_at)
      FROM lead_history lh WHERE lh.lead_id = p_lead_id
    ), '[]'::jsonb),
    'conversations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'conversation', row_to_json(c),
        'messages', COALESCE((
          SELECT jsonb_agg(row_to_json(cm) ORDER BY cm.created_at)
          FROM conversation_messages cm WHERE cm.conversation_id = c.id
        ), '[]'::jsonb)
      ))
      FROM conversations c WHERE c.lead_id = p_lead_id
    ), '[]'::jsonb),
    'consents', COALESCE((
      SELECT jsonb_agg(row_to_json(cr))
      FROM consent_records cr WHERE cr.lead_id = p_lead_id
    ), '[]'::jsonb),
    'exported_at', now(),
    'exported_by', auth.uid()
  ) INTO v_result
  FROM leads l
  WHERE l.id = p_lead_id AND l.organization_id = v_org_id;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.export_lead_data(uuid) IS NULL;
