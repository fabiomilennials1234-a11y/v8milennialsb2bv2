-- S5 — o botão da Agenda passa a mover a métrica.
--
-- Decisão do CTO: A1 + B3 + C1. Ver .specs/agenda-fonte-unica/PLANO.md.
--
-- ── O buraco que esta fatia fecha ────────────────────────────────────────
-- Depois do S4, TODA reunião é fonte `meeting` na Agenda e todas têm os
-- botões Compareceu / Não compareceu. Mas o botão grava só `meetings.status`,
-- e NENHUMA métrica lê essa coluna: `useSDRPerformance` e
-- `get_dashboard_metrics` leem exclusivamente `meeting_events`, cujo único
-- escritor é `fn_capture_meeting_event` — o trigger de MOVIMENTO DE CARD.
--
-- Ou seja: hoje quem marca comparecimento na Agenda não muda número nenhum.
-- Para a métrica se mexer, é preciso arrastar o card no funil — exatamente a
-- dependência de "funis e etapas próprias" que o pedido manda acabar.
--
-- ── Por que espelhar em `meeting_events` em vez de a métrica ler `meetings` ──
-- Ler `meetings` direto seria mais curto e estaria ERRADO: trocaria a
-- ATRIBUIÇÃO em silêncio. `meeting_events.pre_sale_responsible_id` é um
-- SNAPSHOT de quem marcou, congelado no evento — é a chave canônica de
-- atribuição de pré-venda. `meetings.created_by` é outra coisa: quem criou a
-- linha na agenda, que pode ser um admin, o dono da instância, ou ninguém
-- (nulo em 162 das 884 migradas). Trocar uma pela outra mudaria o ranking de
-- SDR sem nenhuma linha de métrica ter sido tocada.
--
-- Então o desenho é: a Agenda vira ESCRITORA do livro que a métrica já lê.
-- Nenhum leitor muda nesta fatia — e é isso que permite reconciliar.
--
-- ── 🚨 O filtro por `event_type` não é zelo, é correção ──────────────────
-- Os botões da Agenda aparecem por FONTE (`source = 'meeting'`), não por
-- tipo. E `meetings` guarda os CINCO tipos do botão "Nova atividade":
-- reunião, ligação, follow-up, tarefa e outro. Medido em prod agora: 29 das
-- 933 linhas NÃO são reunião (call, follow_up, other).
--
-- Sem o filtro abaixo, marcar "compareceu" numa LIGAÇÃO criaria um
-- `meeting_held` e inflaria a métrica de reunião — um número que ninguém
-- conseguiria explicar depois, porque a causa estaria numa tela que nem fala
-- de reunião.
--
-- ── A Agenda é autoridade sobre o desfecho ───────────────────────────────
-- Marcar SUBSTITUI o desfecho anterior; desmarcar REMOVE. Inclusive quando o
-- desfecho veio do funil. Isso é o B3 escrito em código: o funil vira espelho
-- da agenda, não uma segunda opinião. Sem a substituição, um `meeting_held`
-- gravado por movimento de card venceria para sempre — a tela dizia "não
-- compareceu" e a métrica contava comparecimento, e ninguém teria como saber
-- qual das duas estava certa.
--
-- Remover linha de `meeting_events` merece justificativa, porque a tabela é um
-- livro de eventos: aqui não é reescrever história, é CORRIGIR um registro que
-- a própria operação declarou errado ao desmarcar. O agendamento
--  (`meeting_booked`) nunca é apagado — só o desfecho.
--
-- ── Nada é escrito retroativamente ───────────────────────────────────────
-- Trigger não dispara sobre linha que já existe. As 933 reuniões atuais ficam
-- exatamente como estão, e por isso NENHUM número muda no instante do apply.
-- A métrica passa a responder ao botão a partir do próximo clique.
--
-- Reaplicar é no-op.

CREATE OR REPLACE FUNCTION public.fn_meeting_outcome_to_events()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_booked_id uuid;
  v_presale   uuid;
  v_desfecho  text;
  v_origem_id uuid;
BEGIN
  -- Só REUNIÃO conta em métrica de reunião. Ver o cabeçalho: ligação, tarefa,
  -- follow-up e "outro" também moram em `meetings` e também têm os botões.
  IF NEW.event_type IS DISTINCT FROM 'meeting' THEN
    RETURN NEW;
  END IF;

  -- `meeting_events.lead_id` é NOT NULL. Reunião interna (sem lead) não entra
  -- no livro de métrica — e não deveria mesmo: não há a quem atribuir.
  IF NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_desfecho := CASE NEW.status
                  WHEN 'completed' THEN 'meeting_held'
                  WHEN 'no_show'   THEN 'meeting_no_show'
                  ELSE NULL
                END;

  -- ── Localizar o agendamento correspondente ────────────────────────────
  -- (a) procedência do backfill: `backfill:agenda-fonte-unica:meeting_event:<id>`
  --     é o caminho EXATO — 874 das 884 migradas carregam o id de origem.
  IF NEW.external_ref LIKE 'backfill:agenda-fonte-unica:meeting_event:%' THEN
    BEGIN
      v_origem_id := split_part(NEW.external_ref, ':', 4)::uuid;
    EXCEPTION WHEN others THEN
      v_origem_id := NULL;   -- external_ref malformado não pode derrubar a escrita
    END;
    SELECT me.id INTO v_booked_id
    FROM public.meeting_events me
    WHERE me.id = v_origem_id AND me.event_type = 'meeting_booked';
  END IF;

  -- (b) por (lead, data): cobre o que veio de `pipe_confirmacao` e o que a
  --     operação marcou pelo funil antes de abrir a agenda.
  IF v_booked_id IS NULL THEN
    SELECT me.id INTO v_booked_id
    FROM public.meeting_events me
    WHERE me.organization_id = NEW.organization_id
      AND me.lead_id = NEW.lead_id
      AND me.event_type = 'meeting_booked'
      AND me.meeting_date = NEW.start_at
    ORDER BY me.occurred_at DESC
    LIMIT 1;
  END IF;

  -- (c) reunião nascida NA agenda não tem agendamento no livro. Criar aqui é
  --     o que faz "marquei pela agenda" contar como REUNIÃO MARCADA — que é
  --     metade do pedido, e a metade que quase ficou de fora.
  --
  --     A primeira versão só criava o agendamento quando havia desfecho, com
  --     a justificativa de "não deixar lixo no livro". O efeito seria: marcar
  --     uma reunião pela Agenda não contaria em `reunioesMarcadas` até alguém
  --     registrar comparecimento — ou seja, a métrica de agendamento
  --     continuaria dependendo do funil, que é exatamente o que esta fatia
  --     veio desfazer.
  --
  --     Não há duplicidade com o funil: movimento de card grava em
  --     `meeting_events` e NÃO cria linha em `meetings`, então cada origem
  --     produz um agendamento e só um.
  IF v_booked_id IS NULL THEN
    SELECT COALESCE(l.pre_sale_responsible_id, l.sdr_id) INTO v_presale
    FROM public.leads l WHERE l.id = NEW.lead_id;

    INSERT INTO public.meeting_events
      (organization_id, lead_id, event_type, pre_sale_responsible_id,
       meeting_date, occurred_at, source, metadata)
    VALUES
      (NEW.organization_id, NEW.lead_id, 'meeting_booked', v_presale,
       NEW.start_at, COALESCE(NEW.created_at, now()), 'agenda:meeting',
       jsonb_build_object('meeting_id', NEW.id))
    RETURNING id INTO v_booked_id;
  END IF;

  -- ── Aplicar o desfecho ────────────────────────────────────────────────
  -- A agenda é autoridade: apaga o que houver e grava o que a tela diz. O
  -- índice `uniq_meeting_events_desfecho_por_agendamento` (20270907000010) já
  -- garante no máximo um desfecho; o DELETE aqui é o que permite TROCAR de
  -- ideia, e não só registrar a primeira vez.
  DELETE FROM public.meeting_events
  WHERE booked_event_id = v_booked_id
    AND event_type IN ('meeting_held', 'meeting_no_show')
    AND (v_desfecho IS NULL OR event_type IS DISTINCT FROM v_desfecho);

  IF v_desfecho IS NOT NULL THEN
    SELECT pre_sale_responsible_id INTO v_presale
    FROM public.meeting_events WHERE id = v_booked_id;

    INSERT INTO public.meeting_events
      (organization_id, lead_id, event_type, booked_event_id,
       pre_sale_responsible_id, meeting_date, occurred_at, source, metadata)
    VALUES
      (NEW.organization_id, NEW.lead_id, v_desfecho, v_booked_id,
       v_presale, NEW.start_at, now(), 'agenda:meeting',
       jsonb_build_object('meeting_id', NEW.id))
    ON CONFLICT (booked_event_id) WHERE event_type IN ('meeting_held', 'meeting_no_show')
    DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_meeting_outcome_to_events() IS
  'Espelha o desfecho registrado na Agenda (meetings.status) para meeting_events, que é o livro que as métricas leem. Só event_type=meeting. A agenda é autoridade: marcar substitui, desmarcar remove.';

DROP TRIGGER IF EXISTS trg_meeting_outcome_to_events ON public.meetings;
CREATE TRIGGER trg_meeting_outcome_to_events
  AFTER INSERT OR UPDATE OF status ON public.meetings
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_meeting_outcome_to_events();

-- ── Apagar a reunião na Agenda desfaz o que ELA escreveu ─────────────────
-- Sem isto o buraco é visível: criar reunião por engano, apagar, e a métrica
-- segue contando uma "reunião marcada" que não existe em tela nenhuma. O
-- trigger de cima só cobre INSERT/UPDATE.
--
-- 🚨 O recorte é pelo que a AGENDA autorou, não por lead+data. Uma reunião
-- migrada aponta um `meeting_booked` que veio do FUNIL, e apagar a linha da
-- agenda não pode apagar o histórico do funil junto — seria a agenda comendo
-- dado de outra origem. Por isso o predicado é `source = 'agenda:meeting'` e
-- `metadata->>'meeting_id'` igual ao id apagado: só sai o que entrou por aqui.
-- O desfecho sai sempre (ele é da agenda por definição, ver o trigger acima).
CREATE OR REPLACE FUNCTION public.fn_meeting_delete_cleans_events()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Desfecho que esta reunião registrou.
  DELETE FROM public.meeting_events
  WHERE event_type IN ('meeting_held', 'meeting_no_show')
    AND source = 'agenda:meeting'
    AND metadata->>'meeting_id' = OLD.id::text;

  -- Agendamento, SÓ se foi a agenda que o criou.
  DELETE FROM public.meeting_events
  WHERE event_type = 'meeting_booked'
    AND source = 'agenda:meeting'
    AND metadata->>'meeting_id' = OLD.id::text;

  RETURN OLD;
END;
$function$;

COMMENT ON FUNCTION public.fn_meeting_delete_cleans_events() IS
  'Apagar reunião na Agenda remove os meeting_events que a PRÓPRIA agenda escreveu (source=agenda:meeting). Agendamento vindo do funil não é tocado.';

DROP TRIGGER IF EXISTS trg_meeting_delete_cleans_events ON public.meetings;
CREATE TRIGGER trg_meeting_delete_cleans_events
  AFTER DELETE ON public.meetings
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_meeting_delete_cleans_events();

-- ── Guarda ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_trg integer;
BEGIN
  SELECT count(*) INTO v_trg
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  WHERE c.relname = 'meetings' AND t.tgname = 'trg_meeting_outcome_to_events'
    AND NOT t.tgisinternal;
  IF v_trg <> 1 THEN
    RAISE EXCEPTION 'trigger trg_meeting_outcome_to_events nao foi criado';
  END IF;

  SELECT count(*) INTO v_trg
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  WHERE c.relname = 'meetings' AND t.tgname = 'trg_meeting_delete_cleans_events'
    AND NOT t.tgisinternal;
  IF v_trg <> 1 THEN
    RAISE EXCEPTION 'trigger trg_meeting_delete_cleans_events nao foi criado';
  END IF;
END $$;
