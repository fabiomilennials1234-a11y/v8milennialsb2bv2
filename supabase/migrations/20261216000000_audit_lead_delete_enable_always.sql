-- =============================================================================
-- HOTFIX — auditoria de delete de lead à prova de bypass (replica role)
-- =============================================================================
-- Incidente 2026-06-16 (Basic4u): lead "Saúde Bem Estar"/Dra Regina sumiu do
-- funil de agendamentos sem QUALQUER rastro. Investigação:
--   - deleted_leads_log: 0 registros para Basic4u, sempre.
--   - audit_log operação DELETE: 0 para Basic4u, sempre.
--   - 1694/2659 leads vivos de Basic4u (64%) sem nenhuma linha de audit.
--
-- Causa: os triggers de log de delete em `leads` estão com tgenabled='O'
-- (ENABLE local). Triggers 'O' NÃO disparam quando a sessão roda sob
-- `session_replication_role = replica`. Qualquer hard-delete feito por SQL
-- manual de superuser (ou tool externo) sob replica role apaga o lead e os
-- dois loggers são pulados → perda silenciosa, irrecuperável sem backup.
--
-- Fix: marcar os dois loggers como ENABLE ALWAYS — disparam mesmo sob replica
-- role, fechando a brecha para QUALQUER caminho de delete. (O time já conhece
-- a semântica: ver migration 20260426100000.)
--
-- Escopo deliberado:
--   - `trg_log_lead_hard_delete` (BEFORE DELETE) → ALWAYS. Cobre o incidente.
--   - `trg_log_lead_soft_delete` (AFTER UPDATE)  → ALWAYS. Simetria; a função
--     early-returns barato quando não há transição deleted_at NULL→NOT NULL.
--   - `audit_leads` (todas ops) é deixado em 'O' de propósito: deleted_leads_log
--     já guarda snapshot completo (lead + filhos), artefato superior para
--     recuperação; tornar audit_leads ALWAYS adicionaria overhead em INSERT/
--     UPDATE sob replica sem ganho de recuperação.
--
-- replica role em runtime só ocorre em SQL manual de superuser; imports via
-- API rodam como `authenticated` (não replica) → overhead real desta mudança
-- é desprezível.
-- =============================================================================

-- 1) Loggers de delete passam a disparar SEMPRE (inclusive sob replica role)
ALTER TABLE public.leads ENABLE ALWAYS TRIGGER trg_log_lead_hard_delete;
ALTER TABLE public.leads ENABLE ALWAYS TRIGGER trg_log_lead_soft_delete;

-- 2) Endurecer log_lead_deletion: hoje o handler engole exceção em silêncio
--    (RETURN sem aviso) — se o INSERT no log falhar, o delete prossegue sem
--    rastro E sem sinal. Mantém non-blocking (nunca bloqueia o delete) mas
--    agora emite WARNING, tornando falhas de auditoria visíveis nos pg logs.
--    Corpo idêntico ao vigente, exceto o bloco EXCEPTION.
CREATE OR REPLACE FUNCTION public.log_lead_deletion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_type     text;
  v_row      jsonb;
  v_actor    uuid;
  v_role     text;
  v_claims   text;
  v_snapshot jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_type := 'hard';
  ELSIF TG_OP = 'UPDATE' THEN
    -- só a transição NULL -> NOT NULL conta como soft-delete
    IF OLD.deleted_at IS NOT NULL OR NEW.deleted_at IS NULL THEN
      RETURN COALESCE(NEW, OLD);
    END IF;
    v_type := 'soft';
  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- estado final do lead (soft=NEW c/ deleted_at; hard=OLD)
  v_row := to_jsonb(COALESCE(NEW, OLD));

  v_actor := COALESCE(
    (to_jsonb(COALESCE(NEW, OLD))->>'deleted_by')::uuid,
    auth.uid()
  );

  BEGIN
    v_claims := current_setting('request.jwt.claims', true);
    IF v_claims IS NOT NULL AND v_claims <> '' THEN
      v_role := (v_claims::jsonb)->>'role';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_role := NULL;
  END;

  -- snapshot: lead + filhos-chave (ainda presentes no BEFORE DELETE / no soft UPDATE)
  v_snapshot := jsonb_build_object(
    'lead', v_row,
    'conversations',    COALESCE((SELECT jsonb_agg(to_jsonb(c))  FROM public.conversations    c  WHERE c.lead_id  = OLD.id), '[]'::jsonb),
    'lead_history',     COALESCE((SELECT jsonb_agg(to_jsonb(h))  FROM public.lead_history     h  WHERE h.lead_id  = OLD.id), '[]'::jsonb),
    'meetings',         COALESCE((SELECT jsonb_agg(to_jsonb(m))  FROM public.meetings         m  WHERE m.lead_id  = OLD.id), '[]'::jsonb),
    'pipeline_entries', COALESCE((SELECT jsonb_agg(to_jsonb(pe)) FROM public.pipeline_entries pe WHERE pe.lead_id = OLD.id), '[]'::jsonb),
    'lead_tags',        COALESCE((SELECT jsonb_agg(to_jsonb(lt)) FROM public.lead_tags        lt WHERE lt.lead_id = OLD.id), '[]'::jsonb)
  );

  INSERT INTO public.deleted_leads_log (
    organization_id, lead_id, lead_name, lead_phone, lead_email,
    delete_type, deleted_by, actor_role, snapshot
  ) VALUES (
    OLD.organization_id, OLD.id, OLD.name, OLD.phone, OLD.email,
    v_type, v_actor, v_role, v_snapshot
  );

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  -- nunca bloquear o delete por causa de falha no log, mas TORNAR VISÍVEL.
  RAISE WARNING 'log_lead_deletion: falha ao auditar lead % (op %): %',
    COALESCE(NEW.id, OLD.id), TG_OP, SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

COMMENT ON FUNCTION public.log_lead_deletion() IS
  'Loga hard/soft delete de lead em deleted_leads_log com snapshot (lead + filhos). '
  'Triggers trg_log_lead_hard_delete/soft estão ENABLE ALWAYS (disparam sob replica role). '
  'Non-blocking: falha de auditoria emite WARNING mas não aborta o delete. '
  'Hotfix 2026-06-16 (incidente Basic4u — perda silenciosa de lead).';
