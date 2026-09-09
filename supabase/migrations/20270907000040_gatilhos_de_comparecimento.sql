-- S7 — automação passa a reagir a comparecimento e falta.
--
-- Decisão do CTO: A1 + B3 + C1. Ver .specs/agenda-fonte-unica/PLANO.md.
--
-- ── O que existia ────────────────────────────────────────────────────────
-- Nenhum gatilho de comparecimento. O editor de Automações mostra
-- "Reunião Confirmada" e "Reunião Não Confirmada" desde sempre, e os DOIS são
-- NÓS MORTOS: a função `trigger_workflow_meeting_confirmed` existe no baseline,
-- foi escrita para `pipe_confirmacao.is_confirmed`, e `pipe_confirmacao` virou
-- VIEW compat — não há trigger algum anexado a tabela nenhuma. Medido em prod:
-- zero `trg_workflow_meeting_*` em `pg_trigger`, e ZERO workflows usando esses
-- dois tipos. Ninguém foi prejudicado porque ninguém conseguiu usar.
--
-- Também não dava para construir o gatilho antes desta série: a falta só virou
-- FATO em `20270907000010` (o CHECK passou a aceitar `meeting_no_show`), e só
-- passou a ser ESCRITA pela Agenda em `20270907000030`. Gatilho depende de
-- evento; não havia evento.
--
-- ── Onde o gatilho mora, e por quê aqui ──────────────────────────────────
-- Em `meeting_events`, não em `meetings`.
--
-- `meetings` é a tela; `meeting_events` é o livro. As DUAS origens de desfecho
-- desembocam aqui — a Agenda por `fn_meeting_outcome_to_events` e o movimento
-- de card por `fn_capture_meeting_event`. Pendurar em `meetings` cobriria só a
-- Agenda e deixaria o funil mudo, o que reintroduziria exatamente a assimetria
-- que esta série veio desfazer.
--
-- Consequência desejada: a automação dispara UMA vez por desfecho, venha ele
-- de onde vier, porque o índice único `uniq_meeting_events_desfecho_por_
-- agendamento` (20270907000010) garante um desfecho por agendamento.
--
-- ── "lead compareceu / negócio compareceu" ───────────────────────────────
-- O pedido cita os dois sujeitos, e o payload carrega os dois. `lead_id` é
-- coluna de `meeting_events`; `deal_id` não é, e é resolvido por dois caminhos,
-- na ordem:
--   1. desfecho vindo da Agenda → `metadata->>'meeting_id'` → `meetings.deal_id`
--      (coluna criada em `20270907000010`)
--   2. desfecho vindo do funil → `source_entry_id` → `pipeline_entries.deal_id`
-- Nulo quando nenhum resolve — e nulo é honesto: 26% dos cards não têm linha em
-- `deals`, então inventar vínculo seria pior que não ter. Uma automação que
-- precise do negócio pode condicionar em cima do campo.
--
-- ── O que NÃO muda ───────────────────────────────────────────────────────
-- `matches_workflow_trigger_config` tem `ELSE RETURN TRUE`, então tipo novo
-- passa sem tocar nela: o gatilho dispara para todo workflow ativo daquele tipo
-- na org. Filtro por config, se um dia precisar, é fatia própria.
--
-- `fire_workflow_trigger` já traz dedup (janela de 60s sobre o hash do
-- contexto) e teto de profundidade de cadeia (5). Nada disso é reimplementado
-- aqui — reimplementar seria a segunda cópia de uma regra que já tem dono.
--
-- Reaplicar é no-op. Nenhuma linha de dado é criada, alterada ou apagada.

CREATE OR REPLACE FUNCTION public.trigger_workflow_meeting_outcome()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_deal_id     uuid;
  v_meeting_id  uuid;
  v_origem      text;
BEGIN
  IF NEW.event_type NOT IN ('meeting_held', 'meeting_no_show') THEN
    RETURN NEW;
  END IF;

  -- (1) desfecho registrado na Agenda: o id da reunião vem no metadata.
  BEGIN
    v_meeting_id := NULLIF(NEW.metadata->>'meeting_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_meeting_id := NULL;   -- metadata malformado não pode derrubar a escrita
  END;

  IF v_meeting_id IS NOT NULL THEN
    SELECT m.deal_id INTO v_deal_id FROM public.meetings m WHERE m.id = v_meeting_id;
  END IF;

  -- (2) desfecho vindo do movimento de card: o negócio está na entrada do funil.
  IF v_deal_id IS NULL AND NEW.source_entry_id IS NOT NULL THEN
    SELECT pe.deal_id INTO v_deal_id
    FROM public.pipeline_entries pe WHERE pe.id = NEW.source_entry_id;
  END IF;

  -- Distingue quem registrou, para a automação poder reagir só a um dos lados.
  v_origem := CASE
                WHEN NEW.source = 'agenda:meeting' THEN 'agenda'
                WHEN NEW.source LIKE 'pipeline:%'  THEN 'funil'
                ELSE COALESCE(NEW.source, 'desconhecido')
              END;

  PERFORM public.fire_workflow_trigger(
    NEW.organization_id,
    NEW.event_type,               -- 'meeting_held' | 'meeting_no_show'
    NEW.lead_id,
    jsonb_build_object(
      'trigger', NEW.event_type,
      'lead_id', NEW.lead_id,
      'deal_id', v_deal_id,
      'negocio_id', v_deal_id,    -- mesmo par pt-BR/en que `deal_created` já usa
      'meeting_id', v_meeting_id,
      'meeting_event_id', NEW.id,
      'meeting_date', NEW.meeting_date,
      'pre_sale_responsible_id', NEW.pre_sale_responsible_id,
      'origem', v_origem
    ),
    NULL
  );

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.trigger_workflow_meeting_outcome() IS
  'Dispara os gatilhos meeting_held / meeting_no_show a partir de meeting_events — o livro onde AS DUAS origens de desfecho (Agenda e movimento de card) desembocam. Payload carrega lead e negócio.';

DROP TRIGGER IF EXISTS trg_workflow_meeting_outcome ON public.meeting_events;
CREATE TRIGGER trg_workflow_meeting_outcome
  AFTER INSERT ON public.meeting_events
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_workflow_meeting_outcome();

-- ── A função morta sai ───────────────────────────────────────────────────
-- `trigger_workflow_meeting_confirmed` nunca esteve anexada a tabela nenhuma e
-- foi escrita para uma coluna de `pipe_confirmacao`, que hoje é view compat.
-- Deixá-la no schema é convidar alguém a "religar" um caminho que aponta para
-- lugar nenhum. Medido antes de remover: 0 triggers usando, 0 workflows com o
-- tipo `meeting_confirmed` ou `meeting_not_confirmed`.
--
-- `IF EXISTS` porque uma base recriada do baseline pode não tê-la.
DROP FUNCTION IF EXISTS public.trigger_workflow_meeting_confirmed();

-- ── Guarda ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_trg  integer;
  v_orfa integer;
BEGIN
  SELECT count(*) INTO v_trg
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  WHERE c.relname = 'meeting_events'
    AND t.tgname = 'trg_workflow_meeting_outcome'
    AND NOT t.tgisinternal;
  IF v_trg <> 1 THEN
    RAISE EXCEPTION 'trigger trg_workflow_meeting_outcome nao foi criado';
  END IF;

  SELECT count(*) INTO v_orfa
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'trigger_workflow_meeting_confirmed';
  IF v_orfa <> 0 THEN
    RAISE EXCEPTION 'a funcao morta trigger_workflow_meeting_confirmed continua no schema';
  END IF;
END $$;
