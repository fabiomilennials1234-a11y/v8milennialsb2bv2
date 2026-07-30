-- Duas chaves da voz, conforme a spec de 2026-07-30.
--
-- A do cliente é `whatsapp_instances.voice_calls_enabled`, que acompanha
-- parear e desconectar. A nossa é a feature `voice_calls`: sem ela a
-- integração não aparece e não há botão para o cliente religar.
--
-- O teto de números sai de `MAX_SESSIONS_PER_ORG = 2`, escrito à mão na edge
-- function quando nada tinha sido medido, e vira coluna por organização.
-- Diferente de `daily_call_cap`, aqui 0 significa zero mesmo: organização sem
-- direito a número de voz.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS voice_sessions_cap integer NOT NULL DEFAULT 10;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.organizations'::regclass
       AND conname = 'organizations_voice_sessions_cap_nonneg'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_voice_sessions_cap_nonneg
      CHECK (voice_sessions_cap >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.organizations.voice_sessions_cap IS
  'Quantos números de WhatsApp desta organização podem ter voz ligada. '
  'Padrão 10. 0 significa nenhum — ao contrário de daily_call_cap, onde quem '
  'libera é NULL.';

-- A feature nasce declarada e falsa em todo plano. Chave ausente resolveria
-- para false do mesmo jeito, mas silenciosamente: quem for editar planos
-- depois não veria que a voz existe.
UPDATE public.subscription_plans
   SET features = features || jsonb_build_object('voice_calls', false),
       updated_at = now()
 WHERE NOT (features ? 'voice_calls');
