-- ============================================================================
-- Sincronização reversa leads → phone_ai_preferences
--
-- Motivação: uma RPC nova (toggle_phone_ai) e uma existente (toggle_lead_ai)
-- já escrevem em ambos os lugares. Esta trigger é uma **rede de segurança**:
-- se QUALQUER outro caminho (script manual, integração futura, trigger de
-- workflow) mudar leads.ai_disabled direto, a preferência canônica também
-- é atualizada — preservando a invariante "fonte única = phone_ai_preferences".
--
-- Regras:
--   - Só dispara quando ai_disabled realmente muda (evita loops).
--   - Só dispara se normalized_phone estiver presente (sem phone não há
--     chave canônica).
--   - UPSERT, nunca DELETE — histórico de quem desligou é preservado.
--   - SECURITY: roda no contexto do usuário (no SECURITY DEFINER) — só
--     entra em ação se a UPDATE original passou pelas RLS de leads.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_lead_ai_to_preferences()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Apenas quando a flag realmente muda
  IF NEW.ai_disabled IS DISTINCT FROM OLD.ai_disabled THEN
    -- Exige normalized_phone para ter chave canônica
    IF NEW.normalized_phone IS NOT NULL AND length(NEW.normalized_phone) > 0 THEN
      INSERT INTO public.phone_ai_preferences (
        organization_id, normalized_phone, ai_disabled, set_by, set_at
      ) VALUES (
        NEW.organization_id,
        NEW.normalized_phone,
        NEW.ai_disabled,
        NEW.ai_disabled_by,  -- Pode ser NULL se o caller não preencheu
        COALESCE(NEW.ai_disabled_at, now())
      )
      ON CONFLICT (organization_id, normalized_phone) DO UPDATE
      SET ai_disabled = EXCLUDED.ai_disabled,
          set_by = COALESCE(EXCLUDED.set_by, public.phone_ai_preferences.set_by),
          set_at = EXCLUDED.set_at;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_leads_sync_ai_to_preferences
  AFTER UPDATE OF ai_disabled ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.sync_lead_ai_to_preferences();

COMMENT ON FUNCTION public.sync_lead_ai_to_preferences IS
  'Rede de segurança: sincroniza phone_ai_preferences quando leads.ai_disabled '
  'muda por qualquer caminho. Mantém a invariante "fonte única = preferences" '
  'mesmo se alguém bypassar as RPCs canônicas.';
