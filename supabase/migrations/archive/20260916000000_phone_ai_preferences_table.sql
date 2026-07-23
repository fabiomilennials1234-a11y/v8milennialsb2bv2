-- ============================================================================
-- phone_ai_preferences — Fonte de verdade para o estado "IA ligada/desligada"
-- de um contato, independente de existir ou não um lead.
--
-- Motivação: incidentes REALSC (2026-04-22):
--   1. Toggle falha em contato sem lead porque toggle_conversation_ai tenta
--      INSERT shadow lead com origin='shadow_ai_toggle' (valor inexistente no
--      enum lead_origin) → 7 retries em 7 segundos, IA nunca desliga.
--   2. IA dispara em cima do humano em conversa iniciada pelo operador, porque
--      lead criado na 1ª incoming vem com ai_disabled=false default sem
--      consultar intenção prévia do vendedor.
--
-- Decisão arquitetural (design.md): fonte única por (organization_id,
-- normalized_phone). leads.ai_disabled continua existindo como denormalização
-- mantida em sincronia pelas RPCs, para não quebrar consumidores atuais
-- (agent-message, evolution-webhook, get_lead_ai_status).
--
-- Segurança: RLS ativa. Apenas SELECT por team_member ativo da mesma org.
-- INSERT/UPDATE/DELETE não têm policy → só são possíveis via RPC SECURITY
-- DEFINER (toggle_phone_ai, toggle_lead_ai). Frontend não toca direto.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.phone_ai_preferences (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  normalized_phone TEXT NOT NULL,
  ai_disabled BOOLEAN NOT NULL DEFAULT false,
  set_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  set_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, normalized_phone),
  CONSTRAINT phone_ai_preferences_normalized_phone_nonempty
    CHECK (length(normalized_phone) > 0)
);

CREATE INDEX IF NOT EXISTS idx_phone_ai_preferences_phone
  ON public.phone_ai_preferences (normalized_phone);

-- updated_at mantido em sincronia via trigger reutilizada
CREATE TRIGGER update_phone_ai_preferences_updated_at
  BEFORE UPDATE ON public.phone_ai_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

ALTER TABLE public.phone_ai_preferences ENABLE ROW LEVEL SECURITY;

-- SELECT: team_member ativo da mesma org pode ler
CREATE POLICY "phone_ai_prefs_select_same_org"
  ON public.phone_ai_preferences
  FOR SELECT
  USING (
    organization_id IN (
      SELECT tm.organization_id
      FROM public.team_members tm
      WHERE tm.user_id = auth.uid()
        AND tm.is_active = true
    )
  );

-- Sem policy de INSERT/UPDATE/DELETE: writes só via RPC SECURITY DEFINER.
-- Isso impede o frontend de fazer UPSERT direto e contornar as regras.

COMMENT ON TABLE public.phone_ai_preferences IS
  'Fonte de verdade do estado ai_disabled por (organização, telefone normalizado). '
  'Existe independentemente de lead. leads.ai_disabled é denormalização mantida '
  'em sincronia por toggle_phone_ai e toggle_lead_ai. Escrita apenas via RPC '
  'SECURITY DEFINER — não há policy de INSERT/UPDATE/DELETE.';

COMMENT ON COLUMN public.phone_ai_preferences.normalized_phone IS
  'Telefone normalizado via normalize_brazilian_phone(). 11 dígitos para mobile, '
  '10 para fixo. Mesma normalização usada em leads.normalized_phone.';

COMMENT ON COLUMN public.phone_ai_preferences.set_by IS
  'auth.users.id do vendedor que alterou a preferência por último. NULL se usuário '
  'foi deletado ou se a preferência foi criada por processo automático.';
