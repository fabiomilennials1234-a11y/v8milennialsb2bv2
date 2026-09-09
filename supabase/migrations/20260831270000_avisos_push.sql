-- Push: o Aviso alcança quem está longe do CRM. Issue #1893, ADR-0035.
--
-- Push é o canal mais intrusivo do produto — chega no bolso, fora do horário,
-- sem contexto. Duas restrições nascem com ele, e são o que o torna suportável:
-- só os três tipos quentes, e só para quem NÃO tem aba viva. Repetir no celular
-- o que a pessoa está lendo na tela é o caminho mais rápido para ela desligar
-- tudo — e perder também o alerta que importava.
--
-- A fila mora no banco, não na edge function: quem decide quem recebe é a mesma
-- regra que decide o que nasce, e ela já vive aqui.

-- Presença: um carimbo por pessoa e organização, renovado enquanto a aba está
-- visível. Não é sessão (que sobrevive à aba fechada) nem conexão de realtime
-- (que sobrevive à aba escondida): é "tem alguém olhando agora".
CREATE TABLE IF NOT EXISTS public.user_presence (
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, organization_id)
);

COMMENT ON TABLE public.user_presence IS
  'Último instante em que a pessoa tinha o CRM visível numa aba (#1893). Governa se o push sai.';

ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_presence_select_own ON public.user_presence;
CREATE POLICY user_presence_select_own
  ON public.user_presence FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.user_presence FROM anon;
GRANT SELECT ON public.user_presence TO authenticated;

-- Escrita só pela função: o carimbo é do próprio usuário, sempre, e não há
-- motivo para o front poder escrever presença de outra pessoa.
CREATE OR REPLACE FUNCTION public.fn_registrar_presenca(p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_organization_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.user_presence (user_id, organization_id, last_seen_at)
  VALUES (auth.uid(), p_organization_id, now())
  ON CONFLICT (user_id, organization_id)
  DO UPDATE SET last_seen_at = now();
END;
$$;

COMMENT ON FUNCTION public.fn_registrar_presenca IS
  'Carimba presença do próprio usuário na organização (#1893). O front chama enquanto a aba está visível.';

REVOKE ALL ON FUNCTION public.fn_registrar_presenca(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_registrar_presenca(uuid) TO authenticated;

-- Marca de envio no próprio Aviso: sem ela, o cron de um minuto reenviaria o
-- mesmo push a cada passada.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS pushed_at timestamptz;

COMMENT ON COLUMN public.notifications.pushed_at IS
  'Quando este Aviso saiu por push. NULL = nunca saiu. Um push repetido é pior que nenhum.';

CREATE INDEX IF NOT EXISTS notifications_pendentes_de_push_idx
  ON public.notifications (created_at)
  WHERE pushed_at IS NULL AND read_at IS NULL;

-- A fila.
CREATE OR REPLACE FUNCTION public.fn_avisos_pendentes_de_push(
  p_janela_de_presenca interval DEFAULT interval '2 minutes',
  p_idade_maxima       interval DEFAULT interval '15 minutes',
  p_limite             integer  DEFAULT 200
)
RETURNS TABLE (
  aviso_id        uuid,
  user_id         uuid,
  organization_id uuid,
  type            text,
  title           text,
  description     text,
  link            text,
  group_key       text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT n.id, n.user_id, n.organization_id, n.type, n.title, n.description, n.link, n.group_key
    FROM public.notifications n
   WHERE n.pushed_at IS NULL
     AND n.read_at IS NULL
     -- Só o canal quente. Agenda e sistema ficam no sino.
     AND n.type IN ('lead_message', 'transfer_to_human', 'lead_new', 'workflow_alert', 'cron_drift')
     -- Backlog velho não vira enxurrada de push quando o cron volta a rodar.
     AND n.created_at > now() - p_idade_maxima
     AND (public.fn_preferencias_de_aviso(n.user_id, n.organization_id) ->> 'push_enabled')::boolean
     AND NOT EXISTS (
       SELECT 1 FROM public.user_presence p
        WHERE p.user_id = n.user_id
          AND p.organization_id = n.organization_id
          AND p.last_seen_at > now() - p_janela_de_presenca
     )
     AND EXISTS (
       SELECT 1 FROM public.push_subscriptions s
        WHERE s.user_id = n.user_id
     )
   ORDER BY n.created_at
   LIMIT p_limite;
$$;

COMMENT ON FUNCTION public.fn_avisos_pendentes_de_push IS
  'Avisos quentes de quem não tem aba viva, quer push e tem aparelho registrado (#1893).';

CREATE OR REPLACE FUNCTION public.fn_marcar_push_enviado(p_aviso_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total integer;
BEGIN
  IF p_aviso_ids IS NULL OR array_length(p_aviso_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.notifications
     SET pushed_at = now()
   WHERE id = ANY(p_aviso_ids)
     AND pushed_at IS NULL;

  GET DIAGNOSTICS v_total = ROW_COUNT;
  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_avisos_pendentes_de_push(interval, interval, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_marcar_push_enviado(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_avisos_pendentes_de_push(interval, interval, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_marcar_push_enviado(uuid[]) TO service_role;
