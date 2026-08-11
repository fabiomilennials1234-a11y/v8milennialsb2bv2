-- ============================================================================
-- Backfill: devolve `instance_id` às mensagens órfãs de WhatsApp.
--
-- A FK `whatsapp_messages_instance_id_fkey` era ON DELETE SET NULL. Toda vez
-- que uma instância foi excluída, o histórico dela perdeu o vínculo — e o chat,
-- que filtra por `instance_id`, passou a não enxergar a conversa inteira.
-- A mensagem nunca sumiu do banco nem do WhatsApp: sumiu do filtro.
--
-- Este script reata o vínculo do que já ficou para trás. Ele NÃO conserta a
-- causa.
--
-- ⚠️  NÃO AGENDADO — decisão do CTO em 2026-08-11: rodar o backfill NÃO está no
--     plano. O objetivo é que o erro pare de acontecer, e para isso bastam a
--     migration e o deploy das edge functions. Este arquivo fica versionado
--     como a receita de recuperação, medida e pronta, para o dia em que alguém
--     quiser o histórico de volta. Enquanto não rodar, o custo é conhecido e
--     está declarado abaixo: as 385.828 linhas órfãs seguem invisíveis no chat
--     e as 10.641 conversas afetadas seguem fora da lista do inbox.
--
-- ── ORDEM OBRIGATÓRIA: MIGRATION → DEPLOY → BACKFILL ───────────────────────
--   1. migration aplicada em prod            (MANUAL)
--   2. deploy das edge functions             (MANUAL)
--   3. só ENTÃO este backfill
--
-- Não é "1 e 2 juntos", não é "2 depois do backfill". Nesta ordem, porque a FK
-- NÃO é a única fonte de órfã — e nem sequer é a dominante.
--
-- ⚠️  DROPAR A FK SOZINHO **NÃO** ESTANCA A HEMORRAGIA.
--     A FK era `ON DELETE SET NULL`, mas quem apaga uma Instance hoje é o
--     `whatsapp-api-proxy`, e ele anula `whatsapp_messages.instance_id` em
--     CÓDIGO — `nullifyInBatches` → `nullifyByIds` → `.update({instance_id:
--     null})` — ANTES do DELETE, justamente para o cascade não estourar o
--     statement timeout. Esse é o caminho DOMINANTE: das 2.994 órfãs nascidas
--     nos últimos 7 dias, 2.979 (99,5%) têm prefixo Uazapi, ou seja, são linha
--     recente anulada em código, não linha antiga tocada pela FK.
--
--     Com a migration aplicada e o proxy AINDA NÃO deployado, a guarda de FK
--     passa, o backfill recupera ~163k linhas — e a próxima exclusão de
--     instância pela UI zera tudo de novo. A hemorragia medida foi exatamente
--     essa: excluir+recriar pela UI, 111s.
--
--     A versão deployada do proxy decide sozinha (`whatsappMessagesFkState`
--     sonda o catálogo e só tira `whatsapp_messages` da lista quando prova que
--     a FK sumiu). A versão ANTIGA não sonda nada: ela anula sempre. Por isso
--     o deploy é passo próprio, e a guarda da seção 1 tem DUAS checagens.
--
--     Segundo escritor, independente da FK: `process-scheduled-user-messages`
--     inseria a linha já com `instance_id` NULL (message_id `sched_…`), porque
--     lia `scheduled_user_messages.whatsapp_instance_id`, que é
--     `ON DELETE SET NULL`. Corrigido na mesma leva (passa a gravar a instância
--     resolvida). Deploye-o junto — a guarda cobre os dois sem nomeá-los.
--
-- É DML de dado de cliente — por isso vive aqui e não numa migration
-- (guarda F4 do CLAUDE.md: migration é só schema).
--
-- ── TETO: recupera 43,4%. O RESTO NÃO TEM ÂNCORA. ──────────────────────────
-- Medido em prod (jsjsmuncfkbsbzqzqhfq) em 2026-08-11, antes de escrever:
--
--   órfãs totais ................................. 385.829
--   recuperável (soma dos passes) ................ ~162.600  (42,1%)
--   irrecuperável ................................ ~223.200  (57,9%)
--
-- (Era 167.300 / 43,4% antes de o P0 ganhar a trava de prefixo — ver seção 4.
--  As 4.244 linhas que a trava barra NÃO eram recuperáveis: eram atribuição
--  errada disfarçada de recuperação.)
--
-- O irrecuperável se divide em:
--   • 203.410 sem prefixo no `message_id` e sem `raw_payload` — era
--     Evolution/history-sync, que nunca carimbou a origem. Não há de onde tirar.
--   • 11.321 em orgs com ZERO instâncias hoje: Castropil 10.093, NatuPlast
--     1.158, testevideo 69, Plinio 1. Não existe destino para onde apontar.
--
-- Não prometa mais que isso. Quem quiser os 56,6% vai precisar de outra fonte
-- (export do provider), não de SQL.
--
-- ── AS DUAS SUPERFÍCIES: A THREAD E A LISTA ────────────────────────────────
-- Reparar `whatsapp_messages` faz a THREAD voltar a abrir. Não faz a CONVERSA
-- voltar para a LISTA do inbox — são tabelas diferentes.
--
-- A lista não lê `whatsapp_messages`: lê a tabela-resumo
-- `whatsapp_conversation_summary`, via `get_whatsapp_conversation_list`. Aquela
-- tabela NÃO tem FK, então ninguém a nulificou — ela simplesmente ficou
-- apontando para id morto: 10.641 linhas → 62 instâncias inexistentes, 24 orgs.
-- E o gatilho que a mantém (`trg_whatsapp_conversation_summary`) é AFTER
-- **INSERT**: o UPDATE dos passes P0..P2 não o dispara, então ela não se
-- conserta sozinha.
--
-- Por isso existe o P3 (seção 9), que re-aponta a tabela-resumo usando como
-- evidência as mensagens JÁ reparadas pelos passes anteriores. Ele é o último
-- passe por dependência, não por prioridade.
--
-- Não conte com o resolvedor de chip para isto. `whatsapp_chip_instance_ids`
-- (da migration) acha os ids históricos do chip lendo a lápide
-- `whatsapp_instance_reap_queue` — mas das 62 instâncias mortas que a
-- tabela-resumo referencia, só **4** estão na lápide (que tem 7 linhas no
-- total, e ganha `phone_number` só a partir da migration). As outras 58 morreram
-- antes de existir lápide: nenhuma consulta as recupera. A lápide resolve o
-- futuro; o P3 resolve o passado.
--
-- ── POR QUE ESTE SCRIPT É SEGURO DE RODAR COM O SISTEMA DE PÉ ──────────────
-- Verificado em `pg_trigger`: os seis gatilhos de efeito colateral de
-- `whatsapp_messages` são AFTER INSERT (webhooks, pausa de copiloto, resumo de
-- conversa, histórico, detecção de resposta) e o normalizador de telefone é
-- BEFORE INSERT OR UPDATE **OF phone_number**. Este script só escreve
-- `instance_id`. Portanto: nenhum gatilho dispara, nenhum copiloto é pausado,
-- nenhum webhook é enfileirado.
--
-- O P3 escreve numa SEGUNDA tabela, `whatsapp_conversation_summary`. Ela não
-- tem gatilho nenhum (verificado em `pg_trigger`: zero linhas não-internas) e
-- não tem FK — só a PK. O UPDATE dela também não dispara nada.
--
-- ⚠️  O QUE NÃO É INERTE: `whatsapp_messages` está na publicação
--     `supabase_realtime` (verificado em `pg_publication_tables`). Cada linha
--     que os passes P0/P1/P1b/P2 escrevem vira evento de replicação — são
--     ~146k eventos no caminho padrão. Não é gatilho e não muda dado, mas passa
--     por WAL e chega aos clientes conectados. É a razão de verdade para a
--     janela de baixa carga e para o `LIMIT :lote`, e o motivo de não colar os
--     passes num loop sem respiro. (`whatsapp_conversation_summary` NÃO está na
--     publicação, então o P3 é silencioso nesse aspecto.)
--
-- ── COMO RODAR ─────────────────────────────────────────────────────────────
-- Janela de baixa carga. `psql` apontado para prod, uma org por vez, mês a mês.
-- O `whatsapp-webhook` escreve nesta tabela o tempo todo — daí o lock_timeout
-- curto e os lotes.
--
--   psql "$PROD_URL" -f scripts/backfill-orphan-whatsapp-messages.sql
--
-- Idempotente: P0/P1/P1b/P2 filtram `instance_id IS NULL` e o P3 filtra
-- "instância que não existe mais", então nenhum passe reescreve linha já
-- resolvida. Reexecutar é seguro e é o modo de operação previsto — rode o mesmo
-- passe até ele reportar `UPDATE 0`.
--
-- ORDEM DOS PASSES, e por quê:
--   P0 → P1 → P1b   se auto-aplicam (cada um só vê o que o anterior deixou)
--   P2              OPCIONAL, fora do caminho padrão — seção 7
--   P3              POR ÚLTIMO, depois de TODAS as orgs e TODOS os meses:
--                   a evidência dele são as mensagens que os passes anteriores
--                   repararam. É dependência, não preferência — seção 8.
--
-- Reverter: não há undo automático. Se precisar, o alvo de cada passe é
-- reconstituível pelos mesmos predicados (o `id` da linha não muda).
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 0. PARÂMETROS
-- ─────────────────────────────────────────────────────────────────────────────
-- OBRIGATÓRIO, e não é formalidade: sem ON_ERROR_STOP o psql apenas IMPRIME o
-- erro e SEGUE para o comando seguinte. A guarda da FK da seção 1 viraria
-- enfeite — ela abortaria a si mesma e os UPDATEs rodariam assim mesmo, com a
-- FK ainda de pé. O mesmo vale para um 23505 no meio dos passes.
\set ON_ERROR_STOP on

-- Trocar a cada execução. `ini`/`fim` fatiam por mês: a janela de órfãs vive
-- inteira entre 2026-02 e 2026-08 (medido), então sete fatias cobrem tudo.
--
-- A fatia por (org, mês) não é capricho: com `organization_id` + `instance_id
-- IS NULL` + intervalo de `timestamp`, o plano usa `idx_whatsapp_msgs_org_instance_ts`
-- com Index Cond completo (verificado com EXPLAIN, custo ~5.7k). Sem o intervalo,
-- o planner cai em `idx_whatsapp_messages_timestamp` e varre a tabela inteira —
-- foi assim que as sondas de medição estouraram o timeout.

-- `org` NASCE INVÁLIDO DE PROPÓSITO. A versão anterior trazia a Basic4u como
-- default — que é precisamente a org que a seção 7 manda deixar por ÚLTIMO.
-- Default perigoso num arquivo que se roda com `-f` é armadilha: quem executasse
-- sem ler acertaria a pior org possível. Sem escolha explícita, a guarda 1c
-- aborta.
\set org 'PREENCHER'
\set ini '2026-03-01'
\set fim '2026-04-01'
\set lote 20000

-- P2 é OPT-IN MECÂNICO, não um aviso. Ele é o único passe que adivinha (seção
-- 7), e comentário não impede execução: `psql -f` roda o arquivo inteiro, de
-- cima a baixo. Com `false` aqui, o bloco `\if` da seção 7 pula o passe de
-- verdade. Ligar exige editar esta linha, que é o ato deliberado que o passe
-- merece.
\set run_p2 false

-- ATESTAÇÃO DE DEPLOY — obrigatória, e a guarda da seção 1 a usa de verdade.
--
-- Preencha com o horário (UTC) em que as edge functions corrigidas subiram —
-- `whatsapp-api-proxy` e `process-scheduled-user-messages`. Use o horário do
-- deploy MAIS TARDIO dos dois.
--
-- Não é burocracia: é o único jeito de o script provar que o nullify morreu.
-- A guarda aborta se qualquer órfã tiver NASCIDO depois deste instante — e
-- órfã nova depois do deploy correto é impossível, porque os dois escritores
-- passaram a gravar `instance_id`. Se abortar, o deploy não está de pé (ou
-- apareceu um terceiro escritor); NÃO afrouxe a data para passar.
--
-- Deixe o placeholder e a guarda aborta de propósito.
\set proxy_deployed_at 'PREENCHER'

-- `UPDATE 0` num passe é resultado normal, não script quebrado: cada passe só
-- pega o que o predicado dele alcança naquele mês. Exemplo medido — a Alamaster
-- tem 46.314 linhas de P1, mas TODAS entre 2026-05 e 2026-08; em 2026-03/04 ela
-- tem 68.212 órfãs e o P1 devolve 0, porque aquele período é da era
-- Evolution/history-sync e não carimbou prefixo nenhum. Rode os quatro passes
-- em cada mês e deixe cada um pegar o que é dele.

-- Orgs com órfãs, para copiar/colar em :org
-- (A contagem de chips deriva: a Alamaster saiu de 55 para 56 instâncias no
--  intervalo entre duas consultas de medição. Nada aqui depende do número
--  exato — a trava do P2 lê o valor corrente do banco na hora.)
--   636776d8-6282-48bc-b190-764d42785a5b  Alamaster          155.674  (~56 chips)
--   163874dd-d05c-4ae2-811a-d6772b05dac5  Basic4u             87.259  (4 chips)
--   6030520a-2ca7-477d-be89-55758e2cd808  Milennials          28.679  (4 chips)
--   ab138cd5-32b9-41db-8cc8-c95d94bde054  Cervejaria Insana   19.746  (2 chips)
--   5ba79911-e683-41fd-ab7a-53fd2cca7e82  Goletric Perdizes   16.574  (2 chips)
--   c187842a-5df1-4f87-9c38-9c5d74d4ac91  Bertin              16.152  (2 chips)
--   27eab7ac-6d14-4b62-9e7b-c3bcdfbb396f  SORVFOODS           11.963  (1 chip)
--   17c46b69-e9fa-4ce0-9732-dc416d847dc8  Mapila Alimentos     7.885  (2 chips)
--   1003870a-ceea-487b-8dd5-910018c7a7d7  Motor 100            6.367  (1 chip)
--   18f80c2b-c58e-4d51-9f5d-e3f972a332cb  Maycão               6.252  (1 chip)
--   6e5f6a20-04e2-4611-839c-6de15996af31  HGE Iluminação       3.859  (5 chips)
--   …demais orgs de 1 chip: ver o passe P0, que as cobre em bloco.


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. GUARDA — DUAS checagens, porque são duas causas
-- ─────────────────────────────────────────────────────────────────────────────
-- Sem isto o backfill é trabalho jogado fora: a próxima exclusão de instância
-- devolve as linhas para NULL.
--
-- 1a prova o SCHEMA (migration aplicada). 1b prova o CÓDIGO (deploy feito).
-- Uma não substitui a outra: a FK é a causa MENOR, e checar só ela deixa passar
-- o caminho dominante — o nullify em código do proxy. Foi por isso que a versão
-- anterior desta guarda dava um falso "pode rodar".

-- 1a. SCHEMA — a FK precisa ter morrido.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.whatsapp_messages'::regclass
       AND conname  = 'whatsapp_messages_instance_id_fkey'
  ) THEN
    RAISE EXCEPTION
      'ABORTADO (1a): a FK whatsapp_messages_instance_id_fkey ainda existe. Aplique a migration que a dropa antes de rodar este backfill.';
  END IF;
END $$;

-- 1b. CÓDIGO — o nullify precisa ter morrido.
--
-- Invariante observável, e não uma lista de funções: DEPOIS do deploy correto
-- nenhuma linha nova pode nascer órfã. Toda órfã com `created_at` posterior ao
-- deploy é prova de que algum escritor ainda zera (ou nunca preenche)
-- `instance_id`. A guarda não precisa saber QUAL — qualquer um a derruba.
--
-- Por que `created_at` basta: o nullify do proxy é UPDATE, que não mexe em
-- `created_at`. Mas ele age sobre TODO o histórico do chip, e todo chip vivo
-- recebe mensagem o tempo todo — então o lote anulado sempre inclui linhas
-- recentes. Medido: das 2.994 órfãs dos últimos 7 dias, 2.979 nasceram e foram
-- anuladas dentro da própria janela. O sinal é sensível na prática.
--
-- Medido em 2026-08-11, com o deploy ainda pendente: 14 órfãs nas últimas 24h,
-- a mais nova de minutos atrás. Ou seja, hoje esta guarda aborta — como deve.
-- O valor vai para uma GUC de sessão ANTES do bloco: o psql NÃO interpola
-- `:variavel` dentro de string dollar-quoted ($$...$$), então ler `:'…'` lá
-- dentro deixaria a guarda inerte — exatamente o tipo de falha silenciosa que
-- ela existe para impedir. Aqui a substituição acontece em SQL puro, e o bloco
-- lê a GUC.
SELECT set_config('backfill.proxy_deployed_at', :'proxy_deployed_at', false);

-- 1c. PARÂMETRO — a org precisa ter sido escolhida.
--
-- Mesmo mecanismo de GUC da 1b, e pela mesma razão (o psql não interpola dentro
-- de $$…$$). Sem esta guarda o placeholder chegaria como `'PREENCHER'::uuid` no
-- meio do primeiro passe e o erro seria um `invalid input syntax for type uuid`
-- — verdadeiro, mas mudo sobre a causa. Falhar aqui diz o que fazer.
SELECT set_config('backfill.org', :'org', false);
DO $$
BEGIN
  IF current_setting('backfill.org', true) IS NULL
     OR current_setting('backfill.org', true) = 'PREENCHER' THEN
    RAISE EXCEPTION
      'ABORTADO (1c): escolha a org em \set org antes de rodar. Comece pelas pequenas; a Basic4u é a ÚLTIMA (ver seção 7).';
  END IF;
END $$;

DO $$
DECLARE
  v_raw    text := current_setting('backfill.proxy_deployed_at', true);
  v_deploy timestamptz;
  v_novas  bigint;
  v_ultima timestamptz;
BEGIN
  IF v_raw IS NULL OR v_raw = '' OR v_raw = 'PREENCHER' THEN
    RAISE EXCEPTION
      'ABORTADO (1b): proxy_deployed_at nao foi preenchido. Informe o horario UTC do deploy MAIS TARDIO entre whatsapp-api-proxy e process-scheduled-user-messages.';
  END IF;

  v_deploy := v_raw::timestamptz;

  IF v_deploy > now() THEN
    RAISE EXCEPTION
      'ABORTADO (1b): proxy_deployed_at (%) esta no futuro.', v_deploy;
  END IF;

  SELECT count(*), max(created_at) INTO v_novas, v_ultima
    FROM public.whatsapp_messages
   WHERE instance_id IS NULL
     AND created_at > v_deploy;

  IF v_novas > 0 THEN
    RAISE EXCEPTION
      'ABORTADO (1b): % orfa(s) nasceram DEPOIS do deploy informado (%) — a mais recente em %. O nullify continua vivo: confirme que whatsapp-api-proxy E process-scheduled-user-messages estao deployados. NAO adiante a data para contornar.',
      v_novas, v_deploy, v_ultima;
  END IF;
END $$;

SET lock_timeout       = '3s';
SET statement_timeout  = '120s';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. CONFERÊNCIA ANTES
-- ─────────────────────────────────────────────────────────────────────────────
-- Rode e compare com os números medidos. Divergência grande = premissa mudou;
-- pare e remeça antes de escrever.
--
-- Medido em prod 2026-08-11:
--
--   passe   linhas    o que é
--   ─────   ───────   ────────────────────────────────────────────────────────
--   P0       32.330   org de 1 instância + prefixo que casa (evidência direta)
--   P1       87.751   prefixo `numero:` casando chip único da mesma org
--   P1b      26.491   desempate do único (org, chip) duplicado do prod
--   ─────   ───────
--   subtotal 146.572  ← os três passes NÃO-inferenciais
--
--   P2       16.000   consenso de thread — INFERE, OPCIONAL, exige OK do CTO
--   ─────   ───────
--   total   162.572
--
--   P3        3.363+  `whatsapp_conversation_summary` (LINHAS DE LISTA, não de
--                     mensagem — não somar ao total acima)
--
-- ⚠️  O P0 era 36.574 antes de ganhar a trava de prefixo. As 4.244 linhas de
--     diferença iriam para o chip ERRADO; ver seção 4. Se você rodar a
--     conferência e vir 36.574 no lugar de 32.330, está lendo a consulta antiga.
--
-- ⚠️  Sobre o P2 e o número 16.481 do desenho original: o alvo do P2 é medido
--     DEPOIS que P0/P1/P1b já rodaram, porque cada linha que eles preenchem
--     vira âncora nova para o consenso. Antes dos passes o P2 vale 16.000;
--     medindo a Basic4u já com o P1b aplicado, ela sozinha sobe de 11.524 para
--     13.198 (+1.674). Ou seja: 16.481 está dentro da banda esperada, e o
--     número final só é conhecido na hora. Use a consulta abaixo no momento de
--     rodar o P2 — ela mede o estado corrente, não o estado de ontem.

\echo '── órfãs restantes (global) ──'
SELECT count(*) AS orfas_restantes
  FROM public.whatsapp_messages
 WHERE instance_id IS NULL;

\echo '── alvo do P0 (global, todas as orgs de 1 instância) ──'
-- `p0_alvo` é o que o passe VAI escrever (já com a trava de prefixo).
-- `p0_barrado_chip_errado` é o que a trava recusa de propósito — não é perda,
-- é dano evitado. Ver seção 4.
WITH unica AS (
  SELECT organization_id, (array_agg(id))[1] AS instancia,
         (array_agg(phone_number))[1] AS chip
    FROM public.whatsapp_instances
   GROUP BY organization_id
  HAVING count(*) = 1
)
SELECT
  count(*) FILTER (
    WHERE m.message_id !~ '^[0-9]+:'
       OR split_part(m.message_id, ':', 1) = u.chip
  ) AS p0_alvo,
  count(*) FILTER (
    WHERE m.message_id ~ '^[0-9]+:'
      AND (u.chip IS NULL OR split_part(m.message_id, ':', 1) <> u.chip)
  ) AS p0_barrado_chip_errado,
  count(DISTINCT m.organization_id) AS orgs
  FROM public.whatsapp_messages m
  JOIN unica u ON u.organization_id = m.organization_id
 WHERE m.instance_id IS NULL;

\echo '── alvo de P1 / P1b / P2 para :org ──'
-- Por org, porque a versão global estoura o statement_timeout.
WITH chip AS (
  SELECT phone_number, count(*) AS n
    FROM public.whatsapp_instances
   WHERE organization_id = :'org'::uuid AND phone_number IS NOT NULL
   GROUP BY phone_number
),
consenso AS (
  SELECT normalized_phone
    FROM public.whatsapp_messages
   WHERE organization_id = :'org'::uuid
     AND instance_id IS NOT NULL
     AND normalized_phone IS NOT NULL
   GROUP BY normalized_phone
  HAVING count(DISTINCT instance_id) = 1
)
SELECT
  count(*) FILTER (
    WHERE m.message_id ~ '^[0-9]+:'
      AND EXISTS (SELECT 1 FROM chip c WHERE c.phone_number = split_part(m.message_id,':',1) AND c.n = 1)
  ) AS p1_alvo,
  count(*) FILTER (
    WHERE m.message_id ~ '^[0-9]+:'
      AND EXISTS (SELECT 1 FROM chip c WHERE c.phone_number = split_part(m.message_id,':',1) AND c.n > 1)
  ) AS p1b_alvo,
  count(*) FILTER (
    WHERE m.message_id !~ '^[0-9]+:'
      AND (SELECT count(*) FROM public.whatsapp_instances i WHERE i.organization_id = :'org'::uuid) BETWEEN 2 AND 4
      AND EXISTS (SELECT 1 FROM consenso k WHERE k.normalized_phone = m.normalized_phone)
  ) AS p2_alvo
  FROM public.whatsapp_messages m
 WHERE m.organization_id = :'org'::uuid
   AND m.instance_id IS NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. OS DOIS GUARDAS QUE TODO PASSE CARREGA
-- ─────────────────────────────────────────────────────────────────────────────
-- Existe UNIQUE (message_id, instance_id). Hoje as órfãs convivem porque NULL
-- não colide com NULL no índice — preencher `instance_id` acorda a UNIQUE.
-- São DOIS riscos distintos, e um guarda só não cobre os dois:
--
--   (a) COLISÃO COM LINHA JÁ ATRIBUÍDA — o eco do webhook já gravou o mesmo
--       `message_id` com a instância nova. Coberto pelo `NOT EXISTS`.
--       Medido: 853 linhas só no alvo do P0. A linha órfã é descartada (a nova
--       já é a boa) e fica NULL.
--
--   (b) COLISÃO ENTRE DUAS ÓRFÃS DO MESMO LOTE — duas linhas órfãs com o mesmo
--       `message_id` indo para a MESMA instância. O `NOT EXISTS` não vê isto,
--       porque nenhuma das duas está atribuída ainda: o UPDATE aborta inteiro
--       com 23505. Coberto pelo `row_number()`, que deixa passar uma só.
--       Medido: 3.385 linhas excedentes no alvo do P0 (4 orgs) e 827 no alvo do
--       P2 da Basic4u. Sem este guarda, esses dois passes não rodam — abortam.
--
-- Nota sobre a Alamaster: ela tem 9.175 pares de órfãs com `message_id` igual,
-- mas são mensagem interna entre dois chips da própria org (mesmo timestamp e
-- conteúdo, `direction` e `normalized_phone` DIFERENTES). São duas linhas
-- legítimas de duas instâncias diferentes — o `row_number()` particiona por
-- (message_id, instância), então as duas sobrevivem. Elas não caem no P1
-- (não têm prefixo) nem no P2 (55 chips reprovam na trava).


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. P0 — org de 1 instância, COM A MESMA TRAVA DO P1   [esperado global: 32.330]
-- ─────────────────────────────────────────────────────────────────────────────
-- "Org com exatamente 1 instância" NÃO é o mesmo que "só existe um destino
-- possível". Existe um só destino VIVO — mas a mensagem pode ter saído de um
-- chip ANTERIOR, que foi excluído, e o provider carimbou qual no prefixo do
-- `message_id`. Atribuir essas linhas à instância atual é fundir histórico de
-- dois chips diferentes numa thread só: exatamente o dano que o desenho proíbe,
-- em UPDATE de dado de cliente que não tem undo.
--
-- Medido em prod 2026-08-11: sem esta trava o P0 mandaria 4.244 linhas para o
-- chip errado.
--
--   org                    chip atual        prefixo da órfã     linhas
--   ────────────────────   ───────────────   ────────────────   ──────
--   Bennedita Pan          5511948583181     5513996351231       1.314
--   Motor 100              554788879460      554891005289 (+2)   1.072
--   Improving              554891199347      554888794649          690
--   All Mix                5522992290731     553284676832          534
--   Teste a1               555185960716      554891005289          317
--   Elvéra                 5511973435775     5511968985550          46
--   Chique Distribuidora   555597350981      555525100747            7
--                                                              ──────
--                                                               3.980
--   + Café Jurerê 168 e Brasil Engrenagens 96: a instância única da org tem
--     `phone_number` NULL, então não há como PROVAR que o prefixo é dela. Sem
--     prova, não atribui.                                          264
--
-- A trava é a do P1, palavra por palavra: aceita linha SEM prefixo, ou com
-- prefixo que CASA o número da instância única. Linha com prefixo de outro
-- número fica NULL DE PROPÓSITO — é dado que o script se recusa a inventar.
--
-- Inverter a ordem P1→P0 não resolveria: as órfãs de chip antigo não casam
-- instância viva nenhuma, então escapariam do P1 e cairiam no P0 do mesmo jeito.
-- A trava tem de estar no P0.
--
-- Rode até `UPDATE 0`.

\echo '── P0 ──'
WITH unica AS (
  SELECT organization_id, (array_agg(id))[1] AS instancia,
         (array_agg(phone_number))[1] AS chip
    FROM public.whatsapp_instances
   GROUP BY organization_id
  HAVING count(*) = 1
),
cand AS (
  SELECT m.id, m.message_id, m.timestamp, u.instancia
    FROM public.whatsapp_messages m
    JOIN unica u ON u.organization_id = m.organization_id
   WHERE m.organization_id = :'org'::uuid
     AND m.instance_id IS NULL
     AND m.timestamp >= :'ini'::timestamptz
     AND m.timestamp <  :'fim'::timestamptz
     -- TRAVA DE CHIP: sem prefixo, ou prefixo que casa o número da instância
     -- única. `u.chip` NULL torna a comparação NULL → a linha não passa, que é
     -- o comportamento desejado (sem número, não há prova).
     AND (m.message_id !~ '^[0-9]+:'
          OR split_part(m.message_id, ':', 1) = u.chip)
     AND NOT EXISTS (                                    -- guarda (a)
       SELECT 1 FROM public.whatsapp_messages x
        WHERE x.message_id = m.message_id
          AND x.instance_id = u.instancia
     )
   ORDER BY m.timestamp, m.id
   LIMIT :lote
),
alvo AS (
  SELECT id, instancia,
         row_number() OVER (PARTITION BY message_id, instancia               -- guarda (b)
                            ORDER BY timestamp, id) AS rn
    FROM cand
)
UPDATE public.whatsapp_messages t
   SET instance_id = a.instancia
  FROM alvo a
 WHERE t.id = a.id
   AND a.rn = 1;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. P1 — prefixo `numero:` casando chip ÚNICO da org   [esperado global: 87.751]
-- ─────────────────────────────────────────────────────────────────────────────
-- A Uazapi devolve o id composto `<owner>:<ID>`; o `<owner>` é o número do chip
-- que enviou. Casando com `whatsapp_instances.phone_number` da mesma org, o
-- destino é inequívoco — desde que aquele número apareça em UMA instância só,
-- que é o que o HAVING garante.
--
-- Por org (medido): Alamaster 46.314 · Cervejaria 19.746 · Goletric 16.574 ·
-- Bertin 2.916 · HGE 1.121 · Milennials 1.079 · Carol 1.

\echo '── P1 ──'
WITH chip AS (
  SELECT phone_number, (array_agg(id))[1] AS instancia
    FROM public.whatsapp_instances
   WHERE organization_id = :'org'::uuid
     AND phone_number IS NOT NULL
   GROUP BY phone_number
  HAVING count(*) = 1
),
cand AS (
  SELECT m.id, m.message_id, m.timestamp, c.instancia
    FROM public.whatsapp_messages m
    JOIN chip c ON c.phone_number = split_part(m.message_id, ':', 1)
   WHERE m.organization_id = :'org'::uuid
     AND m.instance_id IS NULL
     AND m.message_id ~ '^[0-9]+:'
     AND m.timestamp >= :'ini'::timestamptz
     AND m.timestamp <  :'fim'::timestamptz
     AND NOT EXISTS (
       SELECT 1 FROM public.whatsapp_messages x
        WHERE x.message_id = m.message_id
          AND x.instance_id = c.instancia
     )
   ORDER BY m.timestamp, m.id
   LIMIT :lote
),
alvo AS (
  SELECT id, instancia,
         row_number() OVER (PARTITION BY message_id, instancia
                            ORDER BY timestamp, id) AS rn
    FROM cand
)
UPDATE public.whatsapp_messages t
   SET instance_id = a.instancia
  FROM alvo a
 WHERE t.id = a.id
   AND a.rn = 1;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. P1b — desempate do (org, chip) duplicado           [esperado: 26.491]
-- ─────────────────────────────────────────────────────────────────────────────
-- O P1 exige chip único e por isso ignora um caso. Hoje o prod tem exatamente
-- UM (org, phone_number) com duas instâncias:
--
--   Basic4u 163874dd… · número 554797890485
--     ab9c373a…  "bruna 2"        disconnected  criada 2026-07-16
--     899c0f2f…  "Bruna Basic4u"  connected     criada 2026-07-22   ← alvo
--
-- Manda para a `connected`, com a mais recente como critério de desempate.
-- Escrito de forma genérica de propósito: se amanhã surgir outro chip
-- duplicado, o passe o cobre sem precisar de UUID novo no script.
--
-- (Existe um segundo número repetido no prod — 554891199347 — mas em DUAS ORGS
-- diferentes, "Marcos SDR"/Improving e "torque marcos"/Milennials. Como todo
-- casamento aqui é escopado por org, ele não é ambíguo e cai no P1 normal.)

\echo '── P1b ──'
WITH chip AS (
  SELECT phone_number,
         (array_agg(id ORDER BY (status = 'connected') DESC, created_at DESC))[1] AS instancia
    FROM public.whatsapp_instances
   WHERE organization_id = :'org'::uuid
     AND phone_number IS NOT NULL
   GROUP BY phone_number
  HAVING count(*) > 1
),
cand AS (
  SELECT m.id, m.message_id, m.timestamp, c.instancia
    FROM public.whatsapp_messages m
    JOIN chip c ON c.phone_number = split_part(m.message_id, ':', 1)
   WHERE m.organization_id = :'org'::uuid
     AND m.instance_id IS NULL
     AND m.message_id ~ '^[0-9]+:'
     AND m.timestamp >= :'ini'::timestamptz
     AND m.timestamp <  :'fim'::timestamptz
     AND NOT EXISTS (
       SELECT 1 FROM public.whatsapp_messages x
        WHERE x.message_id = m.message_id
          AND x.instance_id = c.instancia
     )
   ORDER BY m.timestamp, m.id
   LIMIT :lote
),
alvo AS (
  SELECT id, instancia,
         row_number() OVER (PARTITION BY message_id, instancia
                            ORDER BY timestamp, id) AS rn
    FROM cand
)
UPDATE public.whatsapp_messages t
   SET instance_id = a.instancia
  FROM alvo a
 WHERE t.id = a.id
   AND a.rn = 1;


-- ═════════════════════════════════════════════════════════════════════════════
-- 7. P2 — consenso de thread  ⚠️  OPCIONAL — NÃO RODAR SEM OK DO CTO
-- ═════════════════════════════════════════════════════════════════════════════
--
--   ┌───────────────────────────────────────────────────────────────────────┐
--   │ P0, P1, P1b CASAM evidência. O P2 ADIVINHA.                           │
--   │                                                                       │
--   │ Ele é o ÚNICO passe que atribui sem prova, e por isso está fora do    │
--   │ caminho padrão. O backfill é considerado COMPLETO com P0+P1+P1b+P3.   │
--   │ Rodar o P2 é uma decisão separada, com dono.                          │
--   │                                                                       │
--   │ Pré-condições, todas as três:                                         │
--   │   1. OK explícito do CTO nesta sessão;                                │
--   │   2. amostragem MANUAL numa org pequena primeiro — Vanilla (20        │
--   │      linhas) ou REALSC (6). Rode o passe lá, abra as threads no chat  │
--   │      e confirme que as mensagens caíram no chip certo;                │
--   │   3. só depois, e só se a amostra estiver limpa, a Basic4u.           │
--   │                                                                       │
--   │ A Basic4u é 11.524 das ~16.000 linhas e tem 4 chips. A concordância   │
--   │ medida com 4 chips é 92% — ou seja, ~8% (≈900 linhas) vão para o      │
--   │ vendedor ERRADO dentro da mesma org. É erro menos grave que o do P0   │
--   │ destravado (não vaza entre orgs, não funde chips de números           │
--   │ diferentes), mas é erro, e não tem undo. Rodar por último, e sabendo. │
--   │                                                                       │
--   │ Pular o P2 custa ~16.000 linhas que ficam NULL — recuperáveis depois, │
--   │ a qualquer momento. Rodar errado não é recuperável.                   │
--   └───────────────────────────────────────────────────────────────────────┘
--
-- Se todas as linhas COM instância de uma thread (org, normalized_phone)
-- apontam para a MESMA instância, as órfãs da mesma thread vão para lá.
--
-- A trava é dupla e NÃO é opcional:
--   1. só orgs com 2..4 chips;
--   2. só linhas SEM prefixo (as com prefixo já são do P1/P1b, que é evidência
--      direta e ganha sempre do palpite).
--
-- Por quê: a concordância deste passe contra o P1 (que sabe a resposta) cai com
-- o número de chips — 99,2% com 2 chips, 92,0% com 4, e 9,6% com os 55 da
-- Alamaster. Sem a trava, o passe envenenaria justamente a maior org. Com ela,
-- Alamaster (55) e HGE (5) ficam de fora — e ambas contribuiriam 0 mesmo assim.
--
-- Por org (medido antes dos passes): Basic4u 11.524 · Milennials 2.311 ·
-- Mapila 1.524 · Hoffnung 613 · Vanilla 20 · REALSC 6 · Bertin 2.
-- Descartadas por ambiguidade (thread tocada por 2+ chips): Basic4u 17.759,
-- Milennials 2.889, Mapila 1.404 — ficam NULL, de propósito.
--
-- O consenso é org-inteiro por natureza (a thread não cabe num mês), então ele
-- vai para uma TEMP TABLE uma vez por org; só o UPDATE é fatiado por mês.

-- A TRAVA DO P2 É ESTE `\if`, não o aviso da caixa acima. Um arquivo rodado com
-- `psql -f` executa tudo que estiver no caminho; enquanto o passe estivesse solto
-- aqui, "opcional" era só uma palavra num comentário. Com `run_p2 = false` (o
-- default), o psql pula daqui até o `\endif` sem executar nada.
\if :run_p2

\echo '── P2: montando consenso da org ──'
DROP TABLE IF EXISTS tmp_consenso;
CREATE TEMP TABLE tmp_consenso AS
SELECT m.normalized_phone,
       (array_agg(DISTINCT m.instance_id))[1] AS instancia
  FROM public.whatsapp_messages m
 WHERE m.organization_id = :'org'::uuid
   AND m.instance_id IS NOT NULL
   AND m.normalized_phone IS NOT NULL
   -- trava 1: a org precisa ter entre 2 e 4 chips. Fora disso a tabela nasce
   -- vazia e o passe vira no-op — a trava se aplica sozinha, sem depender de o
   -- operador escolher a org certa.
   AND (SELECT count(*) FROM public.whatsapp_instances i
         WHERE i.organization_id = :'org'::uuid) BETWEEN 2 AND 4
 GROUP BY m.normalized_phone
HAVING count(DISTINCT m.instance_id) = 1;

CREATE INDEX ON tmp_consenso (normalized_phone);
ANALYZE tmp_consenso;

\echo '── P2 ──'
WITH cand AS (
  SELECT m.id, m.message_id, m.timestamp, c.instancia
    FROM public.whatsapp_messages m
    JOIN tmp_consenso c ON c.normalized_phone = m.normalized_phone
   WHERE m.organization_id = :'org'::uuid
     AND m.instance_id IS NULL
     AND m.message_id !~ '^[0-9]+:'                      -- trava 2
     AND m.timestamp >= :'ini'::timestamptz
     AND m.timestamp <  :'fim'::timestamptz
     AND NOT EXISTS (
       SELECT 1 FROM public.whatsapp_messages x
        WHERE x.message_id = m.message_id
          AND x.instance_id = c.instancia
     )
   ORDER BY m.timestamp, m.id
   LIMIT :lote
),
alvo AS (
  SELECT id, instancia,
         row_number() OVER (PARTITION BY message_id, instancia
                            ORDER BY timestamp, id) AS rn
    FROM cand
)
UPDATE public.whatsapp_messages t
   SET instance_id = a.instancia
  FROM alvo a
 WHERE t.id = a.id
   AND a.rn = 1;

\else
\echo '── P2 PULADO (run_p2 = false). Caminho padrão: P0+P1+P1b+P3. ──'
\endif


-- ─────────────────────────────────────────────────────────────────────────────
-- 8. P3 — devolve a CONVERSA à lista do inbox        [esperado: 3.363+ linhas]
-- ─────────────────────────────────────────────────────────────────────────────
-- Os passes anteriores consertam a THREAD. Este conserta a LISTA.
--
-- A lista do inbox não lê `whatsapp_messages`: lê `whatsapp_conversation_summary`
-- via `get_whatsapp_conversation_list`. Aquela tabela não tem FK — ninguém a
-- nulificou, ela ficou apontando para id de instância que não existe mais.
-- Medido em prod 2026-08-11: 10.641 linhas → 62 instâncias mortas, 24 orgs.
-- Sem este passe, a mensagem volta mas a conversa não reaparece na lista.
--
-- ⚠️  RODE POR ÚLTIMO. A evidência do P3 são as mensagens JÁ REPARADAS pelos
--     passes anteriores. Rodar antes desperdiça a maior parte do alvo: medido na
--     Basic4u, as threads resolvíveis saltam de 412 (estado de hoje) para 811
--     depois de P0/P1/P1b. É dependência de ordem, não preferência.
--
-- CHAVE: a PK da tabela-resumo é (organization_id, instance_id, normalized_phone)
-- — lida de `pg_constraint`, e é a mesma do `ON CONFLICT` de
-- `tg_whatsapp_conversation_summary`. Então o telefone é a chave da thread e o
-- `instance_id` é o que este passe reescreve.
--
-- EVIDÊNCIA: para cada linha órfã, olha as mensagens da MESMA org e MESMO
-- telefone que já têm instância viva. Só re-aponta quando o destino é ÚNICO;
-- thread tocada por 2+ instâncias fica como está, e é contada, não chutada.
--
-- Medido 2026-08-11 em 23 das 24 orgs (9.878 das 10.641 linhas — a Alamaster,
-- 763 linhas, estourou o timeout da sonda; meça-a na hora), SIMULANDO
-- P0/P1/P1b já aplicados:
--
--   resolvível (evidência única, sem colisão) ....  3.363
--   colisão de PK (já existe linha viva) .........  1.097
--   ambígua (2+ instâncias candidatas) ...........    787
--   sem evidência nenhuma ........................  4.631
--
-- ⚠️  LEITURA DA CONFERÊNCIA — NÃO SE ASSUSTE COM ZERO.
--     Rodada HOJE, antes dos passes de mensagem, a conferência devolve
--     `resolvivel = 0` em praticamente toda org (verificado em Milennials,
--     SORVFOODS e Goletric Perdizes). Não é bug: hoje, thread que tem mensagem
--     com instância viva também já tem linha-resumo viva, e cai em
--     `colisao_com_viva` (Milennials: 173). O alvo do P3 só MATERIALIZA depois
--     que P0/P1/P1b criam instância viva em thread que não tinha nenhuma.
--     Conferência antes dos passes = 0. Conferência depois = os 3.363.
--     Se rodar o P3 e vier `UPDATE 0`, cheque se os passes anteriores rodaram
--     em TODOS os meses daquela org antes de concluir qualquer coisa.
--
-- DOIS GUARDAS, pelo mesmo motivo dos passes de mensagem — a PK acorda quando o
-- `instance_id` muda:
--
--   (a) COLISÃO COM LINHA VIVA — já existe (org, alvo, telefone) na tabela.
--       1.097 linhas. Não re-aponta e NÃO apaga nada: a linha viva já põe a
--       conversa na lista, então o objetivo já está cumprido. A órfã vira peso
--       morto invisível. (O RPC faz `DISTINCT ON (normalized_phone) ORDER BY
--       last_message_time DESC` sobre todos os ids do chip, então duas linhas do
--       mesmo telefone já colapsam em uma na leitura.)
--
--   (b) COLISÃO ENTRE DUAS ÓRFÃS — a mesma thread tem linha-resumo sob DUAS
--       instâncias mortas diferentes, e as duas resolvem para o mesmo alvo.
--       Medido: 1.081 threads assim, 2.263 linhas, pior caso 7 linhas numa
--       thread. Sem o `row_number()` o UPDATE aborta inteiro com 23505.
--       Vence a de `last_message_time` mais recente — a mesma que o
--       `DISTINCT ON` do RPC escolheria.
--
-- Idempotente: só toca linha cujo `instance_id` não existe mais. Reexecutar é
-- seguro; rode até `UPDATE 0`. Não é fatiado por mês — a tabela é pequena
-- (10.641 linhas no alvo) e a chave dela não tem data.

\echo '── P3: conferência do alvo para :org ──'
WITH morta AS (
  SELECT s.instance_id, s.normalized_phone, s.last_message_time
    FROM public.whatsapp_conversation_summary s
   WHERE s.organization_id = :'org'::uuid
     AND NOT EXISTS (SELECT 1 FROM public.whatsapp_instances i
                      WHERE i.id = s.instance_id)
),
ev AS (
  SELECT m.normalized_phone,
         count(DISTINCT m.instance_id) AS n,
         min(m.instance_id::text)::uuid AS alvo
    FROM public.whatsapp_messages m
   WHERE m.organization_id = :'org'::uuid
     AND m.instance_id IS NOT NULL
     AND m.normalized_phone IN (SELECT normalized_phone FROM morta)
     -- Existência NÃO basta: a instância-alvo tem que ser DA org. P0/P1/P1b tiram
     -- o alvo de `whatsapp_instances` já escopado por org; o P3 é o único que o
     -- deriva de `whatsapp_messages`, então a checagem de tenancy tem que ser
     -- explícita aqui — senão uma linha-resumo da org A poderia herdar instância
     -- da org B e o passe gravaria o vínculo cruzado.
     AND EXISTS (SELECT 1 FROM public.whatsapp_instances i
                  WHERE i.id = m.instance_id
                    AND i.organization_id = :'org'::uuid)
   GROUP BY 1
)
SELECT count(*) AS linhas_orfas,
       count(*) FILTER (WHERE e.n = 1 AND NOT EXISTS (
         SELECT 1 FROM public.whatsapp_conversation_summary t
          WHERE t.organization_id = :'org'::uuid AND t.instance_id = e.alvo
            AND t.normalized_phone = s.normalized_phone)) AS resolvivel,
       count(*) FILTER (WHERE e.n = 1 AND EXISTS (
         SELECT 1 FROM public.whatsapp_conversation_summary t
          WHERE t.organization_id = :'org'::uuid AND t.instance_id = e.alvo
            AND t.normalized_phone = s.normalized_phone)) AS colisao_com_viva,
       count(*) FILTER (WHERE e.n > 1)    AS ambigua,
       count(*) FILTER (WHERE e.n IS NULL) AS sem_evidencia
  FROM morta s
  LEFT JOIN ev e ON e.normalized_phone = s.normalized_phone;

\echo '── P3 ──'
WITH morta AS (
  SELECT s.instance_id, s.normalized_phone, s.last_message_time
    FROM public.whatsapp_conversation_summary s
   WHERE s.organization_id = :'org'::uuid
     AND NOT EXISTS (SELECT 1 FROM public.whatsapp_instances i
                      WHERE i.id = s.instance_id)
),
ev AS (
  SELECT m.normalized_phone,
         min(m.instance_id::text)::uuid AS alvo
    FROM public.whatsapp_messages m
   WHERE m.organization_id = :'org'::uuid
     AND m.instance_id IS NOT NULL
     AND m.normalized_phone IN (SELECT normalized_phone FROM morta)
     -- Existência NÃO basta: a instância-alvo tem que ser DA org. P0/P1/P1b tiram
     -- o alvo de `whatsapp_instances` já escopado por org; o P3 é o único que o
     -- deriva de `whatsapp_messages`, então a checagem de tenancy tem que ser
     -- explícita aqui — senão uma linha-resumo da org A poderia herdar instância
     -- da org B e o passe gravaria o vínculo cruzado.
     AND EXISTS (SELECT 1 FROM public.whatsapp_instances i
                  WHERE i.id = m.instance_id
                    AND i.organization_id = :'org'::uuid)
   GROUP BY 1
  HAVING count(DISTINCT m.instance_id) = 1          -- evidência ÚNICA, ou nada
),
cand AS (
  SELECT s.instance_id AS instancia_morta,
         s.normalized_phone,
         e.alvo,
         row_number() OVER (PARTITION BY s.normalized_phone, e.alvo             -- guarda (b)
                            ORDER BY s.last_message_time DESC) AS rn
    FROM morta s
    JOIN ev e ON e.normalized_phone = s.normalized_phone
   WHERE NOT EXISTS (                                                           -- guarda (a)
     SELECT 1 FROM public.whatsapp_conversation_summary t
      WHERE t.organization_id  = :'org'::uuid
        AND t.instance_id      = e.alvo
        AND t.normalized_phone = s.normalized_phone
   )
)
UPDATE public.whatsapp_conversation_summary t
   SET instance_id = c.alvo
  FROM cand c
 WHERE t.organization_id  = :'org'::uuid
   AND t.instance_id      = c.instancia_morta
   AND t.normalized_phone = c.normalized_phone
   AND c.rn = 1;


-- ─────────────────────────────────────────────────────────────────────────────
-- 9. CONFERÊNCIA DEPOIS
-- ─────────────────────────────────────────────────────────────────────────────
-- Ao fim de TODAS as orgs e TODOS os meses, `orfas_restantes` deve cair de
-- 385.829 para ~223.200 se o P2 NÃO rodar (caminho padrão), ou ~207.200 se ele
-- rodar. Se parou bem acima disso, sobrou org ou mês sem rodar — a consulta por
-- org abaixo mostra onde. Se caiu bem abaixo, algum passe pegou mais do que
-- devia: investigue antes de comemorar.

\echo '── órfãs restantes (global) ──'
SELECT count(*) AS orfas_restantes
  FROM public.whatsapp_messages
 WHERE instance_id IS NULL;

\echo '── órfãs restantes por org ──'
SELECT o.name,
       m.organization_id,
       count(*) AS orfas,
       (SELECT count(*) FROM public.whatsapp_instances i
         WHERE i.organization_id = m.organization_id) AS chips
  FROM public.whatsapp_messages m
  LEFT JOIN public.organizations o ON o.id = m.organization_id
 WHERE m.instance_id IS NULL
 GROUP BY 1, 2
 ORDER BY 3 DESC;

\echo '── sanidade: nenhuma linha pode ter sido atribuída a instância de OUTRA org ──'
-- Tem que voltar 0. Se voltar diferente de 0, houve vazamento cross-tenant e a
-- correção é urgente — cada passe casa dentro da org, então isto não deveria
-- acontecer nunca.
--
-- Escopado em :org de propósito. A versão global (sem o filtro de org) faz join
-- de 2,3M linhas contra `whatsapp_instances` e estoura o statement_timeout —
-- medido. Rode este SELECT uma vez por org processada.
SELECT count(*) AS cross_tenant
  FROM public.whatsapp_messages m
  JOIN public.whatsapp_instances i ON i.id = m.instance_id
 WHERE m.organization_id = :'org'::uuid
   AND i.organization_id <> m.organization_id;

\echo '── P3: linhas-resumo ainda apontando para instância morta (global) ──'
-- Parte de 10.641. Deve cair ~3.363 (mais o que a Alamaster render, não medida).
-- O resto NÃO é falha: 1.097 são colisão com linha viva (a conversa já está na
-- lista, o objetivo já está cumprido), 787 são ambíguas e 4.631 não têm
-- evidência nenhuma — as três classes ficam como estão, de propósito.
SELECT count(*) AS resumo_orfao_restante,
       count(DISTINCT s.instance_id)     AS instancias_mortas,
       count(DISTINCT s.organization_id) AS orgs
  FROM public.whatsapp_conversation_summary s
 WHERE NOT EXISTS (SELECT 1 FROM public.whatsapp_instances i
                    WHERE i.id = s.instance_id);

\echo '── sanidade P3: nenhuma linha-resumo pode ter ido para instância de OUTRA org ──'
-- Tem que voltar 0. A tabela-resumo é pequena, então esta roda global.
SELECT count(*) AS resumo_cross_tenant
  FROM public.whatsapp_conversation_summary s
  JOIN public.whatsapp_instances i ON i.id = s.instance_id
 WHERE i.organization_id <> s.organization_id;
