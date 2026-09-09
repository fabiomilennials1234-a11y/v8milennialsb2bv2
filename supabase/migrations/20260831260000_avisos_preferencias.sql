-- Preferências de Aviso, por usuário E organização. Issue #1890, ADR-0035.
--
-- A regra que atravessa tudo: preferência corta ENTREGA, nunca REGISTRO. O
-- Aviso é sempre gravado; o que muda é se ele toca, se aparece na tela e se
-- viaja para o celular. Histórico com buraco torna "não recebi" indebugável.
--
-- Por organização porque a mesma pessoa é administradora numa e vendedora na
-- outra: alerta de automação parada importa num contexto e é ruído no outro.
--
-- Colunas fixas para o que é global; `overrides` em jsonb para o desvio por
-- tipo. Assim um tipo novo de Aviso — e esta entrega já criou seis — ganha
-- preferência sem migration, com o padrão vindo do código.

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id                  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sound_enabled            boolean NOT NULL DEFAULT true,
  volume                   smallint NOT NULL DEFAULT 55 CHECK (volume BETWEEN 0 AND 100),
  -- Hora local de São Paulo, 0-23. NULL nos dois = sem horário silencioso.
  quiet_hours_start        smallint CHECK (quiet_hours_start BETWEEN 0 AND 23),
  quiet_hours_end          smallint CHECK (quiet_hours_end BETWEEN 0 AND 23),
  mute_active_conversation boolean NOT NULL DEFAULT true,
  push_enabled             boolean NOT NULL DEFAULT false,
  overrides                jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz,
  CONSTRAINT notification_preferences_por_usuario_e_org UNIQUE (user_id, organization_id)
);

COMMENT ON TABLE public.notification_preferences IS
  'Preferências de entrega de Aviso, por usuário e organização (ADR-0035). Nunca governam o registro, só a entrega.';
COMMENT ON COLUMN public.notification_preferences.overrides IS
  'Desvio por tipo de Aviso: {"workflow_alert": {"som": false}}. Tipo ausente segue o padrão do código.';
COMMENT ON COLUMN public.notification_preferences.mute_active_conversation IS
  'Não tocar pela conversa que já está aberta na tela — quem está olhando não precisa ser avisado.';

CREATE INDEX IF NOT EXISTS notification_preferences_org_idx
  ON public.notification_preferences (organization_id);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

-- Preferência é pessoal: ninguém lê nem escreve a do colega, nem o admin da
-- organização. Não há caso de uso para isso, e há dano óbvio se houver.
DROP POLICY IF EXISTS notification_preferences_select_own ON public.notification_preferences;
CREATE POLICY notification_preferences_select_own
  ON public.notification_preferences FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS notification_preferences_insert_own ON public.notification_preferences;
CREATE POLICY notification_preferences_insert_own
  ON public.notification_preferences FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND organization_id IN (SELECT public.get_my_organization_ids())
  );

DROP POLICY IF EXISTS notification_preferences_update_own ON public.notification_preferences;
CREATE POLICY notification_preferences_update_own
  ON public.notification_preferences FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND organization_id IN (SELECT public.get_my_organization_ids())
  );

DROP POLICY IF EXISTS notification_preferences_delete_own ON public.notification_preferences;
CREATE POLICY notification_preferences_delete_own
  ON public.notification_preferences FOR DELETE TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.notification_preferences FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO authenticated;

-- Leitura para o servidor: o envio de push roda numa edge function, onde não há
-- navegador nem armazenamento local. Quem nunca configurou nada recebe os
-- padrões, sem linha no banco — a ausência de preferência não pode virar
-- ausência de entrega.
CREATE OR REPLACE FUNCTION public.fn_preferencias_de_aviso(
  p_user_id         uuid,
  p_organization_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT to_jsonb(p) - 'id' - 'created_at' - 'updated_at'
       FROM public.notification_preferences p
      WHERE p.user_id = p_user_id
        AND p.organization_id = p_organization_id),
    jsonb_build_object(
      'organization_id',          p_organization_id,
      'user_id',                  p_user_id,
      'sound_enabled',            true,
      'volume',                   55,
      'quiet_hours_start',        NULL,
      'quiet_hours_end',          NULL,
      'mute_active_conversation', true,
      'push_enabled',             false,
      'overrides',                '{}'::jsonb
    )
  );
$$;

COMMENT ON FUNCTION public.fn_preferencias_de_aviso IS
  'Preferências de entrega de uma pessoa numa organização, com os padrões quando não há linha (#1890).';

REVOKE ALL ON FUNCTION public.fn_preferencias_de_aviso(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_preferencias_de_aviso(uuid, uuid) TO authenticated, service_role;
