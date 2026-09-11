-- SCRUM-597: resumos por caixa, fila limitada e ferramentas de conversa.
-- Toda função recebe org por parâmetro e, portanto, é exclusiva de service_role.

ALTER TABLE public.conversation_summaries
  ADD COLUMN IF NOT EXISTS instance_id uuid,
  ADD COLUMN IF NOT EXISTS source_last_message_at timestamptz;

DROP INDEX IF EXISTS public.idx_conversation_summaries_lead_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_summaries_org_lead_instance
  ON public.conversation_summaries (organization_id, lead_id, instance_id)
  NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS idx_conversation_summaries_instance_source
  ON public.conversation_summaries (organization_id, instance_id, source_last_message_at DESC);

COMMENT ON COLUMN public.conversation_summaries.instance_id IS
  'Caixa WhatsApp cuja conversa foi resumida. NULL identifica resumo legado/agregado, visível no Oráculo apenas em escopo de organização.';
COMMENT ON COLUMN public.conversation_summaries.source_last_message_at IS
  'Watermark do evento mais recente incorporado ao resumo. Controla atualização sem usar updated_at mutável como tempo de negócio.';

-- Resumo legado pode misturar caixas. Member só lê resumo ligado a caixa que
-- alcança e a lead que atende; admin/master preserva acesso da organização.
CREATE POLICY conversation_summaries_scoped_read
ON public.conversation_summaries AS RESTRICTIVE FOR SELECT TO authenticated
USING (
  (SELECT public.is_master_user())
  OR EXISTS (
    SELECT 1 FROM public.team_members tm
    WHERE tm.user_id = (SELECT auth.uid())
      AND tm.organization_id = conversation_summaries.organization_id
      AND tm.is_active
      AND (
        tm.role = 'admin'
        OR (
          conversation_summaries.instance_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.leads l
            WHERE l.id = conversation_summaries.lead_id
              AND l.organization_id = conversation_summaries.organization_id
              AND tm.id IN (l.sdr_id, l.closer_id, l.pre_sale_responsible_id, l.sale_responsible_id)
          )
          AND (
            NOT EXISTS (
              SELECT 1 FROM public.whatsapp_instance_allowed_members a
              WHERE a.whatsapp_instance_id = conversation_summaries.instance_id
            )
            OR EXISTS (
              SELECT 1 FROM public.whatsapp_instance_allowed_members a
              WHERE a.whatsapp_instance_id = conversation_summaries.instance_id
                AND a.team_member_id = tm.id
            )
          )
        )
      )
  )
);

CREATE TABLE public.conversation_summary_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  instance_id uuid NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  last_message_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'dead_letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, lead_id, instance_id)
);

CREATE INDEX conversation_summary_jobs_claim_idx
  ON public.conversation_summary_jobs (status, next_attempt_at, last_message_at)
  WHERE status IN ('pending', 'processing');
ALTER TABLE public.conversation_summary_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.conversation_summary_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.conversation_summary_jobs TO service_role;

CREATE OR REPLACE FUNCTION public.oraculo_chat_scope_allows(
  p_organization_id uuid,
  p_team_member_id uuid,
  p_lead_id uuid,
  p_instance_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.leads l
    JOIN public.whatsapp_instances wi
      ON wi.id = p_instance_id AND wi.organization_id = p_organization_id
    WHERE l.id = p_lead_id
      AND l.organization_id = p_organization_id
      AND (
        p_team_member_id IS NULL
        OR (
          p_team_member_id IN (l.sdr_id, l.closer_id, l.pre_sale_responsible_id, l.sale_responsible_id)
          AND (
            NOT EXISTS (
              SELECT 1 FROM public.whatsapp_instance_allowed_members a
              WHERE a.whatsapp_instance_id = p_instance_id
            )
            OR EXISTS (
              SELECT 1 FROM public.whatsapp_instance_allowed_members a
              WHERE a.whatsapp_instance_id = p_instance_id
                AND a.team_member_id = p_team_member_id
            )
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.oraculo_conversas(
  p_organization_id uuid,
  p_team_member_id uuid,
  p_periodo_dias integer,
  p_limite integer
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH elegiveis AS (
    SELECT w.lead_id, w.instance_id, w.last_message_time, l.name AS lead_nome,
           s.summary, s.sentiment, s.lead_temperature, s.objections,
           s.next_action, s.updated_at AS resumida_em
    FROM public.whatsapp_conversation_summary w
    JOIN public.leads l ON l.id = w.lead_id AND l.organization_id = w.organization_id
    LEFT JOIN public.conversation_summaries s
      ON s.organization_id = w.organization_id
     AND s.lead_id = w.lead_id
     AND s.instance_id = w.instance_id
    WHERE w.organization_id = p_organization_id
      AND NOT w.is_group
      AND w.lead_id IS NOT NULL
      AND w.last_message_time >= now() - make_interval(days => greatest(1, least(coalesce(p_periodo_dias, 30), 365)))
      AND public.oraculo_chat_scope_allows(p_organization_id, p_team_member_id, w.lead_id, w.instance_id)
  ), objecoes AS (
    SELECT o.objecao, count(*) AS ocorrencias
    FROM elegiveis e
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(e.objections, '[]'::jsonb)) o(objecao)
    GROUP BY o.objecao
  )
  SELECT jsonb_build_object(
    'escopo', CASE WHEN p_team_member_id IS NULL THEN 'organizacao' ELSE 'pessoa' END,
    'periodo_dias', greatest(1, least(coalesce(p_periodo_dias, 30), 365)),
    'conversas', (SELECT count(*) FROM elegiveis),
    'resumidas', (SELECT count(*) FROM elegiveis WHERE summary IS NOT NULL),
    'cobertura_percentual', (
      SELECT CASE WHEN count(*) = 0 THEN 0
        ELSE round(100.0 * count(*) FILTER (WHERE summary IS NOT NULL) / count(*), 1) END
      FROM elegiveis
    ),
    'sentimentos', (
      SELECT coalesce(jsonb_object_agg(sentiment, total), '{}'::jsonb)
      FROM (SELECT sentiment, count(*) AS total FROM elegiveis WHERE sentiment IS NOT NULL GROUP BY sentiment) x
    ),
    'temperaturas', (
      SELECT coalesce(jsonb_object_agg(lead_temperature, total), '{}'::jsonb)
      FROM (SELECT lead_temperature, count(*) AS total FROM elegiveis WHERE lead_temperature IS NOT NULL GROUP BY lead_temperature) x
    ),
    'objecoes_frequentes', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('objecao', objecao, 'ocorrencias', ocorrencias)
        ORDER BY ocorrencias DESC, objecao), '[]'::jsonb)
      FROM (SELECT * FROM objecoes ORDER BY ocorrencias DESC, objecao
            LIMIT greatest(1, least(coalesce(p_limite, 20), 50))) top
    ),
    'recentes', (
      SELECT coalesce(jsonb_agg(item ORDER BY last_message_time DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'lead_id', lead_id, 'instance_id', instance_id, 'lead', lead_nome,
          'resumo', summary, 'sentimento', sentiment, 'temperatura', lead_temperature,
          'proxima_acao', next_action, 'ultima_mensagem_em', last_message_time,
          'resumida_em', resumida_em
        ) AS item, last_message_time
        FROM elegiveis WHERE summary IS NOT NULL
        ORDER BY last_message_time DESC
        LIMIT greatest(1, least(coalesce(p_limite, 20), 50))
      ) r
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.oraculo_conversa_detalhe(
  p_organization_id uuid,
  p_team_member_id uuid,
  p_lead_id uuid,
  p_instance_id uuid,
  p_limite integer
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT public.oraculo_chat_scope_allows(p_organization_id, p_team_member_id, p_lead_id, p_instance_id)
      THEN '[]'::jsonb
    ELSE coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'papel', CASE WHEN m.direction = 'incoming' THEN 'lead' ELSE 'vendedor' END,
        'conteudo', m.content,
        'enviada_em', m."timestamp"
      ) ORDER BY m."timestamp", m.id)
      FROM (
        SELECT id, direction, content, "timestamp"
        FROM public.whatsapp_messages
        WHERE organization_id = p_organization_id
          AND lead_id = p_lead_id
          AND instance_id = p_instance_id
          AND deleted_at IS NULL
          AND content IS NOT NULL
        ORDER BY "timestamp" DESC, id DESC
        LIMIT greatest(1, least(coalesce(p_limite, 100), 200))
      ) m
    ), '[]'::jsonb)
  END;
$$;

CREATE OR REPLACE FUNCTION public.claim_conversation_summary_jobs(p_limit integer DEFAULT 10)
RETURNS TABLE(id uuid, organization_id uuid, lead_id uuid, instance_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.conversation_summary_jobs AS j
    (organization_id, lead_id, instance_id, last_message_at)
  SELECT w.organization_id, w.lead_id, w.instance_id, w.last_message_time
  FROM public.whatsapp_conversation_summary w
  LEFT JOIN public.conversation_summaries s
    ON s.organization_id = w.organization_id
   AND s.lead_id = w.lead_id
   AND s.instance_id = w.instance_id
  WHERE w.lead_id IS NOT NULL
    AND NOT w.is_group
    AND w.last_message_time < now() - interval '1 hour'
    AND (s.id IS NULL OR s.source_last_message_at IS NULL OR s.source_last_message_at < w.last_message_time)
  ON CONFLICT (organization_id, lead_id, instance_id) DO UPDATE
    SET last_message_at = EXCLUDED.last_message_at,
        status = 'pending', attempts = 0, next_attempt_at = now(),
        lease_until = NULL, last_error = NULL, updated_at = now()
  WHERE EXCLUDED.last_message_at > j.last_message_at;

  RETURN QUERY
  WITH candidates AS (
    SELECT j.id
    FROM public.conversation_summary_jobs j
    WHERE (j.status = 'pending' AND j.next_attempt_at <= now())
       OR (j.status = 'processing' AND j.lease_until < now())
    ORDER BY j.last_message_at
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(coalesce(p_limit, 10), 20))
  ), claimed AS (
    UPDATE public.conversation_summary_jobs j
    SET status = 'processing', attempts = j.attempts + 1,
        lease_until = now() + interval '10 minutes', updated_at = now()
    FROM candidates c
    WHERE j.id = c.id
    RETURNING j.id, j.organization_id, j.lead_id, j.instance_id
  )
  SELECT c.id, c.organization_id, c.lead_id, c.instance_id FROM claimed c;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_conversation_summary_job(p_job_id uuid, p_error text DEFAULT NULL)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.conversation_summary_jobs
  SET status = CASE WHEN p_error IS NULL THEN 'completed'
                    WHEN attempts >= 3 THEN 'dead_letter' ELSE 'pending' END,
      next_attempt_at = CASE WHEN p_error IS NULL OR attempts >= 3 THEN next_attempt_at
                             ELSE now() + make_interval(mins => (5 * attempts)) END,
      lease_until = NULL,
      last_error = left(p_error, 1000),
      updated_at = now()
  WHERE id = p_job_id AND status = 'processing';
$$;

REVOKE ALL ON FUNCTION public.oraculo_chat_scope_allows(uuid,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oraculo_conversas(uuid,uuid,integer,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oraculo_conversa_detalhe(uuid,uuid,uuid,uuid,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_conversation_summary_jobs(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_conversation_summary_job(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oraculo_chat_scope_allows(uuid,uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.oraculo_conversas(uuid,uuid,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.oraculo_conversa_detalhe(uuid,uuid,uuid,uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_conversation_summary_jobs(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_conversation_summary_job(uuid,text) TO service_role;

COMMENT ON FUNCTION public.oraculo_conversa_detalhe(uuid,uuid,uuid,uuid,integer) IS
  'Transcrição WhatsApp filtrada por org, atribuição da lead e allowlist da caixa. Fora do escopo retorna array vazio. service_role only.';

CREATE OR REPLACE FUNCTION public.invoke_summarize_conversations_batch()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_secret text;
BEGIN
  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';
  SELECT regexp_replace(value, '/functions/v1/.*$', '/functions/v1/summarize-conversations-batch')
    INTO v_url
    FROM public.cron_config
    WHERE value LIKE 'https://%/functions/v1/%'
    ORDER BY key
    LIMIT 1;
  IF coalesce(v_url, '') = '' OR coalesce(v_secret, '') = '' THEN
    RAISE WARNING '[summarize-conversations-batch] cron_config incompleto';
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{"limit":10}'::jsonb
  );
EXCEPTION
  WHEN invalid_schema_name OR undefined_function OR undefined_table THEN RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_summarize_conversations_batch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_summarize_conversations_batch() TO service_role;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'summarize-conversations-batch') THEN
      PERFORM cron.unschedule('summarize-conversations-batch');
    END IF;
    PERFORM cron.schedule(
      'summarize-conversations-batch',
      '7-59/10 * * * *',
      'SELECT public.invoke_summarize_conversations_batch()'
    );
  END IF;
END
$cron$;
