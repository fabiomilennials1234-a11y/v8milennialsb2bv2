-- Varreduras: os quatro alertas derivados viram registro. Issue #1887, ADR-0035.
--
-- Follow-up atrasado e reunião de hoje são ESTADOS, não eventos: verdadeiros
-- continuamente, o dia inteiro. Enquanto o sino os derivava por consulta, não
-- havia como distinguir "chegou" de "ainda está lá" — e sem essa distinção não
-- há como tocar som sem tocar para sempre.
--
-- A chave de agrupamento carrega o dia (ou a hora, na janela curta). É isso que
-- torna a varredura idempotente: chamar de novo encontra o mesmo Aviso vivo e
-- não escreve nada. Sem isso, um cron de 15 em 15 minutos inflaria o contador
-- 96 vezes por dia.

-- Destinatário de um follow-up: quem foi designado, ou o dono do Lead.
CREATE OR REPLACE FUNCTION public.fn_varredura_avisos_followups()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r      record;
  v_dono uuid;
  v_dia  text := to_char(timezone('America/Sao_Paulo', now()), 'YYYY-MM-DD');
  v_fim  timestamptz := date_trunc('day', timezone('America/Sao_Paulo', now()))
                        + interval '1 day' - interval '1 microsecond';
  v_total integer := 0;
BEGIN
  FOR r IN
    SELECT f.id, f.organization_id, f.lead_id, f.assigned_to, f.title, f.due_date,
           l.name AS lead_nome
      FROM public.follow_ups f
      JOIN public.leads l ON l.id = f.lead_id
     WHERE f.completed_at IS NULL
       AND f.archived_at IS NULL
       AND f.due_date <= v_fim
  LOOP
    v_dono := COALESCE(
      (SELECT tm.user_id FROM public.team_members tm
        WHERE tm.id = r.assigned_to AND tm.is_active AND tm.user_id IS NOT NULL),
      public.fn_dono_do_lead(r.lead_id)
    );
    CONTINUE WHEN v_dono IS NULL;

    -- Varredura não é evento: se o Aviso do dia já está vivo, ela não toca nele.
    -- Sem isto, o contador contaria passadas do cron, não fatos do mundo.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.notifications n
       WHERE n.user_id = v_dono
         AND n.group_key = 'fup:' || r.id::text || ':' || v_dia
         AND n.read_at IS NULL
    );

    PERFORM public.fn_emit_aviso(
      p_organization_id => r.organization_id,
      p_user_id         => v_dono,
      p_type            => CASE WHEN r.due_date < now() THEN 'follow_up_overdue'
                                ELSE 'follow_up_due' END,
      p_group_key       => 'fup:' || r.id::text || ':' || v_dia,
      p_title           => CASE WHEN r.due_date < now() THEN 'Follow-up atrasado'
                                ELSE 'Follow-up para hoje' END,
      p_description     => NULLIF(concat_ws(' · ', NULLIF(r.title, ''), NULLIF(r.lead_nome, '')), ''),
      p_link            => '/follow-ups',
      p_lead_id         => r.lead_id,
      p_entity_id       => r.id
    );
    v_total := v_total + 1;
  END LOOP;

  RETURN v_total;
END;
$$;

COMMENT ON FUNCTION public.fn_varredura_avisos_followups IS
  'Materializa os follow-ups vencendo hoje e os atrasados como Aviso (#1887). Idempotente no dia: a chave carrega a data.';

-- A reunião que começa dentro de uma hora — o único derivado que perde todo o
-- valor se atrasar, e por isso o único que precisa de janela curta.
CREATE OR REPLACE FUNCTION public.fn_varredura_avisos_reuniao_proxima()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r       record;
  v_dono  uuid;
  v_total integer := 0;
BEGIN
  FOR r IN
    SELECT pe.id, pe.organization_id, pe.lead_id, pe.assigned_to,
           (pe.metadata ->> 'meeting_date')::timestamptz AS meeting_date,
           l.name AS lead_nome, l.company AS lead_empresa
      FROM public.pipeline_entries pe
      JOIN public.leads l ON l.id = pe.lead_id
     WHERE pe.closed_at IS NULL
       AND pe.metadata ? 'meeting_date'
       AND (pe.metadata ->> 'meeting_date') <> ''
       AND (pe.metadata ->> 'meeting_date')::timestamptz BETWEEN now() AND now() + interval '1 hour'
  LOOP
    v_dono := COALESCE(
      (SELECT tm.user_id FROM public.team_members tm
        WHERE tm.id = r.assigned_to AND tm.is_active AND tm.user_id IS NOT NULL),
      public.fn_dono_do_lead(r.lead_id)
    );
    CONTINUE WHEN v_dono IS NULL;

    -- Mesma regra da varredura diária: o cron de 15 minutos não pode inflar o
    -- contador 96 vezes por dia.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.notifications n
       WHERE n.user_id = v_dono
         AND n.group_key = 'meet_soon:' || r.id::text || ':' ||
                           to_char(r.meeting_date, 'YYYY-MM-DD"T"HH24')
         AND n.read_at IS NULL
    );

    PERFORM public.fn_emit_aviso(
      p_organization_id => r.organization_id,
      p_user_id         => v_dono,
      p_type            => 'meeting_soon',
      -- A hora entra na chave: reunião remarcada para outra hora é outro aviso.
      p_group_key       => 'meet_soon:' || r.id::text || ':' ||
                           to_char(r.meeting_date, 'YYYY-MM-DD"T"HH24'),
      p_title           => 'Reunião em menos de 1 hora',
      p_description     => NULLIF(concat_ws(' · ',
                             NULLIF(r.lead_nome, ''),
                             NULLIF(r.lead_empresa, ''),
                             to_char(timezone('America/Sao_Paulo', r.meeting_date), 'HH24"h"MI')), ''),
      p_link            => '/pipe-confirmacao',
      p_lead_id         => r.lead_id,
      p_entity_id       => r.id
    );
    v_total := v_total + 1;
  END LOOP;

  RETURN v_total;
END;
$$;

COMMENT ON FUNCTION public.fn_varredura_avisos_reuniao_proxima IS
  'Materializa a reunião que começa dentro de uma hora como Aviso (#1887). A hora entra na chave: remarcação vira aviso novo.';

REVOKE ALL ON FUNCTION public.fn_varredura_avisos_followups() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_varredura_avisos_reuniao_proxima() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_varredura_avisos_followups() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_varredura_avisos_reuniao_proxima() TO service_role;

-- Agendamento. Chamada direta ao banco: não há edge function no caminho, então
-- não há segredo de cron para derivar — uma superfície a menos para quebrar.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('avisos-varredura-followups')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'avisos-varredura-followups');
    PERFORM cron.unschedule('avisos-varredura-reuniao-proxima')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'avisos-varredura-reuniao-proxima');

    -- 07:00 em São Paulo (UTC-3), quando o vendedor planeja o dia.
    PERFORM cron.schedule('avisos-varredura-followups', '0 10 * * *',
                          'SELECT public.fn_varredura_avisos_followups()');
    PERFORM cron.schedule('avisos-varredura-reuniao-proxima', '*/15 * * * *',
                          'SELECT public.fn_varredura_avisos_reuniao_proxima()');
  END IF;
END
$$;
