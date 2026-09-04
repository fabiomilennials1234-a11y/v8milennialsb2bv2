-- Ensaio TRANSACIONAL do S6 (20270928000000) contra PROD. Termina em ROLLBACK.
--
-- Rodar assim (o `\i MIGRATION` é literal, no mesmo estilo de ensaio-s3/s4):
--   psql "$PROD_URL" -v ON_ERROR_STOP=1 -f .specs/agenda-fonte-unica/ensaio-s6.sql
-- trocando a linha `\i MIGRATION` pelo caminho real do arquivo.
--
-- ⚠ Rodar como DONO das tabelas (postgres). `meetings`, `meeting_events` e
--   `pipeline_entries` têm RLS ligada mas NÃO forçada (relforcerowsecurity =
--   false, medido hoje), então o dono passa; qualquer outro papel veria menos
--   linhas e o ensaio ficaria verde por não enxergar.
--
-- ⚠ A migration faz `ALTER TABLE pipeline_entries DISABLE TRIGGER`, que pega
--   SHARE ROW EXCLUSIVE — NÃO ACCESS EXCLUSIVE. O nível caiu no PG 13 e prod é
--   17.6 (`select version()` = PostgreSQL 17.6). Isso NÃO muda a recomendação
--   prática: SHARE ROW EXCLUSIVE conflita com ROW EXCLUSIVE, o lock de todo
--   INSERT/UPDATE/DELETE, então enquanto este ensaio estiver aberto ninguém
--   ESCREVE em `pipeline_entries` (quem só LÊ passa). O lock fica preso até o
--   ROLLBACK: rodar em janela de baixo tráfego e não deixar a sessão aberta.
--
-- ⚠ O cenário 50 MOVE A ETAPA de um card real dentro da transação. Isso acorda
--   os triggers de workflow, webhook e dispatch de `pipeline_entries` — dois
--   deles (`trg_pipeline_entries_dispatch`, `trg_workflow_pipeline_stage_changed`)
--   chamam `net.http_post`. Nada sai da caixa: pg_net ENFILEIRA numa tabela
--   (`net.http_request_queue`) e o worker só enxerga linha COMMITADA — o
--   ROLLBACK final desfaz a fila junto com o resto. Ainda assim, é mais um
--   motivo para rodar em janela de baixo tráfego.
--
-- O QUE ESTE ENSAIO PROVA (nesta ordem de força):
--   1. `meeting_events` fica IDÊNTICA linha a linha — mesmo conjunto de ids,
--      e nenhuma `meeting_date` alterada. Contagem sozinha NÃO pega o defeito
--      que importa: `v_prev` em fn_capture_meeting_event é buscado POR LEAD,
--      então sobrescrever a âncora de um agendamento com a data de outro move
--      `reunioesComparecidas` e `noShow` de mês sem criar linha nenhuma.
--   2. `get_dashboard_metrics` devolve os MESMOS reunioesMarcadas /
--      reunioesComparecidas / noShow para uma org real, em mês fechado.
--   3. CONTROLE POSITIVO A: uma edição HUMANA de `metadata.meeting_date` numa
--      entrada SEM carimbo continua emitindo o evento que emite hoje.
--   4. CONTROLE POSITIVO B: a mesma edição humana numa entrada QUE JÁ FOI
--      ESPELHADA (carimbo presente) também continua emitindo — e o carimbo
--      sobrevive à edição. Este é o passo que sustenta o guarda inteiro: a
--      regra é "sai calada quando o `rev` MUDOU", e ela só é segura porque os
--      escritores do funil fazem `metadata || jsonb_build_object(...)` e
--      PRESERVAM o `rev`. O controle A sozinho prova apenas que o guarda não
--      dispara quando o carimbo NÃO EXISTE — que é outra pergunta.
--   5. A/B DO MOVIMENTO HUMANO DE ETAPA (cenários 50–56), a única via que o
--      guarda NÃO suprime: mover o card depois de o espelho ter projetado é
--      escrita humana, o `rev` não muda e `fn_capture_meeting_event` roda
--      inteira. Os dois braços rodam sobre a MESMA entrada e o MESMO lead (um
--      com a projeção, outro com ela removida), porque `v_prev` é buscado POR
--      LEAD e comparar entradas diferentes não compararia nada. O ensaio
--      IMPRIME os dois braços — o delta entre eles é o efeito de fronteira que
--      a fatia assume, e é o mesmo efeito que alguém digitando a data no card
--      já produz hoje — e REPROVA se um único movimento produzir mais de um
--      `meeting_booked` ou mais de um `meeting_held`. Dupla contagem é o que a
--      fatia proíbe; capturar o movimento com a data certa é o que ela quer.
--      De quebra, 53 prova que REMOVER a projeção também não gera evento.
--
--      ⚠ O A/B tem FIXTURE PRÓPRIA (`entry_ab`), e isso é correção de um
--        defeito MEDIDO na execução de 2026-09-03, não preferência de estilo.
--        Antes ele reaproveitava a entrada dos cenários do espelho (`entry`),
--        e o CONTROLE POSITIVO B roda nessa mesma entrada logo antes: ao
--        emitir, o controle B deixa o `meeting_booked` ABERTO do lead com
--        `meeting_date` IGUAL à data que o espelho projetou (o ramo RESCHEDULE
--        ou insere um booked com essa data, ou reescreve a do `v_prev` para
--        ela — os dois caminhos convergem no mesmo lugar). Com as duas datas
--        iguais, o ramo BOOKED do braço A cai obrigatoriamente no
--        `UPDATE ... SET meeting_date = COALESCE(v_meeting_date, meeting_date)`
--        com o MESMO valor: zero linha nova, zero data alterada. Os dois
--        braços mediram 0/0/0 e a asserção 52 ficou trivialmente verdadeira
--        sobre zeros. NÃO era a projeção que faltava — o cenário 27
--        (contraprova) reprojeta e recarimba depois do DELETE do cenário 25, e
--        a asserção 43 já provava que o carimbo estava lá. Era a DECISÃO que
--        faltava: o alvo do braço A tinha sido pré-alinhado.
--        A fixture própria isola o A/B de tudo que roda antes dele, e a
--        PRÉ-CONDIÇÃO (54) mede, no instante em que o braço A começa, as
--        quatro coisas de que o braço depende — projeção, carimbo, `v_prev`
--        aberto e `v_prev` a mais de 30 dias da data projetada. Faltando
--        qualquer uma, o ensaio ABORTA: zero por falta de alvo não pode passar
--        por zero por acerto.
--
-- ISOLAMENTO — a peça central do desenho do ensaio:
--   Os cenários do espelho usam uma reunião com `deal_id` preenchido e
--   `lead_id` NULL. `fn_meeting_outcome_to_events` sai na porta
--   `NEW.lead_id IS NULL`, então ela não escreve NADA em `meeting_events`.
--   Mas o ESPELHO projeta assim mesmo (a chave dele é `deal_id`), e a entrada
--   alvo TEM lead — logo `fn_capture_meeting_event` é acordada com um lead
--   real, que é exatamente o caminho perigoso. Resultado: qualquer delta em
--   `meeting_events` nos passos 20–24 é atribuível AO ESPELHO e a mais nada.
--
-- PORTÃO vs MEDIDA — a distinção é explícita porque a execução de 2026-09-03
-- mostrou que rótulo não é portão:
--   * PORTÃO: o rótulo diz "tem de ser X" E o valor é conferido, ou pelo
--     `RAISE` no ponto da medida (pré-condições, que precisam parar antes de o
--     resto virar zero sem sentido), ou pelo bloco de VEREDITO do fim, que
--     estoura e derruba a transação inteira. Toda invariante desta fatia é
--     portão: 6, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20–27, 30–34, 40, 41, 42,
--     43, 52, 53, 54, 55, 56.
--   * MEDIDA: número que a pessoa lê e interpreta, sem valor "certo" conhecido
--     de antemão: 1–5, 7, 8, 9, 35, 50, 51. O A/B (50/51) é medida DE
--     PROPÓSITO — o delta entre os braços é o efeito de fronteira que a fatia
--     assume; o que ele tem de portão está em 52 (dupla contagem) e em 54 (o
--     braço A não pode ser mudo).
--
-- NÚMERO CHUMBADO — não tem nenhum. Todo esperado é DERIVADO dentro da própria
-- transação, medindo o antes e comparando com o depois. A execução de
-- 2026-09-03 reprovou a asserção 16 ("divergentes preservadas, tem de ser 10")
-- com 14, e o 14 estava CERTO: o backfill de `meetings.deal_id` faz pares que
-- antes não casavam no join passarem a casar. O comportamento estava correto e
-- o número chumbado é que envelheceu. Constante em ensaio é dívida com juros:
-- ou vira falso vermelho (este caso) ou, pior, falso verde quando a base anda
-- na direção do número.

BEGIN;

-- get_dashboard_metrics chama assert_org_access, que libera service_role.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

CREATE TEMP TABLE _r(ordem int, medida text, valor text) ON COMMIT DROP;

-- ── Fixtures resolvidas do dado vivo (nada de id chumbado: a base anda) ─────
CREATE TEMP TABLE _fx(chave text PRIMARY KEY, v uuid, t text) ON COMMIT DROP;

DO $fx$
DECLARE
  v_org  uuid := '6030520a-2ca7-477d-be89-55758e2cd808';  -- Milennials
  v_deal uuid;
  v_entry uuid;
  v_outra_org uuid;
  v_entry_pc uuid;
  v_entry_ab uuid;
  v_deal_ab uuid;
  v_stage_id uuid;
  v_stage_key text;
BEGIN
  -- A: entrada com negócio, SEM meeting_date, cujo negócio não tem reunião —
  --    e cujo LEAD tem um `meeting_booked` ABERTO. A última condição é o que
  --    torna o ensaio adversarial e NÃO é opcional: o ramo RESCHEDULE de
  --    fn_capture_meeting_event só faz mal quando existe `v_prev_open`. Pegar
  --    uma entrada sem agendamento aberto passaria verde com o guarda
  --    removido.
  --
  --    A condição é sobre o ÚLTIMO booked do lead, não sobre "existe algum
  --    aberto", e a diferença é medida: `v_prev` é
  --    `ORDER BY occurred_at DESC LIMIT 1` e `v_prev_open` olha ESSE. Das 80
  --    candidatas que "têm algum booked aberto" na org do ensaio, 10 têm o
  --    ÚLTIMO já fechado (medido 2026-09-04) — pegar uma delas deixaria
  --    `v_prev_open` falso, os controles 40/42 mudos e o ensaio vermelho por
  --    fixture ruim, não por defeito. 70 candidatas com esta forma.
  SELECT pe.id, pe.deal_id INTO v_entry, v_deal
  FROM public.pipeline_entries pe
  CROSS JOIN LATERAL (
    SELECT me.id, me.meeting_date
      FROM public.meeting_events me
     WHERE me.lead_id = pe.lead_id
       AND me.organization_id = pe.organization_id
       AND me.event_type = 'meeting_booked'
     ORDER BY me.occurred_at DESC
     LIMIT 1
  ) prev
  WHERE pe.organization_id = v_org
    AND pe.deal_id IS NOT NULL
    AND pe.lead_id IS NOT NULL
    AND NULLIF(pe.metadata->>'meeting_date','') IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.meetings m WHERE m.deal_id = pe.deal_id)
    AND NOT EXISTS (SELECT 1 FROM public.meeting_events h
                    WHERE h.event_type = 'meeting_held' AND h.booked_event_id = prev.id)
  LIMIT 1;

  IF v_entry IS NULL THEN
    RAISE EXCEPTION 'ensaio S6: sem entrada-fixture ADVERSARIAL na org % — o ensaio passaria por falta de alvo, não por acerto', v_org;
  END IF;

  -- B: controle positivo — entrada COM meeting_date cujo lead tem um
  --    meeting_booked ABERTO (sem held). É o caminho do MeetingFieldBlock.
  --    Exemplo medido em 2026-09-03: entry a0388388-… (confirmacao).
  SELECT pe.id INTO v_entry_pc
  FROM public.pipeline_entries pe
  WHERE pe.organization_id = v_org
    AND pe.lead_id IS NOT NULL
    -- LEAD DIFERENTE do da fixture A. `v_prev` é buscado POR LEAD; compartilhar
    -- o lead faria o controle positivo e os cenários do espelho disputarem o
    -- mesmo agendamento, e nenhum dos dois provaria o que devia.
    AND pe.lead_id <> (SELECT x.lead_id FROM public.pipeline_entries x WHERE x.id = v_entry)
    AND NULLIF(pe.metadata->>'meeting_date','') IS NOT NULL
    AND pe.metadata->'agenda_espelho' IS NULL
    AND EXISTS (
      SELECT 1 FROM public.meeting_events me
      WHERE me.lead_id = pe.lead_id AND me.organization_id = pe.organization_id
        AND me.event_type = 'meeting_booked'
        AND NOT EXISTS (SELECT 1 FROM public.meeting_events h
                        WHERE h.event_type = 'meeting_held' AND h.booked_event_id = me.id))
  LIMIT 1;

  IF v_entry_pc IS NULL THEN
    RAISE EXCEPTION 'ensaio S6: sem fixture para o CONTROLE POSITIVO — o ensaio seria verde por ausência';
  END IF;

  -- C: fixture PRÓPRIA do A/B do movimento humano de etapa (50–56).
  --
  --    POR QUE NÃO REAPROVEITAR `entry`: porque o CONTROLE POSITIVO B roda
  --    nela imediatamente antes do A/B e, ao emitir (que é o que o controle
  --    prova), deixa o `meeting_booked` ABERTO do lead com `meeting_date`
  --    IGUAL à data que o espelho projetou — os dois caminhos do ramo
  --    RESCHEDULE convergem nisso: ou insere um booked NOVO já com a data
  --    projetada, ou reescreve a data do `v_prev` para ela. Com as duas datas
  --    iguais o braço A cai no `UPDATE ... COALESCE(...)` com o mesmo valor:
  --    0 linha nova, 0 data alterada, e a asserção 52 vira tautologia sobre
  --    zeros. Foi exatamente o que aconteceu em 2026-09-03.
  --
  --    CONDIÇÕES — todas as de `entry` (a fixture segue adversarial: sem
  --    `meeting_booked` aberto no lead, o ramo RESCHEDULE não teria como fazer
  --    mal e o ensaio passaria mesmo com o guarda removido), MAIS três:
  --      • o ÚLTIMO booked do lead tem de ter `meeting_date` NÃO-NULA. É a
  --        âncora de que o braço A precisa para ser posicionado longe dela;
  --        com `v_prev.meeting_date` NULL o ramo BOOKED cai no UPDATE por
  --        `v_prev.meeting_date IS NULL` e a decisão de fronteira não é
  --        exercida;
  --      • LEAD diferente do de `entry` E do de `entry_pc` — `v_prev` é por
  --        lead, e compartilhar lead é justamente o defeito que se conserta
  --        aqui;
  --      • o funil DELA precisa ter para onde mover o card: uma etapa de
  --        agendamento diferente da atual. Sem destino, o A/B ficaria mudo.
  --    47 candidatas em 29 leads na org do ensaio (medido 2026-09-04).
  SELECT pe.id, pe.deal_id INTO v_entry_ab, v_deal_ab
  FROM public.pipeline_entries pe
  CROSS JOIN LATERAL (
    SELECT me.id, me.meeting_date
      FROM public.meeting_events me
     WHERE me.lead_id = pe.lead_id
       AND me.organization_id = pe.organization_id
       AND me.event_type = 'meeting_booked'
     ORDER BY me.occurred_at DESC
     LIMIT 1
  ) prev
  WHERE pe.organization_id = v_org
    AND pe.deal_id IS NOT NULL
    AND pe.lead_id IS NOT NULL
    AND NULLIF(pe.metadata->>'meeting_date','') IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.meetings m WHERE m.deal_id = pe.deal_id)
    AND prev.meeting_date IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.meeting_events h
                    WHERE h.event_type = 'meeting_held' AND h.booked_event_id = prev.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.pipeline_entries x
      WHERE x.id IN (v_entry, v_entry_pc) AND x.lead_id = pe.lead_id)
    AND EXISTS (
      SELECT 1 FROM public.pipeline_stages ps
      WHERE ps.pipeline_id = pe.pipeline_id
        AND (ps.stage_role = 'meeting_booked' OR ps.stage_key = 'agendado')
        AND ps.stage_key IS DISTINCT FROM pe.stage_key)
  LIMIT 1;

  IF v_entry_ab IS NULL THEN
    RAISE EXCEPTION 'ensaio S6: sem fixture ADVERSARIAL PRÓPRIA para o A/B do movimento de etapa na org % — sem ela o braço A mede zero por falta de alvo, que foi o defeito de 2026-09-03', v_org;
  END IF;

  -- A etapa de destino do braço A/B, resolvida no funil da fixture C.
  -- `stage_role` primeiro: é a âncora que vale em qualquer funil;
  -- `stage_key='agendado'` é a compatibilidade legada.
  SELECT ps.id, ps.stage_key INTO v_stage_id, v_stage_key
  FROM public.pipeline_stages ps
  JOIN public.pipeline_entries pe ON pe.id = v_entry_ab
  WHERE ps.pipeline_id = pe.pipeline_id
    AND (ps.stage_role = 'meeting_booked' OR ps.stage_key = 'agendado')
    AND ps.stage_key IS DISTINCT FROM pe.stage_key
  -- `NULLS LAST` não é detalhe: `DESC` em PostgreSQL é NULLS FIRST por padrão,
  -- e `stage_role` NULL (etapa legada, que só entra aqui por stage_key
  -- 'agendado') ganharia da etapa que declara o papel.
  ORDER BY (ps.stage_role = 'meeting_booked') DESC NULLS LAST
  LIMIT 1;

  IF v_stage_id IS NULL THEN
    RAISE EXCEPTION 'ensaio S6: a fixture do A/B não tem etapa de agendamento para onde mover — os cenários 50–56 ficariam mudos';
  END IF;

  SELECT o.id INTO v_outra_org FROM public.organizations o WHERE o.id <> v_org LIMIT 1;

  INSERT INTO _fx VALUES
    ('org', v_org, 'org do ensaio'),
    ('deal', v_deal, 'negócio alvo do espelho'),
    ('entry', v_entry, 'entrada que recebe a projeção'),
    ('entry_pc', v_entry_pc, 'entrada do controle positivo A (sem carimbo)'),
    ('entry_ab', v_entry_ab, 'entrada EXCLUSIVA do A/B do movimento de etapa'),
    ('deal_ab', v_deal_ab, 'negócio da entrada do A/B'),
    ('outra_org', v_outra_org, 'org divergente'),
    ('etapa_alvo_ab', v_stage_id, v_stage_key);
END;
$fx$;

-- ── ANTES ───────────────────────────────────────────────────────────────────

-- Fotografia FIEL de meeting_events: as colunas de que as três métricas vivem.
CREATE TEMP TABLE _me_antes AS
SELECT id, organization_id, lead_id, event_type, booked_event_id,
       meeting_date, occurred_at, source
FROM public.meeting_events;

INSERT INTO _r SELECT 1, 'antes — linhas em meeting_events', count(*)::text FROM _me_antes;
INSERT INTO _r SELECT 2, 'antes — meeting_events por tipo: ' || event_type, count(*)::text
  FROM _me_antes GROUP BY event_type;
INSERT INTO _r SELECT 3, 'antes — linhas em meetings', count(*)::text FROM public.meetings;
INSERT INTO _r SELECT 4, 'antes — meetings com deal_id', count(*)::text
  FROM public.meetings WHERE deal_id IS NOT NULL;
INSERT INTO _r SELECT 5, 'antes — entradas com metadata.meeting_date', count(*)::text
  FROM public.pipeline_entries WHERE NULLIF(metadata->>'meeting_date','') IS NOT NULL;
INSERT INTO _r SELECT 6, 'antes — entradas com carimbo agenda_espelho (tem de ser 0)', count(*)::text
  FROM public.pipeline_entries WHERE metadata ? 'agenda_espelho';

-- PORTÃO IMEDIATO, e é o único que precisa estourar ANTES do `\i MIGRATION`:
-- carimbo em prod significa que a fatia já foi aplicada, e daí em diante todo
-- número deste arquivo é sobre outro experimento — 11 mediria o backfill de
-- ontem, 16 compararia contra um estado já espelhado, e o ensaio inteiro
-- viraria teatro. Melhor parar aqui do que produzir 51 medidas sem sentido.
DO $prod_virgem$
BEGIN
  IF (SELECT valor FROM _r WHERE ordem = 6 LIMIT 1) <> '0' THEN
    RAISE EXCEPTION 'ensaio S6: prod já tem % entradas carimbadas com agenda_espelho — a fatia já foi aplicada e este ensaio mediria outro experimento',
      (SELECT valor FROM _r WHERE ordem = 6 LIMIT 1);
  END IF;
END;
$prod_virgem$;

-- ── FOTOGRAFIAS QUE SUBSTITUEM OS NÚMEROS CHUMBADOS ─────────────────────────
-- Cada esperado do bloco 10–18 é DERIVADO destas três tabelas. Chumbar 17/151/
-- 793/112/10 dentro do arquivo foi o que produziu o falso vermelho da execução
-- de 2026-09-03 (asserção 16: rótulo dizia 10, base já dava 14, e o 14 estava
-- certo). A base anda todo dia; o predicado, não.

-- Ponteiro de negócio de CADA reunião, para derivar o alcance dos dois
-- backfills sem replicar os predicados deles (replicar predicado é escrever o
-- mesmo bug duas vezes e chamar de conferência).
CREATE TEMP TABLE _mt_antes AS
SELECT id, deal_id, event_type FROM public.meetings;

-- Os pares DIVERGENTES de hoje: entrada que já tem data e cuja data NÃO é a
-- da reunião. São os que o backfill promete não tocar. Guardamos o par E a
-- data, porque o que importa não é a CONTAGEM (que cresce sozinha quando o
-- backfill de `deal_id` faz pares novos passarem a casar no join) e sim que
-- nenhuma destas datas mude.
CREATE TEMP TABLE _div_antes AS
SELECT m.id AS meeting_id, pe.id AS entry_id,
       pe.metadata->>'meeting_date' AS data_do_funil
FROM public.meetings m
JOIN public.pipeline_entries pe
  ON pe.deal_id = m.deal_id AND pe.organization_id = m.organization_id
WHERE m.event_type = 'meeting' AND m.deal_id IS NOT NULL AND m.status <> 'cancelled'
  AND NULLIF(pe.metadata->>'meeting_date','') IS NOT NULL
  AND (pe.metadata->>'meeting_date')::timestamptz <> m.start_at;

-- O alvo EXATO do backfill da projeção: entrada sem data cujo negócio já tem
-- reunião viva. É o conjunto que a asserção 11 tem de reencontrar carimbado.
CREATE TEMP TABLE _proj_alvo_antes AS
SELECT DISTINCT pe.id AS entry_id
FROM public.meetings m
JOIN public.pipeline_entries pe
  ON pe.deal_id = m.deal_id AND pe.organization_id = m.organization_id
WHERE m.event_type = 'meeting' AND m.deal_id IS NOT NULL AND m.status <> 'cancelled'
  AND NULLIF(pe.metadata->>'meeting_date','') IS NULL;

INSERT INTO _r SELECT 8, 'antes — pares divergentes funil×agenda (a base do 16)', count(*)::text
  FROM _div_antes;
INSERT INTO _r SELECT 9, 'antes — entradas no alvo do backfill da projeção (a base do 11)', count(*)::text
  FROM _proj_alvo_antes;

-- INVARIANTE, medida na fonte que o produto realmente lê. Meses FECHADOS.
CREATE TEMP TABLE _dm_antes AS
SELECT mes,
       (m->>'reunioesMarcadas')::int      AS marcadas,
       (m->>'reunioesComparecidas')::int  AS compareceu,
       (m->>'noShow')::int                AS no_show
FROM (
  SELECT d::date AS mes,
         (public.get_dashboard_metrics(
            (SELECT v FROM _fx WHERE chave='org'),
            d, (d + interval '1 month' - interval '1 second'), NULL))::jsonb AS m
  FROM generate_series('2026-05-01'::timestamptz, '2026-08-01'::timestamptz, interval '1 month') d
) x;

INSERT INTO _r SELECT 7, 'antes — get_dashboard_metrics ' || mes::text,
  format('marcadas=%s compareceu=%s noShow=%s', marcadas, compareceu, no_show)
  FROM _dm_antes;

-- ── APLICA ──────────────────────────────────────────────────────────────────

\i MIGRATION

-- ── DEPOIS DA MIGRATION, ANTES DOS CENÁRIOS ─────────────────────────────────

-- Delta como NÚMERO, não como 'X vs Y': o veredito precisa comparar, e string
-- de duas contagens não se compara — foi por isso que esta linha nunca foi
-- portão apesar do rótulo dizer "tem de ser 0".
INSERT INTO _r SELECT 10, 'migration — delta de linhas em meeting_events (tem de ser 0)',
  ((SELECT count(*) FROM public.meeting_events) - (SELECT count(*) FROM _me_antes))::text;

-- 11. DERIVADO de _proj_alvo_antes, e por CONJUNTO, não por contagem: duas
--     contagens iguais podem descrever conjuntos diferentes (uma entrada a
--     mais carimbada e outra a menos zeram na soma).
INSERT INTO _r SELECT 11, 'migration — entradas carimbadas fora do alvo medido antes (tem de ser 0)',
  ((SELECT count(*) FROM public.pipeline_entries pe
     WHERE pe.metadata ? 'agenda_espelho'
       AND NOT EXISTS (SELECT 1 FROM _proj_alvo_antes a WHERE a.entry_id = pe.id))
   +
   (SELECT count(*) FROM _proj_alvo_antes a
     WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_entries pe
                        WHERE pe.id = a.entry_id AND pe.metadata ? 'agenda_espelho')))::text;

INSERT INTO _r SELECT 11, 'medida — entradas que ganharam meeting_date (alvo derivado, ver 9)', count(*)::text
  FROM public.pipeline_entries pe WHERE pe.metadata ? 'agenda_espelho';

-- 12/13. DERIVADOS de _mt_antes. O esperado é "antes ± o que o livro registra",
--        nunca 793/112: aquelas constantes eram a foto de 2026-09-03 e o app
--        escreve `deal_id` todo dia pelo picker e pelo meeting-webhook.
INSERT INTO _r SELECT 12, 'migration — meetings com deal_id ≠ (antes + linhas do livro) (tem de ser 0)',
  ((SELECT count(*) FROM public.meetings WHERE deal_id IS NOT NULL)
   - (SELECT count(*) FROM _mt_antes WHERE deal_id IS NOT NULL)
   - (SELECT count(*) FROM backup.meetings_deal_id_s6_20270928))::text;

INSERT INTO _r SELECT 13, 'migration — meetings tipo meeting sem deal_id ≠ (antes − livro) (tem de ser 0)',
  ((SELECT count(*) FROM public.meetings WHERE deal_id IS NULL AND event_type = 'meeting')
   - (SELECT count(*) FROM _mt_antes WHERE deal_id IS NULL AND event_type = 'meeting')
   + (SELECT count(*) FROM backup.meetings_deal_id_s6_20270928))::text;

INSERT INTO _r SELECT 13, 'medida — meetings tipo meeting ainda sem deal_id', count(*)::text
  FROM public.meetings WHERE deal_id IS NULL AND event_type = 'meeting';

INSERT INTO _r SELECT 14, 'migration — trigger do espelho existe (tem de ser 1)', count(*)::text
  FROM pg_trigger WHERE tgname = 'trg_meeting_espelha_no_funil' AND NOT tgisinternal;

INSERT INTO _r SELECT 15, 'migration — guarda do carimbo presente em fn_capture_meeting_event (tem de ser true)', (
  SELECT (pg_get_functiondef(oid) LIKE '%agenda_espelho%')::text
  FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_capture_meeting_event');

-- O LIVRO DA PROCEDÊNCIA tem de conter exatamente os ponteiros escritos. Sem
-- ele o rollback não tem como desfazer só o que a migration fez — `created_at`
-- NÃO separa (145 das 151 alvo nasceram no instante do backfill do S3/S4).
-- DERIVADO por conjunto contra _mt_antes: o livro tem de ser EXATAMENTE as
-- reuniões cujo `deal_id` foi de NULL a não-NULL nesta transação. Contagem
-- chumbada (151) provaria só que o número não mudou; isto prova a identidade.
INSERT INTO _r SELECT 17, 'migration — livro ≠ conjunto que ganhou ponteiro nesta transação (tem de ser 0)',
  ((SELECT count(*) FROM backup.meetings_deal_id_s6_20270928 b
     WHERE NOT EXISTS (SELECT 1 FROM _mt_antes a JOIN public.meetings m ON m.id = a.id
                        WHERE a.id = b.meeting_id
                          AND a.deal_id IS NULL AND m.deal_id IS NOT NULL))
   +
   (SELECT count(*) FROM _mt_antes a JOIN public.meetings m ON m.id = a.id
     WHERE a.deal_id IS NULL AND m.deal_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM backup.meetings_deal_id_s6_20270928 b
                        WHERE b.meeting_id = a.id)))::text;

INSERT INTO _r SELECT 17, 'medida — linhas no livro backup.meetings_deal_id_s6_20270928', count(*)::text
  FROM backup.meetings_deal_id_s6_20270928;

INSERT INTO _r SELECT 18, 'migration — todo ponteiro do livro bate com o meetings.deal_id atual (tem de ser 0 divergências)', count(*)::text
  FROM backup.meetings_deal_id_s6_20270928 b
  JOIN public.meetings m ON m.id = b.meeting_id
 WHERE m.deal_id IS DISTINCT FROM b.deal_id_escrito;

-- ── 16. DIVERGENTES PRESERVADAS — DERIVADO, não chumbado ────────────────────
-- O rótulo antigo dizia "tem de ser 10" e a execução de 2026-09-03 deu 14. O
-- 14 estava CERTO: o backfill de `meetings.deal_id` (passo 4) liga ponteiros
-- que antes eram NULL, e pares (reunião, entrada) que não casavam no join
-- passam a casar — alguns deles já divergentes. Preservar divergente é o
-- comportamento desejado; a CONTAGEM é que não é invariante.
--
-- O invariante de verdade tem duas metades, e as duas são portão:
--   16a  nenhuma divergente de ANTES pode ter sido tocada — nem a data
--        reescrita, nem carimbo posto nela. É a promessa "as divergentes ficam
--        intocadas" medida por par, não por total.
--   16b  toda divergente NOVA tem de ter nascido do livro, isto é, de uma
--        reunião cujo ponteiro esta migration acabou de escrever. Divergente
--        nova numa reunião que JÁ apontava para o negócio antes significaria
--        que alguma data mudou — e aí não é efeito de join, é escrita.
INSERT INTO _r SELECT 16, 'migration — divergentes de antes tocadas pelo backfill (tem de ser 0)',
  (SELECT count(*)::text
     FROM _div_antes d
     JOIN public.pipeline_entries pe ON pe.id = d.entry_id
    WHERE pe.metadata->>'meeting_date' IS DISTINCT FROM d.data_do_funil
       OR pe.metadata ? 'agenda_espelho');

INSERT INTO _r SELECT 16, 'migration — divergentes novas sem origem no livro (tem de ser 0)',
  (SELECT count(*)::text
     FROM public.meetings m
     JOIN public.pipeline_entries pe
       ON pe.deal_id = m.deal_id AND pe.organization_id = m.organization_id
    WHERE m.event_type='meeting' AND m.deal_id IS NOT NULL AND m.status <> 'cancelled'
      AND NULLIF(pe.metadata->>'meeting_date','') IS NOT NULL
      AND (pe.metadata->>'meeting_date')::timestamptz <> m.start_at
      AND NOT EXISTS (SELECT 1 FROM _div_antes d
                       WHERE d.meeting_id = m.id AND d.entry_id = pe.id)
      AND NOT EXISTS (SELECT 1 FROM backup.meetings_deal_id_s6_20270928 b
                       WHERE b.meeting_id = m.id));

INSERT INTO _r SELECT 16, 'medida — pares divergentes depois (cresce pelo backfill de deal_id; ver 8)',
  (SELECT count(*)::text
     FROM public.meetings m
     JOIN public.pipeline_entries pe
       ON pe.deal_id = m.deal_id AND pe.organization_id = m.organization_id
    WHERE m.event_type='meeting' AND m.deal_id IS NOT NULL AND m.status <> 'cancelled'
      AND NULLIF(pe.metadata->>'meeting_date','') IS NOT NULL
      AND (pe.metadata->>'meeting_date')::timestamptz <> m.start_at);

-- ── CENÁRIOS DO ESPELHO (isolados: reunião SEM lead) ────────────────────────

DO $cenarios$
DECLARE
  v_deal uuid := (SELECT v FROM _fx WHERE chave='deal');
  v_org  uuid := (SELECT v FROM _fx WHERE chave='org');
  v_entry uuid := (SELECT v FROM _fx WHERE chave='entry');
  v_m   uuid;
  v_m2  uuid;
  v_base timestamptz := date_trunc('hour', now()) + interval '10 days';
BEGIN
  -- 20. INSERT com deal_id → projeta.
  INSERT INTO public.meetings
    (organization_id, title, start_at, end_at, all_day, event_type, status, deal_id, meet_link)
  VALUES
    (v_org, 'ENSAIO S6 — reunião', v_base, v_base + interval '1 hour', false, 'meeting', 'scheduled',
     v_deal, 'https://meet.exemplo/ensaio-s6')
  RETURNING id INTO v_m;

  INSERT INTO _r SELECT 20, 'cenário — INSERT projetou meeting_date',
    (SELECT ((pe.metadata->>'meeting_date')::timestamptz = v_base)::text
       FROM public.pipeline_entries pe WHERE pe.id = v_entry);
  INSERT INTO _r SELECT 20, 'cenário — INSERT projetou meet_link',
    (SELECT (pe.metadata->>'meet_link' = 'https://meet.exemplo/ensaio-s6')::text
       FROM public.pipeline_entries pe WHERE pe.id = v_entry);
  INSERT INTO _r SELECT 20, 'cenário — INSERT carimbou meeting_id',
    (SELECT (pe.metadata->'agenda_espelho'->>'meeting_id' = v_m::text)::text
       FROM public.pipeline_entries pe WHERE pe.id = v_entry);

  -- 21. REMARCAÇÃO dentro de 30 dias.
  UPDATE public.meetings SET start_at = v_base + interval '5 days',
                             end_at   = v_base + interval '5 days 1 hour'
   WHERE id = v_m;
  INSERT INTO _r SELECT 21, 'cenário — remarcação ≤30d reescreveu a data',
    (SELECT ((pe.metadata->>'meeting_date')::timestamptz = v_base + interval '5 days')::text
       FROM public.pipeline_entries pe WHERE pe.id = v_entry);

  -- 22. REMARCAÇÃO além de 60 dias — HOJE este é o caminho que INSERE
  --     'pipeline:<slug>:reschedule' (prod já tem 10 linhas assim).
  UPDATE public.meetings SET start_at = v_base + interval '75 days',
                             end_at   = v_base + interval '75 days 1 hour'
   WHERE id = v_m;
  INSERT INTO _r SELECT 22, 'cenário — remarcação >60d reescreveu a data',
    (SELECT ((pe.metadata->>'meeting_date')::timestamptz = v_base + interval '75 days')::text
       FROM public.pipeline_entries pe WHERE pe.id = v_entry);

  -- 23. DESFECHO: mantém a data, só renova o carimbo.
  UPDATE public.meetings SET status = 'completed' WHERE id = v_m;
  INSERT INTO _r SELECT 23, 'cenário — completed MANTEVE a data',
    (SELECT ((pe.metadata->>'meeting_date')::timestamptz = v_base + interval '75 days')::text
       FROM public.pipeline_entries pe WHERE pe.id = v_entry);

  -- 24. LIMPEZA por carimbo de OUTRA reunião: não pode mexer.
  INSERT INTO public.meetings
    (organization_id, title, start_at, end_at, all_day, event_type, status, deal_id)
  VALUES (v_org, 'ENSAIO S6 — segunda reunião', v_base + interval '100 days',
          v_base + interval '100 days 1 hour', false, 'meeting', 'scheduled', v_deal)
  RETURNING id INTO v_m2;
  -- A segunda reunião reprojetou e o carimbo passou a ser dela. Apagar a
  -- PRIMEIRA agora não pode limpar nada.
  DELETE FROM public.meetings WHERE id = v_m;
  INSERT INTO _r SELECT 24, 'cenário — DELETE com carimbo alheio NÃO limpou',
    (SELECT ((pe.metadata->>'meeting_date')::timestamptz = v_base + interval '100 days'
             AND pe.metadata->'agenda_espelho'->>'meeting_id' = v_m2::text)::text
       FROM public.pipeline_entries pe WHERE pe.id = v_entry);

  -- 25. DELETE da dona do carimbo: aí sim limpa as três chaves.
  DELETE FROM public.meetings WHERE id = v_m2;
  INSERT INTO _r SELECT 25, 'cenário — DELETE da dona limpou meeting_date',
    (SELECT (NOT (pe.metadata ? 'meeting_date'))::text
       FROM public.pipeline_entries pe WHERE pe.id = v_entry);
  INSERT INTO _r SELECT 25, 'cenário — DELETE da dona limpou o carimbo',
    (SELECT (NOT (pe.metadata ? 'agenda_espelho'))::text
       FROM public.pipeline_entries pe WHERE pe.id = v_entry);

  -- 26. PORTAS DE SAÍDA. Comparadas contra o metadata EXATO de antes de cada
  --     inserção — não contra "não tem meeting_date". Depois do passo 25 a
  --     entrada está limpa, e "continua limpa" seria verde por ausência: passa
  --     igual se o espelho estivesse desligado. O que precisa ser provado é que
  --     NADA no metadata mudou.
  DECLARE
    v_snap jsonb;
  BEGIN
    SELECT metadata INTO v_snap FROM public.pipeline_entries WHERE id = v_entry;

    INSERT INTO public.meetings
      (organization_id, title, start_at, end_at, all_day, event_type, status, deal_id, meet_link)
    VALUES (v_org, 'ENSAIO S6 — ligação', v_base, v_base + interval '30 minutes', false,
            'call', 'scheduled', v_deal, 'https://meet.exemplo/nao-deveria-entrar');
    INSERT INTO _r SELECT 26, 'porta — event_type=call deixou o metadata intacto',
      (SELECT (pe.metadata IS NOT DISTINCT FROM v_snap)::text
         FROM public.pipeline_entries pe WHERE pe.id = v_entry);

    INSERT INTO public.meetings
      (organization_id, title, start_at, end_at, all_day, event_type, status, deal_id, meet_link)
    VALUES ((SELECT v FROM _fx WHERE chave='outra_org'), 'ENSAIO S6 — org errada',
            v_base, v_base + interval '1 hour', false, 'meeting', 'scheduled', v_deal,
            'https://meet.exemplo/nao-deveria-entrar');
    INSERT INTO _r SELECT 26, 'porta — org divergente deixou o metadata intacto (e não estourou)',
      (SELECT (pe.metadata IS NOT DISTINCT FROM v_snap)::text
         FROM public.pipeline_entries pe WHERE pe.id = v_entry);

    INSERT INTO public.meetings
      (organization_id, title, start_at, end_at, all_day, event_type, status, deal_id, meet_link)
    VALUES (v_org, 'ENSAIO S6 — sem negócio', v_base, v_base + interval '1 hour', false,
            'meeting', 'scheduled', NULL, 'https://meet.exemplo/nao-deveria-entrar');
    INSERT INTO _r SELECT 26, 'porta — deal_id NULL deixou o metadata intacto',
      (SELECT (pe.metadata IS NOT DISTINCT FROM v_snap)::text
         FROM public.pipeline_entries pe WHERE pe.id = v_entry);
  END;

  -- 27. CONTRAPROVA DA PORTA: a MESMA inserção, agora como 'meeting' na org
  --     certa e com negócio, TEM de projetar. Sem isto, os três `true` acima
  --     também passariam com o trigger desligado.
  DECLARE
    v_m3 uuid;
  BEGIN
    INSERT INTO public.meetings
      (organization_id, title, start_at, end_at, all_day, event_type, status, deal_id)
    VALUES (v_org, 'ENSAIO S6 — contraprova', v_base + interval '200 days',
            v_base + interval '200 days 1 hour', false, 'meeting', 'scheduled', v_deal)
    RETURNING id INTO v_m3;

    INSERT INTO _r SELECT 27, 'contraprova — a porta aberta PROJETA (senão 26 é verde por ausência)',
      (SELECT ((pe.metadata->>'meeting_date')::timestamptz = v_base + interval '200 days')::text
         FROM public.pipeline_entries pe WHERE pe.id = v_entry);
  END;
END;
$cenarios$;

-- ── A INVARIANTE, LINHA A LINHA ─────────────────────────────────────────────
-- Os cenários 20–26 rodaram TODOS sem lead na reunião. Portanto o único
-- escritor possível de meeting_events ali seria fn_capture_meeting_event
-- acordada pelo espelho — que é o que o guarda tem de suprimir.

INSERT INTO _r SELECT 30, 'INVARIANTE — linhas de meeting_events criadas pelo espelho (tem de ser 0)',
  (SELECT count(*)::text FROM public.meeting_events me
    WHERE NOT EXISTS (SELECT 1 FROM _me_antes a WHERE a.id = me.id));

INSERT INTO _r SELECT 31, 'INVARIANTE — linhas de meeting_events sumidas (tem de ser 0)',
  (SELECT count(*)::text FROM _me_antes a
    WHERE NOT EXISTS (SELECT 1 FROM public.meeting_events me WHERE me.id = a.id));

-- A que contagem de linhas NÃO pega.
INSERT INTO _r SELECT 32, 'INVARIANTE REFORÇADA — meeting_date alteradas (tem de ser 0)',
  (SELECT count(*)::text
     FROM _me_antes a JOIN public.meeting_events me ON me.id = a.id
    WHERE me.meeting_date IS DISTINCT FROM a.meeting_date);

INSERT INTO _r SELECT 33, 'INVARIANTE REFORÇADA — occurred_at/booked_event_id alterados (tem de ser 0)',
  (SELECT count(*)::text
     FROM _me_antes a JOIN public.meeting_events me ON me.id = a.id
    WHERE me.occurred_at    IS DISTINCT FROM a.occurred_at
       OR me.booked_event_id IS DISTINCT FROM a.booked_event_id
       OR me.event_type      IS DISTINCT FROM a.event_type);

-- ── A INVARIANTE, PELA PORTA DO PRODUTO ─────────────────────────────────────

CREATE TEMP TABLE _dm_depois AS
SELECT mes,
       (m->>'reunioesMarcadas')::int     AS marcadas,
       (m->>'reunioesComparecidas')::int AS compareceu,
       (m->>'noShow')::int               AS no_show
FROM (
  SELECT d::date AS mes,
         (public.get_dashboard_metrics(
            (SELECT v FROM _fx WHERE chave='org'),
            d, (d + interval '1 month' - interval '1 second'), NULL))::jsonb AS m
  FROM generate_series('2026-05-01'::timestamptz, '2026-08-01'::timestamptz, interval '1 month') d
) x;

INSERT INTO _r SELECT 34, 'INVARIANTE — meses com divergência em get_dashboard_metrics (tem de ser 0)',
  (SELECT count(*)::text FROM _dm_antes a JOIN _dm_depois d USING (mes)
    WHERE a.marcadas   IS DISTINCT FROM d.marcadas
       OR a.compareceu IS DISTINCT FROM d.compareceu
       OR a.no_show    IS DISTINCT FROM d.no_show);

INSERT INTO _r SELECT 35, 'depois — get_dashboard_metrics ' || mes::text,
  format('marcadas=%s compareceu=%s noShow=%s', marcadas, compareceu, no_show)
  FROM _dm_depois;

-- ── CONTROLE POSITIVO A — entrada SEM carimbo ───────────────────────────────
-- Sem este passo, todo o verde acima só provaria que nada rodou.
-- Uma edição HUMANA numa entrada que o espelho NUNCA tocou TEM de continuar
-- produzindo o efeito que produz hoje em meeting_events.
-- ⚠ Este controle sozinho NÃO sustenta o guarda: ele exercita o caso em que o
--   carimbo não existe. A premissa do guarda é sobre carimbo PRESERVADO — é o
--   controle B, logo abaixo, que a exercita.

CREATE TEMP TABLE _me_pre_controle AS
SELECT id, meeting_date FROM public.meeting_events;

DO $controle$
DECLARE
  v_entry uuid := (SELECT v FROM _fx WHERE chave='entry_pc');
  v_nova  timestamptz;
BEGIN
  SELECT (metadata->>'meeting_date')::timestamptz + interval '90 days'
    INTO v_nova FROM public.pipeline_entries WHERE id = v_entry;

  -- Exatamente a forma dos escritores do funil: `metadata || jsonb_build_object`.
  -- 90 dias de salto força o ramo que HOJE insere 'pipeline:<slug>:reschedule'.
  UPDATE public.pipeline_entries
     SET metadata = metadata || jsonb_build_object('meeting_date', v_nova)
   WHERE id = v_entry;
END;
$controle$;

INSERT INTO _r SELECT 40, 'CONTROLE POSITIVO A — edição humana ainda mexe em meeting_events (tem de ser > 0)',
  (SELECT (
     (SELECT count(*) FROM public.meeting_events me
       WHERE NOT EXISTS (SELECT 1 FROM _me_pre_controle p WHERE p.id = me.id))
     +
     (SELECT count(*) FROM _me_pre_controle p JOIN public.meeting_events me ON me.id = p.id
       WHERE me.meeting_date IS DISTINCT FROM p.meeting_date)
   )::text);

INSERT INTO _r SELECT 41, 'CONTROLE POSITIVO A — a linha nova é pipeline:*, não agenda:*',
  (SELECT COALESCE(string_agg(DISTINCT me.source, ', '), '(nenhuma linha nova — ver 40)')
     FROM public.meeting_events me
    WHERE NOT EXISTS (SELECT 1 FROM _me_pre_controle p WHERE p.id = me.id));

-- ── CONTROLE POSITIVO B — entrada COM carimbo ───────────────────────────────
-- É ESTE o passo que sustenta o guarda inteiro.
--
-- O guarda sai calado quando o `rev` MUDOU. Ele só é seguro porque os dois
-- escritores humanos do lado funil (`pipe_confirmacao_update_fn` e
-- `useSetMeetingDate`) fazem `metadata || jsonb_build_object(...)`, ou seja
-- PRESERVAM o carimbo — e por isso continuam sendo capturados. Se essa
-- premissa fosse falsa, toda entrada já espelhada pararia de emitir evento na
-- primeira edição pelo card, e a métrica MINGUARIA em silêncio.
--
-- A entrada usada aqui é a `entry`: depois do cenário 27 ela está carimbada e
-- projetada. A edição imita exatamente a forma do `MeetingFieldBlock`.
CREATE TEMP TABLE _me_pre_controle_b AS
SELECT id, meeting_date FROM public.meeting_events;

DO $controle_b$
DECLARE
  v_entry uuid := (SELECT v FROM _fx WHERE chave='entry');
  v_rev_antes text;
  v_nova timestamptz;
BEGIN
  SELECT metadata->'agenda_espelho'->>'rev',
         (metadata->>'meeting_date')::timestamptz + interval '90 days'
    INTO v_rev_antes, v_nova
    FROM public.pipeline_entries WHERE id = v_entry;

  IF v_rev_antes IS NULL THEN
    RAISE EXCEPTION 'ensaio S6: a entrada do controle B chegou SEM carimbo — o passo provaria a mesma coisa que o controle A e o guarda ficaria sem prova';
  END IF;

  UPDATE public.pipeline_entries
     SET metadata = metadata || jsonb_build_object('meeting_date', v_nova)
   WHERE id = v_entry;

  INSERT INTO _r VALUES (43, 'CONTROLE POSITIVO B — a edição humana PRESERVOU o carimbo (premissa do guarda)',
    (SELECT (metadata->'agenda_espelho'->>'rev' = v_rev_antes)::text
       FROM public.pipeline_entries WHERE id = v_entry));
END;
$controle_b$;

INSERT INTO _r SELECT 42, 'CONTROLE POSITIVO B — entrada CARIMBADA ainda mexe em meeting_events (tem de ser > 0)',
  (SELECT (
     (SELECT count(*) FROM public.meeting_events me
       WHERE NOT EXISTS (SELECT 1 FROM _me_pre_controle_b p WHERE p.id = me.id))
     +
     (SELECT count(*) FROM _me_pre_controle_b p JOIN public.meeting_events me ON me.id = p.id
       WHERE me.meeting_date IS DISTINCT FROM p.meeting_date)
   )::text);

-- ── 50–56. A/B DO MOVIMENTO HUMANO DE ETAPA ─────────────────────────────────
-- A única via que o guarda NÃO suprime, e por isso a única que precisa ser
-- MEDIDA em vez de argumentada: mover o card depois de o espelho ter projetado
-- é escrita humana — o `rev` não muda e `fn_capture_meeting_event` roda
-- inteira, como roda hoje. O que mudou é que agora ela pode encontrar no
-- metadata uma `meeting_date` que o espelho pôs, e o ramo BOOKED decide
-- INSERT vs UPDATE olhando a distância de 30 dias entre essa data e a do
-- agendamento aberto.
--
-- Os dois braços rodam sobre a MESMA entrada e o MESMO lead — o braço A com a
-- projeção, o braço B com ela removida (o estado de hoje). Entradas diferentes
-- não compararia nada: `v_prev` é buscado POR LEAD.
--
-- …mas a entrada é a `entry_ab`, EXCLUSIVA deste passo, e não a `entry` dos
-- cenários do espelho. Ver a nota do cabeçalho: o CONTROLE POSITIVO B roda na
-- `entry` e deixa o `v_prev` do lead com a data já igual à projetada, o que
-- força os dois braços para o mesmo galho (UPDATE com o mesmo valor) e faz o
-- A/B medir 0/0/0 — foi o resultado de 2026-09-03, e é zero por falta de
-- decisão, não por acerto.
--
-- A PROJEÇÃO DO BRAÇO A É FEITA PELO CAMINHO REAL: inserimos uma reunião e
-- deixamos `trg_meeting_espelha_no_funil` projetar e carimbar. Escrever o
-- metadata na mão produziria um estado que a produção nunca produz (e mudaria
-- o `rev` por fora, acionando o guarda).
--
-- A DATA da reunião é DERIVADA da âncora do lead — `v_prev.meeting_date` mais
-- 400 dias — e não uma constante: o que dá conteúdo ao braço A é a distância
-- passar dos 30 dias que o ramo BOOKED usa para decidir INSERT vs UPDATE. Data
-- fixa poderia cair, num lead qualquer, dentro da janela, e o braço voltaria a
-- medir zero.
--
-- O braço A roda dentro de um subbloco ABORTADO de propósito: o `RAISE` desfaz
-- o movimento e as linhas que ele criar, e a medida volta pela MENSAGEM. É o
-- que permite rodar os dois braços do mesmo estado inicial.
CREATE TEMP TABLE _me_pre_ab AS
SELECT id, event_type, meeting_date FROM public.meeting_events;

DO $ab$
DECLARE
  v_org       uuid := (SELECT v FROM _fx WHERE chave='org');
  v_entry     uuid := (SELECT v FROM _fx WHERE chave='entry_ab');
  v_deal      uuid := (SELECT v FROM _fx WHERE chave='deal_ab');
  v_stage_id  uuid := (SELECT v FROM _fx WHERE chave='etapa_alvo_ab');
  v_stage_key text := (SELECT t FROM _fx WHERE chave='etapa_alvo_ab');
  v_lead      uuid;
  v_m         uuid;
  v_proj      timestamptz;
  v_prev      public.meeting_events%ROWTYPE;
  v_prev_open boolean;
  v_dist_dias numeric;
  v_projecao_eventos int;
  v_msg text;
  v_com_booked int; v_com_held int; v_com_alteradas int;
  v_sem_booked int; v_sem_held int; v_sem_alteradas int;
  v_limpeza_eventos int;
BEGIN
  SELECT pe.lead_id INTO v_lead FROM public.pipeline_entries pe WHERE pe.id = v_entry;

  -- `v_prev` buscado EXATAMENTE como fn_capture_meeting_event o busca
  -- (lead + org + meeting_booked, occurred_at DESC, LIMIT 1). Replicar a
  -- consulta é o ponto: a pré-condição precisa falar da mesma linha que a
  -- função vai encontrar, não de "algum agendamento aberto do lead".
  SELECT * INTO v_prev FROM public.meeting_events me
   WHERE me.lead_id = v_lead
     AND me.organization_id = v_org
     AND me.event_type = 'meeting_booked'
   ORDER BY me.occurred_at DESC
   LIMIT 1;

  v_prev_open := v_prev.id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.meeting_events h
     WHERE h.event_type = 'meeting_held' AND h.booked_event_id = v_prev.id);

  -- ── 54. PRÉ-CONDIÇÃO DO BRAÇO A — portão, não medida ─────────────────────
  -- Estoura no PONTO, e não no veredito do fim, porque depois daqui todo zero
  -- do A/B fica ambíguo: zero por falta de alvo tem exatamente a mesma cara de
  -- zero por acerto. Foi essa ambiguidade que deixou a asserção 52 passar
  -- sobre 0/0/0 em 2026-09-03.
  --
  -- As duas primeiras metades vêm ANTES de montar a reunião, de propósito: se
  -- `v_prev.meeting_date` for NULL, `v_proj` sai NULL e o INSERT em `meetings`
  -- morreria num NOT NULL de coluna — mensagem que não explica nada a quem
  -- está lendo o resultado do ensaio às 3 da manhã.
  IF NOT v_prev_open THEN
    RAISE EXCEPTION 'ensaio S6: o braço A começaria sem `meeting_booked` ABERTO no lead % — sem v_prev_open o ramo RESCHEDULE não tem como fazer mal e o A/B passaria mesmo com o guarda removido', v_lead;
  END IF;

  IF v_prev.meeting_date IS NULL THEN
    RAISE EXCEPTION 'ensaio S6: o agendamento aberto do lead % está sem meeting_date — o ramo BOOKED cairia no UPDATE por v_prev.meeting_date IS NULL e a decisão de fronteira (30 dias) não seria exercida', v_lead;
  END IF;

  -- A data projetada é DERIVADA da âncora, não constante: o que dá conteúdo ao
  -- braço A é passar dos 30 dias que o ramo BOOKED usa para decidir INSERT vs
  -- UPDATE. 400 dias deixa folga para qualquer âncora.
  v_proj := v_prev.meeting_date + interval '400 days';
  v_dist_dias := round(abs(EXTRACT(EPOCH FROM (v_proj - v_prev.meeting_date))) / 86400.0, 1);

  IF v_dist_dias <= 30 THEN
    RAISE EXCEPTION 'ensaio S6: a data projetada ficaria a % dias do agendamento aberto (≤30) — o braço A cairia no UPDATE-com-o-mesmo-valor e mediria zero sem exercitar decisão nenhuma', v_dist_dias;
  END IF;

  -- A reunião que o espelho vai projetar. Sem `lead_id`, como todos os
  -- cenários: `fn_meeting_outcome_to_events` sai na porta `lead_id IS NULL`,
  -- então qualquer linha em `meeting_events` a partir daqui é atribuível ao
  -- caminho funil e a mais nada.
  INSERT INTO public.meetings
    (organization_id, title, start_at, end_at, all_day, event_type, status, deal_id)
  VALUES (v_org, 'ENSAIO S6 — A/B movimento de etapa', v_proj, v_proj + interval '1 hour',
          false, 'meeting', 'scheduled', v_deal)
  RETURNING id INTO v_m;

  -- 55. Projetar (rev NULL → X) é escrita do espelho: o guarda tem de calá-la.
  --     Mesma prova que 30 dá para a `entry`, aqui para a fixture do A/B — e
  --     de quebra separa "o braço A não gerou evento" de "a montagem gerou".
  v_projecao_eventos :=
    (SELECT count(*) FROM public.meeting_events me
      WHERE NOT EXISTS (SELECT 1 FROM _me_pre_ab p WHERE p.id = me.id))
    +
    (SELECT count(*) FROM _me_pre_ab p JOIN public.meeting_events me ON me.id = p.id
      WHERE me.meeting_date IS DISTINCT FROM p.meeting_date);

  INSERT INTO _r VALUES (55,
    'A/B — projetar no funil não gerou evento (o guarda cala o espelho; tem de ser 0)',
    v_projecao_eventos::text);

  -- A terceira metade só pode ser medida DEPOIS: é o trigger real que projeta
  -- e carimba, e é justamente isso que o braço A precisa encontrar de pé.
  IF NOT EXISTS (
    SELECT 1 FROM public.pipeline_entries pe
     WHERE pe.id = v_entry
       AND (pe.metadata->>'meeting_date')::timestamptz = v_proj
       AND pe.metadata->'agenda_espelho'->>'meeting_id' = v_m::text)
  THEN
    RAISE EXCEPTION 'ensaio S6: o braço A começaria SEM projeção/carimbo na entrada % (o espelho não projetou a reunião %) — zero medido aí seria zero por falta de alvo', v_entry, v_m;
  END IF;

  INSERT INTO _r VALUES (54,
    format('A/B — PRÉ-CONDIÇÃO do braço A: projeção + carimbo na entrada, v_prev aberto e a %s dias da data projetada (>30, logo o ramo BOOKED decide de verdade)', v_dist_dias),
    'true');

  -- Linha de base do braço A: o que existe AGORA, já com a projeção montada.
  DELETE FROM _me_pre_ab;
  INSERT INTO _me_pre_ab SELECT id, event_type, meeting_date FROM public.meeting_events;

  -- ── BRAÇO A: como o espelho deixou (meeting_date projetada + carimbo) ─────
  BEGIN
    UPDATE public.pipeline_entries
       SET stage_key = v_stage_key, stage_id = v_stage_id
     WHERE id = v_entry;

    RAISE EXCEPTION 'S6_AB|%|%|%',
      (SELECT count(*) FROM public.meeting_events me
        WHERE me.event_type = 'meeting_booked'
          AND NOT EXISTS (SELECT 1 FROM _me_pre_ab p WHERE p.id = me.id)),
      (SELECT count(*) FROM public.meeting_events me
        WHERE me.event_type = 'meeting_held'
          AND NOT EXISTS (SELECT 1 FROM _me_pre_ab p WHERE p.id = me.id)),
      (SELECT count(*) FROM _me_pre_ab p JOIN public.meeting_events me ON me.id = p.id
        WHERE me.meeting_date IS DISTINCT FROM p.meeting_date);
  EXCEPTION WHEN raise_exception THEN
    v_msg := SQLERRM;
    -- Erro de VERDADE (uma trava do funil, por exemplo) também é P0001 e NÃO
    -- pode virar medida: re-levanta em vez de contar zero e passar.
    IF v_msg NOT LIKE 'S6\_AB|%' THEN RAISE; END IF;
    v_com_booked    := split_part(v_msg, '|', 2)::int;
    v_com_held      := split_part(v_msg, '|', 3)::int;
    v_com_alteradas := split_part(v_msg, '|', 4)::int;
  END;

  -- ── Preparo do braço B: tira a projeção ───────────────────────────────────
  -- Esta remoção MUDA o `rev` (vai a NULL) → o guarda suprime
  -- fn_capture_meeting_event, então preparar o braço B não contamina a medida.
  -- É a mesma remoção que `fn_espelho_limpa_projecao` faz, e por isso serve de
  -- prova extra: 53 confere que ela não gerou evento nenhum.
  UPDATE public.pipeline_entries
     SET metadata = metadata - 'meeting_date' - 'agenda_espelho'
   WHERE id = v_entry;

  v_limpeza_eventos :=
    (SELECT count(*) FROM public.meeting_events me
      WHERE NOT EXISTS (SELECT 1 FROM _me_pre_ab p WHERE p.id = me.id))
    +
    (SELECT count(*) FROM _me_pre_ab p JOIN public.meeting_events me ON me.id = p.id
      WHERE me.meeting_date IS DISTINCT FROM p.meeting_date);

  -- Linha de base nova para o braço B: o que existe AGORA.
  DELETE FROM _me_pre_ab;
  INSERT INTO _me_pre_ab SELECT id, event_type, meeting_date FROM public.meeting_events;

  -- ── BRAÇO B: o estado de hoje (sem data no metadata) ─────────────────────
  BEGIN
    UPDATE public.pipeline_entries
       SET stage_key = v_stage_key, stage_id = v_stage_id
     WHERE id = v_entry;

    RAISE EXCEPTION 'S6_AB|%|%|%',
      (SELECT count(*) FROM public.meeting_events me
        WHERE me.event_type = 'meeting_booked'
          AND NOT EXISTS (SELECT 1 FROM _me_pre_ab p WHERE p.id = me.id)),
      (SELECT count(*) FROM public.meeting_events me
        WHERE me.event_type = 'meeting_held'
          AND NOT EXISTS (SELECT 1 FROM _me_pre_ab p WHERE p.id = me.id)),
      (SELECT count(*) FROM _me_pre_ab p JOIN public.meeting_events me ON me.id = p.id
        WHERE me.meeting_date IS DISTINCT FROM p.meeting_date);
  EXCEPTION WHEN raise_exception THEN
    v_msg := SQLERRM;
    IF v_msg NOT LIKE 'S6\_AB|%' THEN RAISE; END IF;
    v_sem_booked    := split_part(v_msg, '|', 2)::int;
    v_sem_held      := split_part(v_msg, '|', 3)::int;
    v_sem_alteradas := split_part(v_msg, '|', 4)::int;
  END;

  INSERT INTO _r VALUES (50,
    'A/B — braço COM projeção (etapa ' || v_stage_key || '): booked novos / held novos / meeting_date alteradas',
    format('%s / %s / %s', v_com_booked, v_com_held, v_com_alteradas));

  INSERT INTO _r VALUES (51,
    'A/B — braço SEM projeção (comportamento de hoje): booked novos / held novos / meeting_date alteradas',
    format('%s / %s / %s', v_sem_booked, v_sem_held, v_sem_alteradas));

  -- A ASSERÇÃO DURA. Não é "os dois braços têm de bater" — eles não têm: com
  -- data no metadata o ramo BOOKED decide diferente, e é isso que a fatia quer
  -- (é o mesmo efeito de alguém digitar a data no card). O que a fatia PROÍBE
  -- é o movimento ser contado duas vezes.
  INSERT INTO _r VALUES (52,
    'A/B — um movimento de card produziu no MÁXIMO um booked e um held (dupla contagem)',
    (v_com_booked <= 1 AND v_com_held <= 1
     AND v_sem_booked <= 1 AND v_sem_held <= 1)::text);

  -- 56. O PAR DE 52, e a lição de 2026-09-03: "no máximo um" é verdade grátis
  --     sobre zeros. Com a pré-condição 54 satisfeita, o braço A tem de ter
  --     produzido ALGUM efeito — é ele que dá a 52 alguma coisa para limitar.
  --     Zero aqui não é boa notícia: é o A/B declarando que não mediu nada.
  INSERT INTO _r VALUES (56,
    'A/B — o braço A produziu efeito mensurável (senão 52 é tautologia sobre zeros; tem de ser > 0)',
    (v_com_booked + v_com_held + v_com_alteradas)::text);

  INSERT INTO _r VALUES (53,
    'A/B — REMOVER a projeção não gerou evento (o guarda cobre a limpeza; tem de ser 0)',
    v_limpeza_eventos::text);
END;
$ab$;

-- ── VEREDITO ────────────────────────────────────────────────────────────────
-- Estoura se qualquer asserção dura reprovar. Reprovou: para, não aplica.
--
-- TODA linha de invariante passa por aqui. Antes não passava: 10, 12, 13, 14,
-- 15 e 16 tinham rótulo "tem de ser X" e NINGUÉM conferia o valor — eram
-- `INSERT INTO _r` e nada mais; 41 idem; e a pré-condição do A/B não existia.
-- (11 e 17 eram conferidos, mas contra constante chumbada, que é o outro jeito
-- de errar.) A execução de 2026-09-03 imprimiu 14 num campo rotulado "tem de
-- ser 10" e terminou dizendo APROVADO. Rótulo não é portão; conferência é.
--
-- Regra desta lista: entra o que tem valor CERTO conhecido (derivado do antes,
-- nunca chumbado). Fica de fora o que é observação — 1–5, 7, 8, 9, 35, 50, 51
-- e as linhas rotuladas 'medida —' — porque forçar um valor esperado onde não
-- existe um é como se produz o falso vermelho.

DO $veredito$
DECLARE
  v_falhas text := '';
  v_ausentes text;
  v_n int;
BEGIN
  -- PRESENÇA ANTES DE VALOR. Portão que não chegou a gravar linha nenhuma
  -- passa em todo `IF` por comparação com NULL — é verde por ausência, e é o
  -- mesmo defeito de fundo do A/B inerte: nada mediu, ninguém reclamou. Se um
  -- bloco adiante for editado e parar de escrever a medida dele, aparece aqui.
  SELECT string_agg(o::text, ', ' ORDER BY o) INTO v_ausentes
  FROM unnest(ARRAY[6,10,11,12,13,14,15,16,17,18,
                    20,21,22,23,24,25,26,27,
                    30,31,32,33,34,40,41,42,43,52,53,54,55,56]) o
  WHERE NOT EXISTS (SELECT 1 FROM _r r WHERE r.ordem = o AND r.medida NOT LIKE 'medida —%');

  IF v_ausentes IS NOT NULL THEN
    v_falhas := v_falhas || ' [portões que não gravaram medida nenhuma (verde por ausência): ' || v_ausentes || ']';
  END IF;

  -- Portões cujo valor é uma CONTAGEM que tem de ser 0. Vários deles gravam
  -- mais de uma linha no mesmo `ordem` (o par 16a/16b, por exemplo), e é por
  -- isso que a checagem é por conjunto e não por `LIMIT 1`: conferir só a
  -- primeira linha de um `ordem` é como o 16 antigo passava despercebido.
  SELECT count(*) INTO v_n FROM _r
   WHERE ordem IN (10, 11, 12, 13, 16, 17, 18, 30, 31, 32, 33, 34, 53, 55)
     AND medida NOT LIKE 'medida —%'
     AND valor IS DISTINCT FROM '0';
  IF v_n > 0 THEN
    v_falhas := v_falhas || ' [zeros violados: '
      || (SELECT string_agg(format('%s=%s (%s)', ordem, valor, medida), ' | ' ORDER BY ordem)
            FROM _r
           WHERE ordem IN (10, 11, 12, 13, 16, 17, 18, 30, 31, 32, 33, 34, 53, 55)
             AND medida NOT LIKE 'medida —%'
             AND valor IS DISTINCT FROM '0') || ']';
  END IF;

  IF (SELECT valor FROM _r WHERE ordem=14 LIMIT 1) <> '1' THEN
    v_falhas := v_falhas || ' [14 trg_meeting_espelha_no_funil não nasceu — o espelho não existe e 20-27 mediriam outra coisa]'; END IF;
  IF (SELECT valor FROM _r WHERE ordem=15 LIMIT 1) <> 'true' THEN
    v_falhas := v_falhas || ' [15 o guarda do carimbo NÃO está em fn_capture_meeting_event — todo verde de 30-34 seria por ausência de espelho, não por supressão]'; END IF;
  IF (SELECT valor FROM _r WHERE ordem=54 LIMIT 1) IS DISTINCT FROM 'true' THEN
    v_falhas := v_falhas || ' [54 pré-condição do braço A ausente — o A/B não chegou a montar o alvo]'; END IF;
  IF COALESCE((SELECT valor::int FROM _r WHERE ordem=56 LIMIT 1), 0) = 0 THEN
    v_falhas := v_falhas || ' [56 braço A mudo — 52 estaria passando sobre zeros, que foi o defeito de 2026-09-03]'; END IF;
  IF (SELECT valor FROM _r WHERE ordem=41 LIMIT 1) LIKE '%agenda:%' THEN
    v_falhas := v_falhas || ' [41 nasceu linha source=agenda:* — as reuniões do ensaio têm lead_id NULL e fn_meeting_outcome_to_events sai nessa porta: alguém a mais está escrevendo]'; END IF;

  -- 10-13, 16-18, 30-34, 53 e 55 já foram conferidos no lote de zeros acima —
  -- repeti-los aqui só produziria duas mensagens para a mesma falha.
  IF (SELECT valor::int FROM _r WHERE ordem=40 LIMIT 1) = 0 THEN
    v_falhas := v_falhas || ' [40 CONTROLE POSITIVO A mudo — o verde acima é por ausência]'; END IF;
  IF (SELECT valor::int FROM _r WHERE ordem=42 LIMIT 1) = 0 THEN
    v_falhas := v_falhas || ' [42 CONTROLE POSITIVO B mudo — entrada CARIMBADA parou de emitir evento: o guarda está calando edição humana]'; END IF;
  IF (SELECT valor FROM _r WHERE ordem=43 LIMIT 1) <> 'true' THEN
    v_falhas := v_falhas || ' [43 a edição humana APAGOU o carimbo — a premissa do guarda (merge preserva o rev) é falsa]'; END IF;
  IF (SELECT valor FROM _r WHERE ordem=52 LIMIT 1) <> 'true' THEN
    v_falhas := v_falhas || ' [52 movimento de card contado duas vezes — ver 50/51]'; END IF;
  IF EXISTS (SELECT 1 FROM _r WHERE ordem BETWEEN 20 AND 27 AND valor IS DISTINCT FROM 'true') THEN
    v_falhas := v_falhas || ' [20-27 cenário/porta/contraprova do espelho reprovou: '
             || (SELECT string_agg(medida, ' | ') FROM _r
                  WHERE ordem BETWEEN 20 AND 27 AND valor IS DISTINCT FROM 'true') || ']'; END IF;

  IF v_falhas <> '' THEN
    RAISE EXCEPTION 'ENSAIO S6 REPROVADO:%', v_falhas;
  END IF;
  RAISE NOTICE 'ENSAIO S6 APROVADO.';
END;
$veredito$;

SELECT ordem, medida, valor FROM _r ORDER BY ordem, medida;

ROLLBACK;
