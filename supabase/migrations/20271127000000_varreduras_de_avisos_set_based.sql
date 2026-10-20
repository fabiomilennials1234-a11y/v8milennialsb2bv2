-- 20271127000000_varreduras_de_avisos_set_based.sql
--
-- Perf (RAM/pool do Supabase de prod, plano de 4 GB). As duas varreduras de
-- avisos rodam 1×/min pelo pg_cron e eram os jobs mais caros depois do
-- cron-dispatch-minute. Esta migration troca SÓ o corpo de
--   public.fn_varredura_avisos_followups()
--   public.fn_varredura_avisos_reuniao_proxima()   (2º laço, o do funil)
-- e o índice que o 2º laço usa. Os avisos emitidos são os mesmos: mesmas
-- chaves group_key, mesmos destinatários, mesmos títulos/descrições/links,
-- mesmo retorno. Prova: tests/integration/varreduras-de-avisos-set-based.test.mjs
-- (PGlite, corpo antigo × novo sobre a mesma base sorteada, em vários relógios).
--
-- MEDIDO EM PROD (19/10, ~15h BRT, EXPLAIN ANALYZE BUFFERS, só leitura)
--
--  1. follow-ups — depois das 07h BRT o SELECT do laço revisita todo follow-up
--     atrasado aberto (499 candidatos → 460 com lead vivo) e, para cada um sem
--     atribuído (248), chama fn_donos_do_lead (plpgsql DEFINER → fn_dono_do_lead
--     com até 5 subconsultas em leads+team_members, de novo leads, e
--     organizations). Depois, um EXISTS em notifications por par (337).
--     SELECT: 9.299 blocos; + ~1.000 dos EXISTS do laço ≈ 10,3 mil/chamada.
--     Em regime estável a resposta é ZERO avisos novos (a chave é por dia).
--     Corpo novo: uma consulta set-based.
--       · team_members ativos lidos UMA vez (342 linhas, 12 páginas), em hash;
--       · flag lead_owners_n_donos lida UMA vez (124 orgs, hash), não por linha;
--       · atribuído já avisado hoje sai ANTES de ler o lead (é o caso comum:
--         235 de 499 são atribuídos);
--       · donos calculados em SQL a partir da linha de leads já lida —
--         réplica exata de fn_donos_do_lead (ver "RÉPLICA" abaixo);
--       · par já avisado sai por anti-join no notifications_reminder_lookup_idx
--         (index-only), antes de qualquer chamada a fn_emit_aviso.
--     Ensaio da consulta FINAL em prod (EXPLAIN ANALYZE, 19/10 ~15h BRT):
--     1.892 blocos, 12 ms de execução, 0 avisos novos — contra 9.299 blocos e
--     48 ms do SELECT antigo (sem contar os ~1.000 dos EXISTS do laço).
--
--  2. reunião próxima, 2º laço (funil) — varria TODAS as pipeline_entries
--     abertas com metadata.meeting_date (1.339 de 60.455; ~490 páginas de heap)
--     e convertia cada data em plpgsql, num bloco BEGIN/EXCEPTION por linha
--     (uma subtransação por linha, 1.339 por minuto). Só ~0–5 caem na janela.
--     Corpo novo: o laço lê só as candidatas de um índice de expressão sobre
--     private.fn_aviso_meeting_date_aprox(meeting_date) (janela ±1 h, mais
--     as que a função não data), e o resto do laço — conversão exata com
--     o fuso/DateStyle da sessão, janela de 20 min, espelho, desfecho, donos —
--     segue IGUAL, linha a linha. O índice é só pré-filtro: superconjunto.
--     Em prod (19/10): 27 das 1.340 entram no laço (8 na janela de ±1 h + 19
--     só-data, sempre rechecadas) — antes: todas.
--     O 1º laço (meetings) já custava 22 blocos e não muda.
--
-- POR QUE O PRÉ-FILTRO NÃO PERDE NENHUMA LINHA
--   fn_aviso_meeting_date_aprox só data texto ISO 8601 com deslocamento
--   NUMÉRICO explícito ('AAAA-MM-DD[T ]HH:MI[:SS[.f]](Z|±HH[:MM])'). Esse texto
--   é um instante absoluto: a leitura não depende de TimeZone, DateStyle nem
--   timezone_abbreviations da sessão — por isso a função é IMMUTABLE de fato,
--   sem SET. Todo o resto (sem fuso, só data, nome de fuso, abreviação,
--   'infinity', lixo) vira NULL e entra SEMPRE no laço, onde a conversão da
--   sessão decide como antes. A janela real é [now-5min, now+15min]; o índice
--   pede [now-1 h, now+1 h]. Texto que a sessão rejeita com erro não tratado
--   (fuso inexistente, '+99') também cai em NULL → entra no laço → aborta a
--   varredura como antes (comportamento preservado).
--   Em prod (19/10): 1.320 'AAAA-MM-DDTHH:MI:SS+00:00', 19 só 'AAAA-MM-DD',
--   0 inválidas; sessão do cron em UTC / ISO, MDY.
--
-- RÉPLICA de fn_donos_do_lead (follow-ups, ramo "sem atribuído")
--   principal = 1º não nulo de user_id ativo em sale_responsible_id, closer_id,
--     pre_sale_responsible_id, sdr_id, responsible_id (sem checar org, como
--     fn_dono_do_lead);
--   org sem a flag: só o principal;
--   org com a flag: principal ∪ venda ∪ pré-venda (membro da org do lead) ∪
--     lead_owners do lead (linha e membro da org do lead).
--   Ordem não importa aqui (o destino é um conjunto). O COMMENT de
--   fn_donos_do_lead passa a apontar para esta réplica: mudar lá exige mudar
--   aqui. A reunião (2º laço) continua chamando fn_donos_do_lead: lá ela roda
--   só para as poucas linhas da janela.
--
-- ÍNDICE: pipeline_entries_pending_meeting_reminder_idx (id) tinha um leitor
-- só (este laço) e sai; entra pipeline_entries_meeting_reminder_at_idx com o
-- MESMO predicado parcial (escrita igual: só linhas abertas com meeting_date).
-- Sem CONCURRENTLY: o arquivo roda em transação explícita (lock_timeout);
-- pipeline_entries tem 30 MB e o índice cobre ~1.339 linhas — o SHARE lock
-- dura o tempo de uma leitura da tabela (centenas de ms); o DROP do antigo vai
-- no fim, para o ACCESS EXCLUSIVE durar só até o COMMIT. ANALYZE antes para
-- o planejador ter estatística da expressão nova já na primeira execução.
--
-- Cada função recriada parte da definição VIGENTE de prod (md5(prosrc) de
-- 20271126000000 conferido no teste contra prod em 19/10). CREATE OR REPLACE
-- preserva owner e ACL (postgres, service_role).
--
-- ORDEM: depois de 20271126000000. Numeração provisória: renumerar ao aplicar.
-- ROLLBACK: supabase/migrations/rollback/20271127000000_varreduras_de_avisos_set_based.sql

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ─── 1. Leitura aproximada (imutável) de metadata.meeting_date ─────────────
CREATE OR REPLACE FUNCTION private.fn_aviso_meeting_date_aprox(p_texto text)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT CASE
    WHEN p_texto ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)$'
     AND pg_catalog.pg_input_is_valid(p_texto, 'timestamptz')
    THEN p_texto::timestamptz
  END
$fn$;

-- Função pura e expressão de índice: o EXECUTE é checado em toda escrita em
-- pipeline_entries que caia no predicado, como o papel que escreve
-- (authenticated via PostgREST). Sem este GRANT a escrita quebra com
-- "permission denied for function" — não revogar em massa no schema private.
GRANT EXECUTE ON FUNCTION private.fn_aviso_meeting_date_aprox(text) TO PUBLIC;

COMMENT ON FUNCTION private.fn_aviso_meeting_date_aprox(text) IS
  'Pré-filtro do índice pipeline_entries_meeting_reminder_at_idx: instante de meeting_date só quando é ISO 8601 com deslocamento numérico explícito; NULL no resto (fn_varredura_avisos_reuniao_proxima reconverte na sessão). Expressão de índice: EXECUTE precisa ficar com PUBLIC, senão toda escrita em pipeline_entries com meeting_date falha.';

CREATE INDEX IF NOT EXISTS pipeline_entries_meeting_reminder_at_idx
  ON public.pipeline_entries (private.fn_aviso_meeting_date_aprox(metadata ->> 'meeting_date'))
  WHERE closed_at IS NULL AND NULLIF(metadata ->> 'meeting_date', '') IS NOT NULL;


-- ─── 2. fn_varredura_avisos_followups ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_varredura_avisos_followups()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  v_total integer := 0;
  v_dia text := to_char(timezone('America/Sao_Paulo', now()), 'YYYY-MM-DD');
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('avisos:followups', 0)) THEN RETURN 0; END IF;
  -- Set-based (20271127000000): o regime estável é "todo mundo já avisado hoje";
  -- cada etapa descarta o que já foi avisado antes de pagar a seguinte.
  FOR r IN
    WITH membro AS MATERIALIZED (
      SELECT tm.id, tm.organization_id, tm.user_id
      FROM public.team_members tm
      WHERE tm.is_active AND tm.user_id IS NOT NULL
    ), org_n_donos AS MATERIALIZED (
      -- lead_owners_enabled(org), lida uma vez (124 orgs) em vez de uma por linha.
      SELECT o.id FROM public.organizations o
      WHERE o.feature_flags ->> 'lead_owners_n_donos' = 'true'
    ), candidato AS MATERIALIZED (
      SELECT f.id, f.organization_id, f.lead_id, f.title, f.due_date,
        a.user_id AS atribuido,
        'fup:' || f.organization_id || ':' || f.id || ':' ||
          extract(epoch FROM f.due_date)::text || ':' || v_dia AS chave
      FROM public.follow_ups f
      LEFT JOIN membro a ON a.id = f.assigned_to AND a.organization_id = f.organization_id
      WHERE f.completed_at IS NULL AND f.archived_at IS NULL
        AND f.due_date <= now() + interval '15 minutes'
        -- Old overdue tasks remain a morning reminder, not a midnight alarm.
        AND (f.due_date >= now() - interval '1 hour'
          OR extract(hour FROM timezone('America/Sao_Paulo', now())) >= 7)
    ), pendente AS MATERIALIZED (
      -- Atribuído já avisado: nada a fazer, nem ler o lead.
      SELECT c.* FROM candidato c
      WHERE c.atribuido IS NULL OR NOT EXISTS (SELECT 1 FROM public.notifications n
        WHERE n.organization_id = c.organization_id AND n.user_id = c.atribuido AND n.group_key = c.chave)
    ), com_lead AS (
      SELECT p.*, l.name AS lead_nome,
        -- fn_dono_do_lead: 1º papel com membro ativo, sem checar org.
        COALESCE(p1.user_id, p2.user_id, p3.user_id, p4.user_id, p5.user_id) AS principal,
        (fl.id IS NOT NULL) AS n_donos,
        venda.user_id AS venda, pre.user_id AS pre_venda
      FROM pendente p
      JOIN public.leads l ON l.id = p.lead_id AND l.organization_id = p.organization_id
        AND l.deleted_at IS NULL
      LEFT JOIN membro p1 ON p1.id = l.sale_responsible_id
      LEFT JOIN membro p2 ON p2.id = l.closer_id
      LEFT JOIN membro p3 ON p3.id = l.pre_sale_responsible_id
      LEFT JOIN membro p4 ON p4.id = l.sdr_id
      LEFT JOIN membro p5 ON p5.id = l.responsible_id
      LEFT JOIN membro venda ON venda.id = l.sale_responsible_id AND venda.organization_id = l.organization_id
      LEFT JOIN membro pre ON pre.id = l.pre_sale_responsible_id AND pre.organization_id = l.organization_id
      LEFT JOIN org_n_donos fl ON fl.id = l.organization_id
    )
    SELECT DISTINCT c.id, c.organization_id, c.lead_id, c.title, c.due_date, c.chave,
      c.lead_nome, d.user_id AS destinatario
    FROM com_lead c
    -- Atribuído a alguém: só essa pessoa. Sem atribuído: TODOS os donos do lead
    -- (Chamado 793f4b05 · PR4b), réplica de fn_donos_do_lead.
    CROSS JOIN LATERAL unnest(CASE
      WHEN c.atribuido IS NOT NULL THEN ARRAY[c.atribuido]
      WHEN NOT c.n_donos THEN ARRAY[c.principal]
      ELSE ARRAY[c.principal, c.venda, c.pre_venda] || ARRAY(
        SELECT m.user_id FROM public.lead_owners lo
        JOIN membro m ON m.id = lo.team_member_id AND m.organization_id = c.organization_id
        WHERE lo.lead_id = c.lead_id AND lo.organization_id = c.organization_id)
    END) AS d(user_id)
    WHERE d.user_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM membro m
        WHERE m.organization_id = c.organization_id AND m.user_id = d.user_id)
      -- Reading a reminder must never re-arm the same scheduled occurrence.
      AND NOT EXISTS (SELECT 1 FROM public.notifications n
        WHERE n.organization_id = c.organization_id AND n.user_id = d.user_id AND n.group_key = c.chave)
  LOOP
    PERFORM public.fn_emit_aviso(
      p_organization_id => r.organization_id, p_user_id => r.destinatario,
      p_type => CASE WHEN r.due_date < now() THEN 'follow_up_overdue' ELSE 'follow_up_due' END,
      p_group_key => r.chave,
      p_title => CASE WHEN r.due_date < now() THEN 'Follow-up atrasado' ELSE 'Follow-up em até 15 minutos' END,
      p_description => concat_ws(' · ', NULLIF(r.title, ''), r.lead_nome,
        to_char(timezone('America/Sao_Paulo', r.due_date), 'DD/MM HH24:MI')),
      p_link => '/agenda', p_lead_id => r.lead_id, p_entity_id => r.id);
    v_total := v_total + 1;
  END LOOP;
  RETURN v_total;
END;
$$;

-- ─── 3. fn_varredura_avisos_reuniao_proxima ────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_varredura_avisos_reuniao_proxima()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  v_data timestamptz;
  v_dono uuid;
  v_donos uuid[];
  v_lead_nome text;
  v_key text;
  v_total integer := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('avisos:reunioes', 0)) THEN RETURN 0; END IF;

  -- Includes meetings without a lead/deal and follow-ups created as agenda
  -- activities. Creator + invited active members, never an organization broadcast.
  FOR r IN
    SELECT DISTINCT m.id, m.organization_id, m.lead_id, m.title, m.start_at,
      m.event_type, tm.user_id AS destinatario, l.name AS lead_nome
    FROM public.meetings m
    LEFT JOIN public.leads l ON l.id = m.lead_id AND l.organization_id = m.organization_id
    JOIN public.team_members tm ON tm.organization_id = m.organization_id
      AND tm.is_active AND tm.user_id IS NOT NULL
      AND (tm.user_id = m.created_by OR EXISTS (
        SELECT 1 FROM public.meeting_participants mp WHERE mp.meeting_id = m.id
          AND mp.team_member_id = tm.id AND mp.status <> 'declined'))
    WHERE m.status = 'scheduled' AND NOT m.all_day
      AND m.event_type IN ('meeting', 'call', 'follow_up', 'task', 'other')
      AND (m.lead_id IS NULL OR (l.id IS NOT NULL AND l.deleted_at IS NULL))
      AND m.start_at BETWEEN now() - interval '5 minutes' AND now() + interval '15 minutes'
  LOOP
    v_key := 'agenda:' || r.organization_id || ':' || r.id || ':' || extract(epoch FROM r.start_at)::text;
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.notifications n
      WHERE n.organization_id = r.organization_id AND n.user_id = r.destinatario AND n.group_key = v_key);
    PERFORM public.fn_emit_aviso(
      p_organization_id => r.organization_id, p_user_id => r.destinatario,
      p_type => CASE WHEN r.event_type = 'follow_up' THEN 'follow_up_due' ELSE 'meeting_soon' END,
      p_group_key => v_key,
      p_title => CASE WHEN r.start_at <= now() THEN
          CASE WHEN r.event_type = 'follow_up' THEN 'Follow-up para agora' ELSE 'Compromisso começando agora' END
        WHEN r.event_type = 'follow_up' THEN 'Follow-up em até 15 minutos' ELSE 'Compromisso em até 15 minutos' END,
      p_description => concat_ws(' · ', NULLIF(r.title, ''), r.lead_nome,
        to_char(timezone('America/Sao_Paulo', r.start_at), 'HH24:MI')),
      p_link => '/agenda', p_lead_id => r.lead_id, p_entity_id => r.id);
    v_total := v_total + 1;
  END LOOP;

  -- Preserve appointments created in funnels, which need not have a meetings
  -- row. A malformed legacy date must not stop all organizations' reminders.
  -- Pré-filtro por índice (20271127000000): instante ISO com fuso explícito a
  -- ±1 h, mais todo texto que a função não data (NULL). A janela exata, na
  -- conversão da sessão, continua logo abaixo.
  FOR r IN
    SELECT pe.*
    FROM public.pipeline_entries pe
    WHERE pe.closed_at IS NULL
      AND NULLIF(pe.metadata ->> 'meeting_date', '') IS NOT NULL
      AND (private.fn_aviso_meeting_date_aprox(pe.metadata ->> 'meeting_date')
            BETWEEN now() - interval '1 hour' AND now() + interval '1 hour'
        OR private.fn_aviso_meeting_date_aprox(pe.metadata ->> 'meeting_date') IS NULL)
  LOOP
    BEGIN
      v_data := (r.metadata ->> 'meeting_date')::timestamptz;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN CONTINUE;
    END;
    CONTINUE WHEN v_data NOT BETWEEN now() - interval '5 minutes' AND now() + interval '15 minutes';
    SELECT l.name INTO v_lead_nome FROM public.leads l
      WHERE l.id = r.lead_id AND l.organization_id = r.organization_id AND l.deleted_at IS NULL;
    CONTINUE WHEN NOT FOUND;
    -- The canonical agenda row owns its status and participants. Suppress its
    -- projection even when cancelled/completed, otherwise it resurrects here.
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.meetings m
      WHERE m.organization_id = r.organization_id AND (
        m.id::text = r.metadata #>> '{agenda_espelho,meeting_id}'
        OR ((m.pipeline_entry_id = r.id OR m.deal_id = r.deal_id) AND m.start_at = v_data)
        -- Lead/time is only a legacy fallback. Explicit links above already
        -- cover matching IDs; a different meeting, entry or deal is another
        -- appointment even when its lead and scheduled instant coincide.
        OR (m.lead_id = r.lead_id AND m.start_at = v_data
          AND NULLIF(r.metadata #>> '{agenda_espelho,meeting_id}', '') IS NULL
          AND m.pipeline_entry_id IS NULL
          AND (m.deal_id IS NULL OR r.deal_id IS NULL))));
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.meeting_events booked
      JOIN public.meeting_events outcome ON outcome.booked_event_id = booked.id
        AND outcome.organization_id = booked.organization_id
        AND outcome.event_type IN ('meeting_held', 'meeting_no_show')
      WHERE booked.organization_id = r.organization_id AND booked.source_entry_id = r.id
        AND booked.meeting_date = v_data);
    -- Atribuído a alguém: só essa pessoa. Sem atribuído: TODOS os donos do lead
    -- (Chamado 793f4b05 · PR4b). Um usuário em dois papéis recebe um aviso.
    v_donos := ARRAY(SELECT tm.user_id FROM public.team_members tm WHERE tm.id = r.assigned_to
      AND tm.organization_id = r.organization_id AND tm.is_active AND tm.user_id IS NOT NULL);
    IF cardinality(v_donos) = 0 THEN
      v_donos := public.fn_donos_do_lead(r.lead_id);
    END IF;
    v_key := 'meet_soon:' || r.organization_id || ':' || r.id || ':' || extract(epoch FROM v_data)::text;
    FOREACH v_dono IN ARRAY v_donos LOOP
      CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.team_members tm
        WHERE tm.organization_id = r.organization_id AND tm.user_id = v_dono AND tm.is_active);
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.notifications n
        WHERE n.organization_id = r.organization_id AND n.user_id = v_dono AND n.group_key = v_key);
      PERFORM public.fn_emit_aviso(
        p_organization_id => r.organization_id, p_user_id => v_dono, p_type => 'meeting_soon',
        p_group_key => v_key,
        p_title => CASE WHEN v_data <= now() THEN 'Reunião começando agora' ELSE 'Reunião em até 15 minutos' END,
        p_description => concat_ws(' · ', v_lead_nome, to_char(timezone('America/Sao_Paulo', v_data), 'HH24:MI')),
        p_link => '/agenda', p_lead_id => r.lead_id, p_entity_id => r.id);
      v_total := v_total + 1;
    END LOOP;
  END LOOP;
  RETURN v_total;
END;
$$;

COMMENT ON FUNCTION public.fn_donos_do_lead(uuid) IS
  'Contas de usuário que recebem o aviso do lead: TODOS os donos (principais por papel + co-donos de lead_owners), principal primeiro, sem repetir usuário. Org sem a flag lead_owners_n_donos: só o principal (= fn_dono_do_lead). fn_dono_do_lead segue existindo para quem lê o principal. Chamado 793f4b05 · PR4b. RÉPLICA set-based em fn_varredura_avisos_followups (20271127000000): mudar a regra aqui exige mudar lá.';

ANALYZE public.pipeline_entries;

-- Por último: o DROP pega ACCESS EXCLUSIVE em pipeline_entries até o COMMIT
-- (trava leitura do kanban); aqui ele segura o lock só pelo instante final.
DROP INDEX IF EXISTS public.pipeline_entries_pending_meeting_reminder_idx;

COMMIT;
