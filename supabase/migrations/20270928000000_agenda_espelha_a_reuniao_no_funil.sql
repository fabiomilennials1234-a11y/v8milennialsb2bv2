-- 20270928000000_agenda_espelha_a_reuniao_no_funil.sql — S6 (Agenda como fonte única)
--
-- Marcar reunião na Agenda nunca apareceu no card do Negócio. Esta migration
-- fecha o buraco PROJETANDO em `pipeline_entries.metadata` um fato que já está
-- gravado em `public.meetings` — sem criar, apagar ou reescrever UMA linha de
-- `meeting_events`.
--
-- ── O DEFEITO, MEDIDO EM PROD (2026-09-03, projeto jsjsmuncfkbsbzqzqhfq) ─────
--
--   A Agenda grava em `public.meetings` (useCreateMeeting). O card do Negócio
--   lê `pipeline_entries.metadata->>'meeting_date'` (useDealCardData e a view
--   `negocio_projetado`). Não existe caminho entre as duas: nenhum trigger,
--   nenhuma edge function, nada. `meetings.deal_id` existe desde
--   20270907000010 e está MORTA — 642 das 935 linhas preenchidas, TODAS no
--   mesmo instante (created_at = 2026-09-01 19:55:09.193388+00, o backfill do
--   S3/S4); as criadas pelo app depois disso têm deal_id NULL.
--
-- ── O QUE ESTA MIGRATION FAZ, NESTA ORDEM (a ordem é o desenho) ─────────────
--
--   1. GUARDA ANTI-LAÇO em `fn_capture_meeting_event`, ANTES de tudo.
--   2. `fn_espelho_limpa_projecao` + `fn_espelha_reuniao_no_funil` (só o corpo).
--   3. BACKFILL DA PROJEÇÃO — 17 entradas, medidas (detalhe abaixo).
--   4. BACKFILL DE `meetings.deal_id` — 151 reuniões, medidas (detalhe abaixo),
--      registrando em `backup.meetings_deal_id_s6_20270928` QUAIS foram (é o
--      que dá ao rollback como desfazer só o que esta migration escreveu).
--   5. `trg_meeting_espelha_no_funil`, por ÚLTIMO.
--
--   O passo 4 vem DEPOIS do 3 e ANTES do 5 de propósito. Se o trigger já
--   existisse, um `UPDATE meetings SET deal_id = …` em 151 linhas dispararia o
--   espelho e projetaria data em 143 entradas a mais — estourando o limite de
--   17 que esta fatia se comprometeu a respeitar. Nascendo o trigger depois, o
--   passo 4 é INERTE: só liga o ponteiro para o futuro.
--
--   E o passo 1 vem antes do 3 porque o backfill da projeção é um UPDATE de
--   `metadata`, e `trg_meeting_events_capture` é
--   `AFTER INSERT OR UPDATE OF stage_key, metadata` (verificado em pg_trigger
--   hoje) — sem o guarda no lugar, as 17 escritas passariam pelo ramo
--   RESCHEDULE e corromperiam `meeting_events` de forma IRREVERSÍVEL:
--   `fn_meeting_delete_cleans_events` só apaga linhas com
--   source='agenda:meeting', então qualquer linha 'pipeline:…' criada por
--   engano sobrevive ao DELETE da reunião, para sempre.
--
-- ── POR QUE O CARIMBO, E NÃO `pg_trigger_depth()` ───────────────────────────
--
--   O espelho grava `metadata.agenda_espelho = {meeting_id, rev, start_at}`
--   com `rev` novo a CADA escrita sua, e `fn_capture_meeting_event` sai calada
--   quando o `rev` MUDOU. O critério é a MUDANÇA, nunca a presença: os dois
--   escritores humanos do lado funil (`pipe_confirmacao_update_fn` e
--   `useSetMeetingDate`) fazem `metadata || jsonb_build_object(...)`, ou seja
--   PRESERVAM o carimbo antigo — e por isso continuam sendo capturados
--   exatamente como hoje.
--
--   `pg_trigger_depth() > 1` foi descartado e a razão é medida, não estética:
--   `pipe_confirmacao` ainda é VIEW com `INSTEAD OF UPDATE`, então a edição
--   humana pelo `MeetingFieldBlock` entra pela view (depth 1) e chega em
--   `pipeline_entries` em depth 2. Um guarda por profundidade CALARIA esse
--   caminho — que hoje emite evento legitimamente (as 10 linhas
--   `pipeline:*:reschedule` de prod vieram exatamente daí). Isso quebraria o
--   invariante pelo outro lado: números que hoje crescem parariam de crescer.
--
--   O guarda é `RETURN NEW` da função INTEIRA, não "comportar-se melhor".
--   Motivo: mesmo no cenário feliz (data igual, dentro de 30 dias, sem linha
--   nova), o ramo RESCHEDULE faria `UPDATE meeting_events SET meeting_date`
--   em `v_prev` — e `v_prev` é buscado POR LEAD
--   (`lead_id + organization_id + event_type='meeting_booked' ORDER BY
--   occurred_at DESC LIMIT 1`), não por reunião nem por negócio. Num lead com
--   duas reuniões, espelhar a segunda SOBRESCREVERIA a âncora da primeira.
--   Zero linha a mais, e ainda assim `reunioesComparecidas` (ancorada em
--   `COALESCE(meeting_date, occurred_at)`) e `noShow` (que compara
--   `meeting_date < NOW()`) mudam de mês. Corrupção silenciosa que contagem
--   de linhas não pega — daí a asserção por `id` no ensaio.
--
-- ── A VIA QUE O GUARDA NÃO SUPRIME, E POR QUE ELA FICA ABERTA ──────────────
--
--   O guarda cala a escrita DO ESPELHO. Ele não cala — e não deve calar — o
--   que vier DEPOIS: mover o card para uma etapa de reunião é escrita HUMANA,
--   o `rev` do carimbo não muda, e `fn_capture_meeting_event` roda inteira,
--   como roda hoje. O que mudou é que agora ela pode encontrar no metadata uma
--   `meeting_date` que o espelho pôs.
--
--   Isso NÃO é mecanismo novo: é o mesmo que já acontece quando alguém digita
--   a data no card (`MeetingFieldBlock`) e depois arrasta a etapa. O espelho
--   não inventa caminho — alimenta um caminho existente com uma data que é
--   verdadeira. O efeito de fronteira, porém, é real e precisa ser MEDIDO e
--   não presumido: com data no metadata, o ramo BOOKED decide INSERT vs UPDATE
--   pela distância de 30 dias; sem data, decidia por `v_meeting_date IS NULL`.
--   O ensaio cobre isso no cenário 50, com braço A/B na MESMA entrada e no
--   MESMO lead (a única forma de o número significar alguma coisa), imprime os
--   dois braços e REPROVA se um único movimento de card produzir mais de um
--   `meeting_booked` ou mais de um `meeting_held` — dupla contagem é o que a
--   fatia proíbe; capturar o movimento com a data certa é o que ela quer.
--
--   A invariante congelada não é tocada por aqui: ela compara meses FECHADOS
--   anteriores ao apply, e card de mês fechado não se move sozinho.
--
-- ── O QUE O ESPELHO NUNCA FAZ (e por quê) ───────────────────────────────────
--
--   * NUNCA `INSERT` nem `DELETE` em `pipeline_entries` — só `UPDATE` de linha
--     existente. O primeiro predicado do ramo BOOKED de
--     `fn_capture_meeting_event` é `v_slug='confirmacao' AND TG_OP='INSERT'`:
--     dispara incondicionalmente. Espelho que insere linha inflaria
--     `reunioesMarcadas` direto.
--   * NUNCA escreve `stage_key`, `stage_id`, `is_confirmed` nem `assigned_to`.
--     Os ramos BOOKED e HELD exigem `TG_OP='INSERT'` OU mudança de
--     `stage_key`; sem tocar etapa, nenhum dos dois pode acontecer. É isso que
--     fecha por CONSTRUÇÃO o vetor das 757+114 etapas de prod que já usam
--     `stage_role` — uma etapa `meeting_held` faria nascer um `meeting_held`
--     pendurado no booked do FUNIL enquanto a Agenda pendurou o dela no booked
--     `agenda:meeting`, e `reunioesComparecidas` contaria 2 (o índice único é
--     por `booked_event_id` e não veria conflito). Fechado para o ESPELHO —
--     para o movimento humano posterior, ver a seção anterior: lá o caminho
--     continua aberto de propósito, e o ensaio o mede.
--   * NUNCA apaga `meet_link` que não seja idêntico ao da reunião removida, e
--     só escreve `meet_link` quando `meetings.meet_link` é não-nulo. O funil
--     pode ter um link que a Agenda não conhece.
--   * NUNCA derruba o UPDATE da reunião. Sai calado quando: `event_type` não é
--     'meeting'; `deal_id` é NULL; não há `pipeline_entries` com aquele
--     `deal_id`; a org do meeting difere da org da entrada.
--
--   A limpeza (cancel / delete / troca de negócio) é CONDICIONAL: só apaga se
--   `metadata->'agenda_espelho'->>'meeting_id'` for IGUAL ao id da reunião em
--   questão. Carimbo de outra reunião, ou ausente (data de origem do funil) =
--   não mexe. Sem isso, apagar uma reunião na Agenda apagaria a data que o
--   vendedor pôs pelo card.
--
--   A limpeza REMOVE a chave (`metadata - 'meeting_date'`), nunca grava ''.
--   Não é preferência: `negocio_projetado` faz
--   `(pe.metadata ->> 'meeting_date')::timestamp with time zone` SEM `NULLIF`
--   (verificado em pg_get_viewdef hoje). String vazia derruba a view — e 16
--   funções de prod dependem dela.
--
-- ── POR QUE `deal_id`, E NUNCA `(lead_id, start_at)` ────────────────────────
--
--   `uq_pipeline_entries_deal_id` (UNIQUE parcial) torna deal_id ↔ entrada
--   estritamente 1:1, então o alvo é sempre no máximo uma linha. Casar por
--   `(lead_id, start_at)` seria o defeito: 4.948 leads de prod têm mais de um
--   negócio, e o mesmo par casaria com TODOS — a mesma reunião em dois cards.
--   Reunião sem negócio simplesmente não aparece no card do Negócio, que é o
--   comportamento de hoje. Zero regressão.
--
-- ── BACKFILL 1 — A PROJEÇÃO (17 linhas, medido) ─────────────────────────────
--
--   Pares (reunião × entrada) casando por `deal_id` + org hoje: 642, e a
--   relação é 1:1 (642 entradas distintas). Deles:
--     • 615 já têm `metadata.meeting_date` IGUAL a `meetings.start_at` → nada;
--     •  10 têm data DIVERGENTE → INTOCADAS. A data do funil pode ser a mais
--        recente; sobrescrevê-la seria perder o trabalho de alguém;
--     •  17 estão sem data → é o que este backfill escreve.
--   Onde estão as 17: 16 no funil `whatsapp` (1 delas fechada) e 1 em
--   `confirmacao/reuniao_marcada`. As 642 do backfill do S3 NÃO são
--   reprojetadas.
--
--   O backfill roda com `update_pipeline_entries_updated_at` e
--   `trg_sync_whatsapp_stage_to_lead` DESABILITADOS, e isso é deliberado:
--     • `updated_at` (ADR-0017 R3): `get_dashboard_metrics` NÃO referencia
--       `updated_at` em nenhuma linha do corpo (medido: zero ocorrências), e
--       por isso as três métricas do invariante são imunes por construção.
--       MAS outras leitoras ancoram nele de verdade —
--       `get_analytics_pipeline_metrics` calcula
--       `AVG(pw.updated_at - lc.created_at)` (avg_days_whatsapp) e
--       `AVG(pp.updated_at - me.occurred_at)` (avg_days_propostas), e
--       `get_pipeline_page` / `get_pipeline_stage_counts_by_id` caem em
--       `pe.updated_at` por COALESCE quando `metrics_period_at` falta, e é
--       essa a âncora de período do card FECHADO lá.
--       Com 16 das 17 no funil `whatsapp` e 1
--       fechada SEM `metrics_period_at`, deixar o toque acontecer mexeria
--       nesses números por um motivo que não é do negócio: um backfill.
--     • `trg_sync_whatsapp_stage_to_lead` não tem NADA a fazer aqui — o
--       backfill não muda etapa. Ligado, ele reescreveria
--       `leads.pipe_whatsapp` com o MESMO valor e bumparia `leads.updated_at`
--       de 16 leads à toa.
--   Nos dois casos a desabilitação vale só para o statement, dentro da
--   transação da migration. `ALTER TABLE … DISABLE TRIGGER` pega
--   SHARE ROW EXCLUSIVE desde o PG 13 (prod é 17.6) — NÃO ACCESS EXCLUSIVE.
--   Isso basta para a janela ser segura: SHARE ROW EXCLUSIVE conflita com
--   ROW EXCLUSIVE, que é o lock de todo INSERT/UPDATE/DELETE, então nenhum
--   escritor concorrente passa. Quem LÊ (ACCESS SHARE) não é bloqueado.
--
--   No caminho VIVO (trigger) NENHUM dos dois é desabilitado: remarcar reunião
--   É um toque no card, e `updated_at` andar ali está certo.
--
-- ── BACKFILL 2 — `meetings.deal_id` (151 linhas, medido) ────────────────────
--
--   905 das 935 linhas de `meetings` são `event_type='meeting'` (as outras 30:
--   22 `call`, 7 `follow_up`, 1 `other`). Dessas, 263 estão sem `deal_id`:
--     •  11 não têm lead                        → ficam NULL
--     •  79 têm lead SEM nenhum negócio         → ficam NULL
--     •  19 são AMBÍGUAS (o lead tem mais de uma entrada aberta com negócio)
--                                               → ficam NULL. Não há pessoa
--        para escolher, e adivinhar põe a reunião no card errado.
--     •   3 só têm entrada FECHADA              → ficam NULL
--     • 151 resolvem para EXATAMENTE UM negócio aberto → é o que escrevemos.
--   Total que fica de fora: 112. Depois do backfill: 793 de 905 com ponteiro.
--   As 151 apontam para 148 negócios distintos — 2 negócios passam a ter mais
--   de uma reunião (hoje: 0). Isso é aceito: a projeção é last-write-wins e a
--   limpeza por carimbo garante que apagar uma delas não apague a projeção da
--   outra. Só 8 das 151 estão `scheduled` e 2 têm `start_at` no futuro — este
--   backfill é sobretudo histórico, e nasce inerte.
--
--   Ele NÃO dispara `trg_meeting_outcome_to_events`: aquele trigger é
--   `AFTER INSERT OR UPDATE OF status` e aqui só `deal_id` muda. `meetings`
--   não tem coluna `updated_at` lida por métrica nenhuma (medido: zero
--   funções ancoram em `m.updated_at`), então `update_meetings_updated_at`
--   pode bumpar à vontade.
--
--   PROCEDÊNCIA — por que este backfill escreve um LIVRO (`backup.
--   meetings_deal_id_s6_20270928`) e não confia em nenhuma coluna de
--   `meetings` para se identificar depois:
--     Depois que o ponteiro está escrito, NADA na linha diz quem o escreveu —
--     este backfill, o picker da Agenda ou o `meeting-webhook`. `created_at`
--     parece separar e NÃO separa: medido em prod hoje, 145 das 151 alvo têm
--     `created_at` EXATAMENTE = 2026-09-01 19:55:09.193388+00, porque foi o
--     backfill do S3/S4 que INSERIU essas linhas — o instante é o de criação
--     da LINHA, não o da escrita do `deal_id`. Um rollback recortado por
--     `created_at <> aquele instante` reverteria 6 das 151 e, pior, zeraria o
--     `deal_id` de TODA reunião criada pelo app depois do apply.
--     O livro resolve os dois lados: o rollback desfaz exatamente as linhas
--     que esta migration tocou, e só enquanto o valor ainda for o que ela
--     escreveu — vínculo que uma pessoa refez depois fica de pé.
--     Mesma forma (schema `backup`, sem grant para anon/authenticated, fora do
--     PostgREST) que a 20270925000000 já usa para dado removido por migration.
--
-- ── EFEITO COLATERAL ACEITO E DESEJADO ──────────────────────────────────────
--
--   `trg_entry_touch_deal_activity` (AFTER INSERT OR UPDATE, sem WHEN) bumpa
--   `deals.last_activity_at` a cada escrita do espelho. É semanticamente
--   CORRETO — marcar ou remarcar reunião É atividade no negócio — e a própria
--   função isola com `set_config('torque.activity_only','1',true)`, então
--   `fn_deals_preserve_updated_at` segura `deals.updated_at` e ele não anda.
--
--   Os demais triggers de `pipeline_entries` (workflow, webhook, dispatch,
--   checklist, histórico, stage_changed_at) são todos `OF stage_key, stage_id`
--   e/ou têm `WHEN (old.stage_key IS DISTINCT FROM new.stage_key)`: escrita só
--   de metadata não os acorda. `trg_pe_stage_mirror` roda, mas é BEFORE puro-
--   NEW sem DML e com etapa inalterada não faz nada. Verificado em pg_trigger.
--
-- ── CORREÇÃO DE UM COMENTÁRIO QUE ESTA FATIA INVALIDA ───────────────────────
--
--   `fn_meeting_outcome_to_events` afirma no corpo: "Não há duplicidade com o
--   funil: movimento de card grava em `meeting_events` e NÃO cria linha em
--   `meetings`, então cada origem produz um agendamento e só um."
--   A PARTIR DAQUI ISSO DEIXA DE SER VERDADE no sentido em que foi escrito: as
--   duas origens passam a se TOCAR — a Agenda escreve no metadata do funil. O
--   que continua verdade, e é o que segura a invariante, é que o funil segue
--   sem criar linha em `meetings`, e que a escrita do espelho é SUPRIMIDA por
--   `fn_capture_meeting_event` pelo carimbo. Não é mais a assimetria das
--   tabelas que separa as origens: é o carimbo. A função não é alterada aqui
--   (só o comentário está desatualizado, o código está certo) — trocá-la para
--   corrigir texto seria mexer em escritor de métrica sem necessidade.
--
-- Idempotente: CREATE OR REPLACE nas funções (preserva grants — DROP+CREATE
-- resetaria), DROP TRIGGER IF EXISTS + CREATE, e os dois backfills têm
-- predicado que os torna no-op na segunda passada.
--
-- Rollback pareado em
-- supabase/migrations/rollback/20270928000000_agenda_espelha_a_reuniao_no_funil.sql
-- Ensaio transacional (obrigatório ANTES do apply) em
-- .specs/agenda-fonte-unica/ensaio-s6.sql

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. GUARDA ANTI-LAÇO
--    Corpo baixado de prod em 2026-09-03 (idêntico ao da 20270918000010) e
--    alterado em UM ponto só: o bloco novo logo após o BEGIN.
-- ═══════════════════════════════════════════════════════════════════════════

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
  v_role_new public.stage_role;
BEGIN
  -- ── GUARDA ANTI-LAÇO (S6) ────────────────────────────────────────────────
  -- O espelho da Agenda reprojeta em `metadata` um fato que
  -- `fn_meeting_outcome_to_events` JÁ gravou em `meeting_events` como
  -- source='agenda:meeting'. Sem esta saída, o ramo RESCHEDULE lá embaixo
  -- reescreveria a `meeting_date` desse mesmo agendamento — ou, passando de 30
  -- dias, INSERIRIA um segundo `meeting_booked` para a mesma reunião.
  --
  -- O critério é a MUDANÇA do carimbo, nunca a presença dele: os escritores do
  -- funil fazem `metadata || jsonb_build_object(...)` (verificado em
  -- `pipe_confirmacao_update_fn` e em `useSetMeetingDate`), então uma edição
  -- humana PRESERVA o carimbo antigo e continua sendo capturada como hoje.
  --
  -- `IS DISTINCT FROM` cobre também a limpeza: na remoção o `rev` vai de 'X'
  -- para NULL, e apagar projeção também não pode gerar evento.
  IF TG_OP = 'UPDATE'
     AND (NEW.metadata->'agenda_espelho'->>'rev')
         IS DISTINCT FROM (OLD.metadata->'agenda_espelho'->>'rev') THEN
    RETURN NEW;
  END IF;

  SELECT p.slug INTO v_slug FROM public.pipelines p WHERE p.id = NEW.pipeline_id;

  -- SCRUM-641: PAPEL da etapa de destino — a âncora que vale em QUALQUER
  -- funil (premissa da Agenda absorvida). Resolvido por (pipeline_id,
  -- stage_key); etapa sem linha (legado) fica NULL e só os predicados
  -- literais de sempre decidem.
  SELECT ps.stage_role INTO v_role_new
  FROM public.pipeline_stages ps
  WHERE ps.pipeline_id = NEW.pipeline_id
    AND ps.stage_key = NEW.stage_key
  LIMIT 1;

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
  -- Predicados LITERAIS preservados na íntegra (108 orgs atuais) + o predicado
  -- por PAPEL (SCRUM-641): entrar numa etapa com stage_role='meeting_booked'
  -- de QUALQUER funil marca reunião — org nova sem o trio inclusa. O dedup de
  -- 30 dias logo abaixo continua sendo quem decide UPDATE vs INSERT.
  IF (v_slug = 'confirmacao' AND TG_OP = 'INSERT')
     OR (NEW.stage_key = 'agendado' AND (TG_OP = 'INSERT' OR OLD.stage_key IS DISTINCT FROM NEW.stage_key))
     OR (v_role_new = 'meeting_booked' AND (TG_OP = 'INSERT' OR OLD.stage_key IS DISTINCT FROM NEW.stage_key)) THEN
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
  IF (NEW.stage_key = 'compareceu' OR v_role_new = 'meeting_held')
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. O ESPELHO
-- ═══════════════════════════════════════════════════════════════════════════

-- Limpeza CONDICIONAL da projeção. Separada em função própria porque é chamada
-- de quatro lugares (cancelar, deletar, trocar de negócio, deixar de ser
-- reunião) e errar a condição em UM deles apagaria a data que o vendedor pôs
-- pelo card.
CREATE OR REPLACE FUNCTION public.fn_espelho_limpa_projecao(
  p_deal_id    uuid,
  p_org_id     uuid,
  p_meeting_id uuid,
  p_meet_link  text
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_deal_id IS NULL OR p_org_id IS NULL OR p_meeting_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.pipeline_entries pe
     SET metadata = CASE
           -- `meet_link` só sai se for EXATAMENTE o desta reunião. O funil pode
           -- ter um link próprio que a Agenda nunca conheceu.
           WHEN p_meet_link IS NOT NULL AND pe.metadata->>'meet_link' = p_meet_link
             THEN pe.metadata - 'meeting_date' - 'agenda_espelho' - 'meet_link'
           ELSE pe.metadata - 'meeting_date' - 'agenda_espelho'
         END
   WHERE pe.deal_id = p_deal_id
     AND pe.organization_id = p_org_id
     -- A CONDIÇÃO que torna a limpeza segura: só apaga o que este espelho pôs.
     -- Carimbo de outra reunião, ou ausente (data de origem do funil) = não
     -- mexe. `- 'meeting_date'` REMOVE a chave; gravar '' derrubaria
     -- `negocio_projetado`, que faz o cast sem NULLIF.
     AND pe.metadata->'agenda_espelho'->>'meeting_id' = p_meeting_id::text;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_espelha_reuniao_no_funil()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- DELETE: some da agenda, some do card — se o carimbo for desta reunião.
  IF TG_OP = 'DELETE' THEN
    IF OLD.event_type IS DISTINCT FROM 'meeting' THEN
      RETURN OLD;
    END IF;
    PERFORM public.fn_espelho_limpa_projecao(
      OLD.deal_id, OLD.organization_id, OLD.id, OLD.meet_link);
    RETURN OLD;
  END IF;

  -- PORTA 1 — só REUNIÃO vira reunião no card. Em prod moram em `meetings`
  -- 22 `call`, 7 `follow_up` e 1 `other`. Sem este filtro, "Retornar contato"
  -- viraria a reunião do negócio.
  IF NEW.event_type IS DISTINCT FROM 'meeting' THEN
    -- …e se ERA reunião e deixou de ser, a projeção antiga não pode ficar órfã.
    IF TG_OP = 'UPDATE' AND OLD.event_type = 'meeting' THEN
      PERFORM public.fn_espelho_limpa_projecao(
        OLD.deal_id, OLD.organization_id, OLD.id, OLD.meet_link);
    END IF;
    RETURN NEW;
  END IF;

  -- TROCA DE NEGÓCIO (inclusive para NULL): limpa o ANTIGO antes de escrever
  -- no novo. A ordem importa — invertida, um negócio novo igual ao antigo
  -- perderia a projeção que acabou de ganhar.
  IF TG_OP = 'UPDATE' AND OLD.deal_id IS DISTINCT FROM NEW.deal_id THEN
    PERFORM public.fn_espelho_limpa_projecao(
      OLD.deal_id, OLD.organization_id, OLD.id, OLD.meet_link);
  END IF;

  -- CANCELADA: a reunião não vale mais, a projeção sai. Hoje nenhuma linha de
  -- prod usa 'cancelled' e a Agenda ainda não expõe o estado — o espelho já
  -- nasce correto para quando expuser.
  IF NEW.status = 'cancelled' THEN
    PERFORM public.fn_espelho_limpa_projecao(
      NEW.deal_id, NEW.organization_id, NEW.id, NEW.meet_link);
    RETURN NEW;
  END IF;

  -- PORTA 2 — sem negócio, não há card onde projetar. Reunião sem negócio
  -- continua sem aparecer no card, que é o comportamento de hoje: zero
  -- regressão. 19,2% das entradas de prod não têm `deal_id`.
  IF NEW.deal_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- A PROJEÇÃO. Três chaves, e só três.
  --   * `status` = 'completed'/'no_show' cai AQUI de propósito: mantém a data
  --     e só renova o carimbo. O card deve continuar mostrando QUANDO foi a
  --     reunião; o desfecho já vive em `meeting_events` desde o S5.
  --   * `rev` novo a cada escrita — é ele que `fn_capture_meeting_event` lê.
  --   * `meet_link` só entra quando não-nulo: nunca apagar link do funil.
  -- Sem `INSERT`, sem `DELETE`, e sem tocar stage_key/stage_id/is_confirmed/
  -- assigned_to. O `WHERE` por `deal_id` + org alcança no máximo uma linha
  -- (uq_pipeline_entries_deal_id); zero linha sai calado, de propósito —
  -- derrubar o UPDATE da reunião por causa do espelho seria trocar um defeito
  -- por outro.
  UPDATE public.pipeline_entries pe
     SET metadata = COALESCE(pe.metadata, '{}'::jsonb)
                    || jsonb_build_object('meeting_date', NEW.start_at)
                    || CASE
                         WHEN NEW.meet_link IS NOT NULL
                           THEN jsonb_build_object('meet_link', NEW.meet_link)
                         ELSE '{}'::jsonb
                       END
                    || jsonb_build_object(
                         'agenda_espelho',
                         jsonb_build_object(
                           'meeting_id', NEW.id,
                           'rev',        gen_random_uuid()::text,
                           'start_at',   NEW.start_at))
   WHERE pe.deal_id = NEW.deal_id
     AND pe.organization_id = NEW.organization_id;

  RETURN NEW;
END;
$function$;

-- Mesma forma de ACL de `fn_capture_meeting_event` em prod (sem PUBLIC, sem
-- anon). O `ALTER DEFAULT PRIVILEGES` do schema concede EXECUTE a anon em TODA
-- função nova de dono postgres (medido em pg_default_acl hoje) — REVOKE FROM
-- PUBLIC sozinho não alcança, o grant é direto no papel.
REVOKE ALL ON FUNCTION public.fn_espelha_reuniao_no_funil() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_espelho_limpa_projecao(uuid, uuid, uuid, text) FROM PUBLIC, anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. BACKFILL DA PROJEÇÃO — 17 linhas medidas. Roda ANTES do trigger nascer.
-- ═══════════════════════════════════════════════════════════════════════════

-- `DISABLE TRIGGER` pega SHARE ROW EXCLUSIVE em `pipeline_entries` (assim
-- desde o PG 13; prod é 17.6 — não é ACCESS EXCLUSIVE). Ainda conflita com
-- ROW EXCLUSIVE, o lock de todo INSERT/UPDATE/DELETE, então escritor
-- concorrente espera; leitor não. Com `lock_timeout = 5s` (topo do arquivo) a
-- migration FALHA rápido se prod estiver escrevendo, em vez de segurar a
-- tabela — falhar e repetir é barato, travar o funil de 106 orgs não é. A
-- desabilitação vive só dentro desta transação; qualquer erro adiante reverte
-- tudo, triggers inclusive.
ALTER TABLE public.pipeline_entries DISABLE TRIGGER update_pipeline_entries_updated_at;
ALTER TABLE public.pipeline_entries DISABLE TRIGGER trg_sync_whatsapp_stage_to_lead;

DO $backfill_projecao$
DECLARE
  v_previstas    int;   -- quantas o predicado alcança ANTES de escrever
  v_escritas     int;   -- quantas o UPDATE realmente tocou
  v_divergentes  int;
  v_coincidentes int;
BEGIN
  -- Fotografia do ANTES. Serve de conferência contra o número medido em prod
  -- e, na segunda passada (reaplicação), prova o no-op: v_previstas = 0.
  SELECT
    count(*) FILTER (WHERE NULLIF(pe.metadata->>'meeting_date','') IS NULL),
    count(*) FILTER (WHERE NULLIF(pe.metadata->>'meeting_date','') IS NOT NULL
                       AND (pe.metadata->>'meeting_date')::timestamptz <> m.start_at),
    count(*) FILTER (WHERE NULLIF(pe.metadata->>'meeting_date','') IS NOT NULL
                       AND (pe.metadata->>'meeting_date')::timestamptz = m.start_at)
  INTO v_previstas, v_divergentes, v_coincidentes
  FROM public.meetings m
  JOIN public.pipeline_entries pe
    ON pe.deal_id = m.deal_id AND pe.organization_id = m.organization_id
  WHERE m.event_type = 'meeting'
    AND m.deal_id IS NOT NULL
    AND m.status <> 'cancelled';

  -- Escreve SÓ onde não há data. As divergentes ficam intocadas: a data do
  -- funil pode ser a mais recente, e sobrescrevê-la seria perder trabalho.
  -- O carimbo vai junto — é ele que faz `fn_capture_meeting_event` sair calada
  -- e mantém estas 17 escritas metric-neutras.
  UPDATE public.pipeline_entries pe
     SET metadata = COALESCE(pe.metadata, '{}'::jsonb)
                    || jsonb_build_object('meeting_date', m.start_at)
                    || CASE
                         WHEN m.meet_link IS NOT NULL
                           THEN jsonb_build_object('meet_link', m.meet_link)
                         ELSE '{}'::jsonb
                       END
                    || jsonb_build_object(
                         'agenda_espelho',
                         jsonb_build_object(
                           'meeting_id', m.id,
                           'rev',        gen_random_uuid()::text,
                           'start_at',   m.start_at))
    FROM public.meetings m
   WHERE m.deal_id = pe.deal_id
     AND m.organization_id = pe.organization_id
     AND m.event_type = 'meeting'
     AND m.status <> 'cancelled'
     AND NULLIF(pe.metadata->>'meeting_date','') IS NULL;

  GET DIAGNOSTICS v_escritas = ROW_COUNT;

  IF v_escritas IS DISTINCT FROM v_previstas THEN
    RAISE EXCEPTION 'S6: backfill da projeção escreveu % linhas, mas o predicado alcançava % — o alvo mudou entre a contagem e a escrita. Abortando.',
      v_escritas, v_previstas;
  END IF;

  RAISE NOTICE 'S6 backfill projeção: % entradas ganharam meeting_date (medido em 2026-09-03: 17). Divergentes INTOCADAS: % (medido: 10). Já coincidentes: % (medido: 615).',
    v_escritas, v_divergentes, v_coincidentes;
END;
$backfill_projecao$;

ALTER TABLE public.pipeline_entries ENABLE TRIGGER trg_sync_whatsapp_stage_to_lead;
ALTER TABLE public.pipeline_entries ENABLE TRIGGER update_pipeline_entries_updated_at;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. BACKFILL DE `meetings.deal_id` — 151 linhas medidas.
--    Roda DEPOIS da projeção e ANTES do trigger. Se rodasse depois do trigger,
--    o próprio UPDATE dispararia o espelho e projetaria data em 143 entradas
--    a mais (medido) — muito além das 17 que esta fatia autoriza.
-- ═══════════════════════════════════════════════════════════════════════════

-- O LIVRO DA PROCEDÊNCIA. Sem ele o rollback não tem como saber quais
-- ponteiros são desta migration: depois de escrito, o `deal_id` do backfill é
-- indistinguível do que o picker ou o `meeting-webhook` escreverem depois, e
-- `created_at` NÃO separa (145 das 151 alvo nasceram no mesmo instante do
-- backfill do S3/S4 — medido). Schema `backup`, fora do PostgREST e sem grant
-- para anon/authenticated, no mesmo molde da 20270925000000.
CREATE SCHEMA IF NOT EXISTS backup;
-- O COMMENT é reescrito porque o schema passa a guardar duas coisas; a menção
-- à 20270925000000 (quem o criou) fica, senão esta linha apaga a procedência
-- do vizinho ao ser aplicada depois dele.
COMMENT ON SCHEMA backup IS
  'Cópias frias de dados removidos por migration e livros de procedência de backfill. NÃO exposto no PostgREST e sem grant para anon/authenticated. Ver 20270925000000 e 20270928000000.';
REVOKE ALL ON SCHEMA backup FROM PUBLIC;
REVOKE ALL ON SCHEMA backup FROM anon;
REVOKE ALL ON SCHEMA backup FROM authenticated;

CREATE TABLE IF NOT EXISTS backup.meetings_deal_id_s6_20270928 (
  meeting_id      uuid        PRIMARY KEY,
  deal_id_escrito uuid        NOT NULL,
  escrito_em      timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE backup.meetings_deal_id_s6_20270928 FROM PUBLIC;
REVOKE ALL ON TABLE backup.meetings_deal_id_s6_20270928 FROM anon;
REVOKE ALL ON TABLE backup.meetings_deal_id_s6_20270928 FROM authenticated;
COMMENT ON TABLE backup.meetings_deal_id_s6_20270928 IS
  'S6 — as reuniões cujo meetings.deal_id foi escrito pelo backfill da 20270928000000, com o valor escrito. Consumido pelo rollback pareado, que só reverte a linha cujo deal_id AINDA é este (vínculo refeito por gente fica de pé). Pode ser descartada depois que a fatia estabilizar.';

DO $backfill_deal_id$
DECLARE
  v_resolvidas   int;
  v_sem_lead     int;
  v_sem_negocio  int;
  v_ambiguas     int;
  v_so_fechadas  int;
BEGIN
  -- `RETURNING` alimentando o livro no MESMO statement: contar depois, por
  -- predicado, devolveria o conjunto de agora — que já inclui o que outro
  -- caminho escrever amanhã.
  WITH resolvidas AS (
    UPDATE public.meetings m
       SET deal_id = (
             SELECT pe.deal_id
               FROM public.pipeline_entries pe
              WHERE pe.lead_id = m.lead_id
                AND pe.organization_id = m.organization_id
                AND pe.deal_id IS NOT NULL
                AND pe.closed_at IS NULL)
     WHERE m.deal_id IS NULL
       AND m.lead_id IS NOT NULL
       AND m.event_type = 'meeting'
       -- EXATAMENTE UMA entrada aberta com negócio. Havendo mais de uma não há
       -- pessoa para escolher, e escolher por conta própria é o que faz reunião
       -- aparecer no card errado.
       AND (SELECT count(*)
              FROM public.pipeline_entries pe
             WHERE pe.lead_id = m.lead_id
               AND pe.organization_id = m.organization_id
               AND pe.deal_id IS NOT NULL
               AND pe.closed_at IS NULL) = 1
    RETURNING m.id, m.deal_id
  )
  INSERT INTO backup.meetings_deal_id_s6_20270928 (meeting_id, deal_id_escrito)
  SELECT r.id, r.deal_id FROM resolvidas r
  -- Reaplicação: o UPDATE já não alcança nada (deal_id deixou de ser NULL), e
  -- o ON CONFLICT protege o livro caso alguém rode a migration sobre um livro
  -- que sobreviveu a um rollback parcial.
  ON CONFLICT (meeting_id) DO NOTHING;

  GET DIAGNOSTICS v_resolvidas = ROW_COUNT;

  -- Quem ficou de fora, e por quê. Contado DEPOIS do UPDATE, então o que
  -- sobrar aqui é exatamente o que continua sem ponteiro.
  SELECT
    count(*) FILTER (WHERE m.lead_id IS NULL),
    count(*) FILTER (WHERE m.lead_id IS NOT NULL AND ne.total = 0),
    count(*) FILTER (WHERE m.lead_id IS NOT NULL AND ne.abertas > 1),
    count(*) FILTER (WHERE m.lead_id IS NOT NULL AND ne.abertas = 0 AND ne.total > 0)
  INTO v_sem_lead, v_sem_negocio, v_ambiguas, v_so_fechadas
  FROM public.meetings m
  LEFT JOIN LATERAL (
    SELECT count(*) AS total,
           count(*) FILTER (WHERE pe.closed_at IS NULL) AS abertas
      FROM public.pipeline_entries pe
     WHERE pe.lead_id = m.lead_id
       AND pe.organization_id = m.organization_id
       AND pe.deal_id IS NOT NULL) ne ON true
  WHERE m.deal_id IS NULL AND m.event_type = 'meeting';

  RAISE NOTICE 'S6 backfill deal_id: % reuniões ganharam negócio (medido em 2026-09-03: 151), todas registradas em backup.meetings_deal_id_s6_20270928 (% linhas no livro).',
    v_resolvidas,
    (SELECT count(*) FROM backup.meetings_deal_id_s6_20270928);
  RAISE NOTICE 'S6 backfill deal_id — ficaram de fora %: sem lead %, lead sem negócio %, ambíguas %, só entrada fechada % (medido em 2026-09-03: 112 = 11 + 79 + 19 + 3).',
    v_sem_lead + v_sem_negocio + v_ambiguas + v_so_fechadas,
    v_sem_lead, v_sem_negocio, v_ambiguas, v_so_fechadas;
END;
$backfill_deal_id$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. O TRIGGER, POR ÚLTIMO.
-- ═══════════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_meeting_espelha_no_funil ON public.meetings;

CREATE TRIGGER trg_meeting_espelha_no_funil
AFTER INSERT
    OR UPDATE OF deal_id, lead_id, start_at, meet_link, status, event_type
    OR DELETE
ON public.meetings
FOR EACH ROW
EXECUTE FUNCTION public.fn_espelha_reuniao_no_funil();

COMMENT ON FUNCTION public.fn_espelha_reuniao_no_funil() IS
  'S6 — projeta meetings (start_at, meet_link) em pipeline_entries.metadata do negócio, carimbando agenda_espelho.rev. NÃO escreve meeting_events; a supressão de dupla contagem mora no guarda de fn_capture_meeting_event, que lê a MUDANÇA do rev.';

COMMENT ON FUNCTION public.fn_espelho_limpa_projecao(uuid, uuid, uuid, text) IS
  'S6 — remove meeting_date/agenda_espelho (e meet_link, se idêntico) da entrada, SOMENTE quando o carimbo aponta para a reunião passada. Carimbo de outra reunião ou ausente = não mexe.';
