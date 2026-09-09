-- S3 da "agenda como fonte única": a reunião passa a poder apontar o NEGÓCIO,
-- e a falta vira um fato de primeira classe.
--
-- Decisão do CTO (2026-09-01): A1 + B3 + C1. Ver .specs/agenda-fonte-unica/PLANO.md.
-- Esta fatia é só ESTRUTURA. Ninguém escreve nas colunas novas ainda — o
-- escritor e os leitores vêm no S5, juntos. Separar assim é deliberado: um
-- `meeting_no_show` gravado antes de os leitores mudarem seria CONTADO DUAS
-- VEZES (ver a nota de compatibilidade no fim).
--
-- ── 1. `meetings.deal_id` ────────────────────────────────────────────────
-- Hoje `meetings` sabe o lead (`lead_id`) e o funil (`pipeline_id`), e não sabe
-- o NEGÓCIO. Por isso o card da Agenda não tem como dizer onde o negócio está:
-- ele cai num link fixo para `/pipe-confirmacao` — o funil legado — mesmo
-- quando a org já migrou para o funil mergeado. O link não está quebrado; está
-- apontando para a resposta errada.
--
-- Um lead tem N negócios. Sem esta coluna, "a reunião do lead X" é ambígua
-- assim que o lead tem um segundo negócio — e 26% dos cards não têm linha em
-- `deals`, então não dá para derivar por join e torcer.
--
-- `ON DELETE SET NULL` e não CASCADE: apagar o negócio não pode apagar a
-- reunião. A reunião ACONTECEU; ela é histórico de agenda e insumo de métrica,
-- e o negócio é a moldura comercial em volta. Mesma escolha já feita em
-- `meetings_lead_id_fkey` e `meetings_pipeline_id_fkey`.
--
-- ── 2. `meeting_events` aceita `meeting_no_show` ─────────────────────────
-- O CHECK só admitia `meeting_booked | meeting_held`. Consequência medida: a
-- falta NUNCA é um registro — ela é INFERIDA, em dois lugares que repetem a
-- mesma conta ("agendada, data no passado, sem `meeting_held` vinculado"):
-- `useSDRPerformance` e `get_dashboard_metrics`.
--
-- Inferir custa caro e erra em silêncio:
--   · reunião CANCELADA vira no-show, porque cancelamento também não tem held;
--   · não existe QUANDO a falta foi constatada, nem quem constatou;
--   · não dá para distinguir "faltou" de "ainda não registraram";
--   · e nenhum gatilho de automação pode existir, porque não há evento.
-- Os nós de workflow que o CTO pediu (#7) dependem desta linha.
--
-- ── 3. Um agendamento, no máximo UM desfecho ─────────────────────────────
-- `fn_capture_meeting_event` já tenta garantir isso com `NOT EXISTS` antes do
-- INSERT, e isso é uma checagem-e-depois-escreve: duas transações concorrentes
-- passam as duas. Nunca estourou — medido agora em prod, 0 agendamentos com
-- mais de um desfecho e 0 `meeting_held` sem `booked_event_id` — mas o que
-- segura hoje é o volume baixo, não a regra.
--
-- Com `meeting_no_show` entrando, a corrida deixa de ser teórica: o caminho
-- novo é "a pessoa clica Compareceu e depois Não compareceu", e sem o índice
-- as duas linhas coexistem e o lead fica contado dos DOIS lados. O índice
-- parcial escreve o invariante onde ele não pode ser contornado.
--
-- Reaplicar é no-op. Nenhuma linha de dado é criada, alterada ou apagada.

-- ── 1. Reunião conhece o negócio ─────────────────────────────────────────
ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS deal_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'meetings_deal_id_fkey'
  ) THEN
    ALTER TABLE public.meetings
      ADD CONSTRAINT meetings_deal_id_fkey
      FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.meetings.deal_id IS
  'Negócio a que a reunião pertence. Nulo em reunião sem negócio (interna, ou lead ainda sem deal). Um lead tem N negócios — `lead_id` sozinho não identifica qual.';

-- Parcial: a esmagadora maioria das reuniões não tem negócio, e o índice
-- existe para responder "as reuniões DESTE negócio".
CREATE INDEX IF NOT EXISTS idx_meetings_deal_id
  ON public.meetings (deal_id)
  WHERE deal_id IS NOT NULL;

-- ── 2. A falta vira fato ─────────────────────────────────────────────────
ALTER TABLE public.meeting_events
  DROP CONSTRAINT IF EXISTS meeting_events_event_type_check;

ALTER TABLE public.meeting_events
  ADD CONSTRAINT meeting_events_event_type_check
  CHECK (event_type = ANY (ARRAY['meeting_booked'::text, 'meeting_held'::text, 'meeting_no_show'::text]));

COMMENT ON COLUMN public.meeting_events.event_type IS
  'meeting_booked (marcou) | meeting_held (compareceu) | meeting_no_show (faltou). Os dois últimos são DESFECHOS e apontam o agendamento em `booked_event_id`; um agendamento tem no máximo um desfecho.';

-- ── 3. Um agendamento, no máximo um desfecho ─────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uniq_meeting_events_desfecho_por_agendamento
  ON public.meeting_events (booked_event_id)
  WHERE event_type IN ('meeting_held', 'meeting_no_show');

-- ── 4. O índice novo não pode derrubar movimento de card ─────────────────
-- `fn_capture_meeting_event` grava o `meeting_held` com "checa e depois
-- escreve": `IF NOT EXISTS (...) THEN INSERT`. Enquanto não havia índice, duas
-- transações concorrentes passavam as duas e o pior desfecho era uma linha
-- duplicada. Com o índice do item 3, a segunda passa a estourar 23505 —
-- DENTRO de um trigger de `pipeline_entries`, ou seja, o movimento do card
-- falha na cara do vendedor.
--
-- Trocar um double-count silencioso por um erro visível seria defensável se
-- fosse a única saída, mas não é: `ON CONFLICT DO NOTHING` no alvo do índice
-- parcial faz a corrida degradar para no-op, que é exatamente o que o
-- `NOT EXISTS` já queria dizer. O `NOT EXISTS` fica — ele evita o trabalho no
-- caso comum; o `ON CONFLICT` cobre só a janela entre checar e escrever.
--
-- O corpo abaixo é o vivo do PROD com UMA linha acrescentada. O S6 reescreve
-- esta função inteira; até lá ela não pode ser a fonte de um erro novo.
CREATE OR REPLACE FUNCTION public.fn_capture_meeting_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_slug text;
  v_meeting_date timestamptz;
  v_presale uuid;
  v_prev public.meeting_events%ROWTYPE;
  v_prev_open boolean;
  v_entering_booked boolean := false;
  v_booked_id uuid;
BEGIN
  SELECT p.slug INTO v_slug FROM public.pipelines p WHERE p.id = NEW.pipeline_id;

  v_meeting_date := NULLIF(NEW.metadata->>'meeting_date', '')::timestamptz;

  SELECT COALESCE(
    NULLIF(NEW.metadata->>'pre_sale_responsible_id', '')::uuid,
    l.pre_sale_responsible_id,
    NULLIF(NEW.metadata->>'sdr_id', '')::uuid,
    l.sdr_id
  ) INTO v_presale
  FROM public.leads l WHERE l.id = NEW.lead_id;

  SELECT * INTO v_prev FROM public.meeting_events me
  WHERE me.lead_id = NEW.lead_id
    AND me.organization_id = NEW.organization_id
    AND me.event_type = 'meeting_booked'
  ORDER BY me.occurred_at DESC
  LIMIT 1;

  v_prev_open := v_prev.id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.meeting_events h
    WHERE h.event_type = 'meeting_held' AND h.booked_event_id = v_prev.id
  );

  -- BOOKED ──────────────────────────────────────────────────────────────────
  IF (v_slug = 'confirmacao' AND TG_OP = 'INSERT')
     OR (NEW.stage_key = 'agendado' AND (TG_OP = 'INSERT' OR OLD.stage_key IS DISTINCT FROM NEW.stage_key)) THEN
    v_entering_booked := true;
  END IF;

  IF v_entering_booked THEN
    IF v_prev_open AND (
         v_meeting_date IS NULL OR v_prev.meeting_date IS NULL
         OR abs(EXTRACT(EPOCH FROM (v_meeting_date - v_prev.meeting_date))) <= 30 * 86400
       ) THEN
      UPDATE public.meeting_events
      SET meeting_date = COALESCE(v_meeting_date, meeting_date),
          metadata = metadata || jsonb_build_object('last_reschedule_at', now(), 'last_source_entry_id', NEW.id)
      WHERE id = v_prev.id;
    ELSE
      INSERT INTO public.meeting_events
        (organization_id, lead_id, event_type, pre_sale_responsible_id, meeting_date, occurred_at, source, source_entry_id)
      VALUES
        (NEW.organization_id, NEW.lead_id, 'meeting_booked', v_presale, v_meeting_date, now(),
         'pipeline:' || COALESCE(v_slug, '?'), NEW.id);
    END IF;
  END IF;

  -- RESCHEDULE without stage change (meeting_date edited in place) ──────────
  IF TG_OP = 'UPDATE'
     AND NEW.stage_key = OLD.stage_key
     AND (OLD.metadata->>'meeting_date') IS DISTINCT FROM (NEW.metadata->>'meeting_date')
     AND v_meeting_date IS NOT NULL
     AND v_prev_open THEN
    IF v_prev.meeting_date IS NOT NULL
       AND abs(EXTRACT(EPOCH FROM (v_meeting_date - v_prev.meeting_date))) > 30 * 86400 THEN
      INSERT INTO public.meeting_events
        (organization_id, lead_id, event_type, pre_sale_responsible_id, meeting_date, occurred_at, source, source_entry_id)
      VALUES
        (NEW.organization_id, NEW.lead_id, 'meeting_booked', v_presale, v_meeting_date, now(),
         'pipeline:' || COALESCE(v_slug, '?') || ':reschedule', NEW.id);
    ELSE
      UPDATE public.meeting_events
      SET meeting_date = v_meeting_date,
          metadata = metadata || jsonb_build_object('last_reschedule_at', now())
      WHERE id = v_prev.id;
    END IF;
  END IF;

  -- HELD ────────────────────────────────────────────────────────────────────
  IF NEW.stage_key = 'compareceu'
     AND (TG_OP = 'INSERT' OR OLD.stage_key IS DISTINCT FROM NEW.stage_key) THEN
    v_booked_id := v_prev.id;
    IF v_booked_id IS NULL THEN
      INSERT INTO public.meeting_events
        (organization_id, lead_id, event_type, pre_sale_responsible_id, meeting_date, occurred_at, source, source_entry_id)
      VALUES
        (NEW.organization_id, NEW.lead_id, 'meeting_booked', v_presale, v_meeting_date, now(),
         'pipeline:' || COALESCE(v_slug, '?') || ':implicit', NEW.id)
      RETURNING id INTO v_booked_id;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.meeting_events h
      WHERE h.event_type = 'meeting_held' AND h.booked_event_id = v_booked_id
    ) THEN
      INSERT INTO public.meeting_events
        (organization_id, lead_id, event_type, booked_event_id, pre_sale_responsible_id, meeting_date, occurred_at, source, source_entry_id)
      VALUES
        (NEW.organization_id, NEW.lead_id, 'meeting_held', v_booked_id,
         COALESCE(v_prev.pre_sale_responsible_id, v_presale),
         COALESCE(v_meeting_date, v_prev.meeting_date), now(),
         'pipeline:' || COALESCE(v_slug, '?'), NEW.id)
      -- A linha nova: fecha a janela entre o NOT EXISTS acima e este INSERT.
      ON CONFLICT (booked_event_id) WHERE event_type IN ('meeting_held', 'meeting_no_show') DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ── Guarda ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_falta_col integer;
  v_check_ok  boolean;
BEGIN
  SELECT count(*) INTO v_falta_col
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='meetings' AND column_name='deal_id';
  IF v_falta_col = 0 THEN
    RAISE EXCEPTION 'meetings.deal_id nao foi criada';
  END IF;

  SELECT pg_get_constraintdef(oid) LIKE '%meeting_no_show%' INTO v_check_ok
  FROM pg_constraint WHERE conname = 'meeting_events_event_type_check';
  IF NOT COALESCE(v_check_ok, false) THEN
    RAISE EXCEPTION 'CHECK de meeting_events nao aceita meeting_no_show';
  END IF;
END $$;

-- ── Compatibilidade: por que NINGUÉM escreve `meeting_no_show` ainda ─────
-- 🚨 `useSDRPerformance` e `get_dashboard_metrics` contam falta como
-- "agendada, no passado, sem `meeting_held`". Uma linha `meeting_no_show`
-- NÃO satisfaz `meeting_held`, então a reunião continuaria caindo na conta
-- inferida E passaria a existir como registro: o mesmo evento contado duas
-- vezes se algum leitor somasse os dois.
--
-- Enquanto ninguém escreve, os dois leitores seguem devolvendo exatamente o
-- que devolvem hoje — esta migration é inerte para toda métrica. O S5 troca
-- escritor e leitores no mesmo passo, com reconciliação antes/depois.
