-- ============================================================================
-- Lead ↔ Negócio, fatia 2 — PONTO DE NÃO-RETORNO: N negócios por lead no MESMO
-- funil. Depois deste arquivo, recompra existe.
--
-- Três cadeados impedem hoje que o mesmo lead tenha duas entries no mesmo funil.
-- Todos os três foram lidos em PROD (`jsjsmuncfkbsbzqzqhfq`, leitura auditada,
-- 2026-07-31) — a FORMA de cada um foi conferida porque muda o DDL do drop:
--
--   1. `uq_pipeline_entries_pipeline_lead`  — pg_constraint.contype='u',
--      `UNIQUE (pipeline_id, lead_id)`, índice de suporte homônimo, NÃO parcial.
--      → `ALTER TABLE ... DROP CONSTRAINT` (DROP INDEX recusaria: "cannot drop
--        index ... because constraint ... requires it").
--   2. `idx_pipeline_entries_pipeline_lead` — índice único PARCIAL **nu**
--      (`WHERE lead_id IS NOT NULL`), sem linha em pg_constraint.
--      → `DROP INDEX`.
--   3. `custom_pipe_entries_pipeline_id_lead_id_key` — pg_constraint.contype='u',
--      `UNIQUE (pipeline_id, lead_id)`, não parcial.
--      → `ALTER TABLE ... DROP CONSTRAINT`.
--
-- OS TRÊS ESTÃO NO PLANO, com destaque — o mérito de enumerá-los é dele, não deste
-- arquivo. Vault `Obsidian/.../08 — Backlog/em-progresso/lead-negocio-migrations-db.md`:
-- linha 35 lista o terceiro na tabela de estado medido; linhas 70-84 são o callout
-- "São TRÊS cadeados, não dois — e não um"; linhas 95-96 trazem o DDL do drop e
-- 102-107 o rollback. `.specs/features/lead-negocio-separacao/spec.md:127` repete.
-- ⚠️ Uma versão anterior DESTE cabeçalho afirmava que o terceiro "não estava no
-- plano do vault". Era falso e foi escrito sem abrir o vault. Fica registrado aqui
-- porque migration é imutável e a tarefa "corrigir os documentos que mentem" não
-- pode ler esta frase e sair "corrigindo" um plano que já estava certo.
--
-- O terceiro é o que destrava recompra em funil CUSTOM. Sem ele, a fatia 2 entrega
-- recompra só nos 3 funis de sistema e o funil custom — que é onde as orgs modelam
-- reativação/upsell — continua travado em 1 card por lead.
--
-- POR QUE OS TRÊS NA MESMA TRANSAÇÃO, e não um por vez
-- ----------------------------------------------------------------------------
-- `custom_pipe_entries` é espelhada em `pipeline_entries` pelo trigger
-- `trg_sync_custom_pipe_to_entries` (medido em prod 2026-07-31: 16.195 das 36.727
-- linhas de `pipeline_entries` têm `id` igual ao de uma linha de
-- `custom_pipe_entries` — 16.195 de 16.195, ou seja TODA entry custom também vive
-- em `pipeline_entries`. Base viva: os totais sobem alguns por dia; o que não
-- oscila é a relação de inclusão). Dropar só o cadeado (3) faria a segunda entry
-- custom de um lead explodir 23505 contra o cadeado (1) dentro do trigger —
-- recompra pareceria "implementada e quebrada". Os três caem juntos ou não caem.
--
-- ⚠️ ORDEM DELIBERADA: as funções são reescritas ANTES dos drops.
-- O `db push` roda o arquivo em transação, então a ordem não muda o resultado
-- commitado. Ela importa se alguém executar o arquivo statement-a-statement
-- (psql sem `-1`): reescrevendo primeiro, nunca existe um instante em que os
-- cadeados sumiram e as funções ainda dizem ON CONFLICT.
--
-- Só schema, ACL e corpo de função. Nenhuma linha de dado de cliente é lida,
-- escrita ou movida por esta migration. (Guarda F4: se a URL do push estiver
-- errada, o pior caso é erro de schema recuperável, nunca mudança de dado.)
-- ============================================================================


-- ── 1. Reescrita dos DOIS `bulk_*` (bloqueante, não é "melhoria") ───────────
--
-- `bulk_move_stage` e `bulk_add_to_custom_pipe` usam
-- `ON CONFLICT (pipeline_id, lead_id) DO UPDATE`. Inferência por LISTA DE
-- COLUNAS exige um índice único que as cubra; no instante em que a seção 2
-- roda, as duas passam a levantar em runtime:
--
--     42P10 — there is no unique or exclusion constraint matching the
--             ON CONFLICT specification
--
-- Não é degradação silenciosa: é erro duro na cara do usuário. As duas são
-- disparadas pelo MESMO diálogo (`BulkMoveDialog` em
-- `src/modules/leads/components/bulk-actions/BulkActionBar.tsx:159-177`, via
-- `useBulkMoveStage` / `useBulkMoveToCustomPipe` em
-- `src/modules/leads/hooks/useBulkActions.ts:12,39`), e a barra é montada em
-- 5 telas (medido por grep em `src/`): `leads/pages/Leads.tsx`,
-- `pipelines/pages/PipeWhatsapp.tsx`, `PipeConfirmacao.tsx`, `PipePropostas.tsx`
-- e `pipelines/components/custom/CustomPipelineKanban.tsx`.
--
-- Detalhe que quase passa: dropar SÓ a constraint (1) não bastaria. O índice (2)
-- é PARCIAL, e índice parcial só serve de arbiter se o `ON CONFLICT` repetir o
-- predicado (`... WHERE lead_id IS NOT NULL`), o que estas funções não fazem.
-- Hoje quem arbitra é o índice não-parcial da constraint (1); com ele fora e o
-- (2) vivo, o 42P10 aconteceria do mesmo jeito.
--
-- 🔴 `ON CONFLICT (id)` NÃO É CONSERTO. `id` tem `default gen_random_uuid()`
-- nas duas tabelas (baseline `20260101000000`), então cada execução propõe um id
-- inédito, o arbiter nunca dispara, e "mover" viraria "criar card novo em
-- silêncio". E também não dá para "reusar o id já conhecido no laço": esse id NÃO
-- EXISTE — os DECLARE lidos em prod via `pg_get_functiondef` declaram apenas
-- `v_is_master`, `v_member_org`, `v_lead_id`, `v_lead_org` (+ `v_pipeline_id` em
-- `bulk_move_stage`). Nenhuma variável guarda entry id, e nenhum SELECT busca uma.
--
-- ⚠️ Crédito, para não inverter o registro: as duas refutações acima JÁ ESTÃO no
-- plano — vault `lead-negocio-migrations-db.md:171-191`, callout "Os dois consertos
-- que este doc sugeria são INVÁLIDOS — medido", que escreve textualmente
-- "`ON CONFLICT (id)` é pior que o bug" (:178) e "o id **não** é conhecido" (:172).
-- Elas estão repetidas aqui porque quem lê a migration não tem o vault aberto, não
-- porque este arquivo as tenha descoberto. (Versão anterior deste parágrafo dizia
-- "o plano do vault sugere isso" — inverte o que o documento diz hoje.)
--
-- 🎯 SEMÂNTICA — decidida pelo CTO em 2026-07-31, não é escolha desta migration:
--    quando um lead tiver N negócios no MESMO funil, mover em massa move TODOS.
--    Não "só o mais recente", não recusar, não pedir desambiguação.
--
--    Consequência 1: **bulk move deixa de poder mirar um negócio específico.**
--    Quem quiser mover um só usa o card no Kanban. Preserva a assinatura atual,
--    que recebe `p_lead_ids` e não entry_ids — mirar um negócio exigiria trocar a
--    assinatura e os 2 call sites, o que não é esta fatia.
--
--    ⚠️ NÃO chamar isso de "o comportamento seguro". Uma versão anterior deste
--    cabeçalho chamava; a frase não se sustenta contra as duas cadeias abaixo, que
--    foram medidas em prod DEPOIS de ela ter sido escrita. "TODOS" inclui negócio
--    FECHADO, e o troco é estorno irreversível de receita.
--
--    ── Consequência 2: ESTORNO DE VENDA em negócio que o usuário não mirou ──────
--    Cadeia completa, lida em prod (`pg_get_triggerdef` + `pg_get_functiondef`,
--    2026-07-31) — ela é invisível para quem lê só as duas funções:
--
--      UPDATE pipeline_entries.stage_key
--        → trg_pipeline_entries_stage_event_update
--          (AFTER UPDATE OF stage_key, WHEN old.stage_key IS DISTINCT FROM
--           new.stage_key AND new.lead_id IS NOT NULL)
--        → fn_capture_pipeline_stage_event  → INSERT em `pipeline_stage_events`
--          com source='trigger'
--        → trg_pipeline_stage_events_sale_capture (AFTER INSERT WHEN source='trigger')
--        → fn_capture_sale_event
--
--    `fn_capture_sale_event` escopa o estorno por **LEAD + FUNIL**, nunca por entry:
--      SELECT s.* FROM sale_events s
--       WHERE s.lead_id = NEW.lead_id AND s.pipeline_id = NEW.pipeline_id
--         AND s.event_type = 'sale'
--         AND NOT EXISTS (... 'sale_reversed' ... reversed_event_id = s.id)
--       ORDER BY s.sold_at DESC, s.created_at DESC LIMIT 1
--    → e insere `sale_reversed` quando `from_role = 'won'` e `to_role <> 'won'`.
--    `sale_events` é IMUTÁVEL (`trg_sale_events_immutable`, BEFORE DELETE OR UPDATE):
--    o estorno não tem desfazer, só compensação por venda fabricada. No mesmo
--    caminho, `enforce_closed_at_on_final_stage` zera o `closed_at` do negócio que
--    saiu de vendido/perdido. O funil CUSTOM chega no mesmo lugar:
--    `trg_sync_custom_pipe_to_entries` espelha o UPDATE em `pipeline_entries` e
--    reentra nesta mesma cadeia.
--
--    Medido em prod 2026-07-31: `sale_events` tem 273 `sale` e 14 `sale_reversed`
--    (13 com source='trigger' — o caminho é vivo, não teórico); 819 entries com
--    `closed_at` preenchido, 222 delas em `vendido`; e 96 orgs mapeiam
--    `pipeline_stages.stage_key='vendido'` → `stage_role='won'`, que é o que
--    `metric_stage_role` lê. Ou seja: não é caso de borda de uma org.
--
--    Hoje isso é ESTRUTURALMENTE IMPOSSÍVEL — o cadeado garante 1 entry por funil,
--    então o card em `vendido` é exatamente o que o usuário escolheu mover. É esta
--    migration que torna possível, e no cenário CANÔNICO da fatia 2: lead com
--    negócio #1 `vendido` (venda histórica) + negócio #2 aberto (recompra) no mesmo
--    funil. O usuário mira o negócio aberto e leva a venda antiga junto, sem sinal
--    nenhum — a RPC retorna `void` (`useBulkActions.ts:12,39`) e a UI não mostra
--    contagem de quantos negócios andaram.
--
--    🟠 NÃO MEDIDO / EM ABERTO: a decisão do CTO foi sobre QUAIS negócios andam.
--    Ninguém levou a ele que "todos" inclui os fechados e que o troco é estorno
--    irreversível. Este arquivo implementa a decisão como ela foi registrada — não
--    inventa uma nova. Se a decisão mudar depois de ler isto, a blindagem é de duas
--    linhas e cabe numa migration nova: `AND pe.closed_at IS NULL` no UPDATE de
--    `bulk_move_stage`, e o equivalente em `bulk_add_to_custom_pipe` (excluir entry
--    cuja etapa tenha `stage_role` won/lost em `custom_pipeline_stages`). O gate do
--    INSERT em `v_movidos = 0` continua valendo, e o efeito colateral é exatamente
--    a semântica de recompra: lead cujo único negócio está vendido ganha negócio
--    NOVO em vez de ter a venda reaberta.
--
--    ── Consequência 3: FAN-OUT DE AUTOMAÇÃO, N disparos por lead ───────────────
--    Os três gatilhos abaixo são FOR EACH ROW e todos TÊM guarda de mudança de
--    valor (nenhum dispara se a etapa já era a alvo) — mas passam a rodar uma vez
--    por NEGÓCIO que mudou de etapa, onde antes o cadeado garantia no máximo um:
--      • `trg_workflow_pipeline_stage_changed` (WHEN old.stage_key IS DISTINCT FROM
--        new.stage_key) → `net.http_post` de `fire_trigger`/`stage_changed` com
--        `NEW.lead_id`. N linhas = N POSTs para o MESMO lead.
--      • `trg_workflow_custom_pipe_stage_change` (guarda interna
--        `OLD.stage_id IS DISTINCT FROM NEW.stage_id`) → `fire_workflow_trigger`
--        por linha, também com `NEW.lead_id`.
--      • `trg_pipeline_entries_dispatch` deduplica por
--        `scheduled_pipe_messages.pipe_record_id = NEW.id` — o id da **ENTRY**, não
--        do lead. Com 2 entries a chave de dedup difere e viram 2 sequências de
--        disparo independentes para o mesmo cliente.
--    Se a org tiver workflow `stage_changed` com nó de envio, isso é mensagem de
--    WhatsApp duplicada, multiplicada pelo número de negócios. 🟠 NÃO MEDIMOS
--    quantas orgs têm workflow `stage_changed` com envio ativo. O repo tem
--    histórico documentado de chip banido (Meta 463) por disparo duplicado/frio,
--    então o custo do erro não é hipotético.
--
--    🟠 ISSUE A ABRIR (não cabe nesta migration, é mudança de comportamento de
--    métrica e de automação): escopar por ENTRY o que hoje é escopado por LEAD —
--    o estorno de `fn_capture_sale_event` e a dedup do fire_trigger. O dado para
--    isso já é gravado e simplesmente não é usado no match: `pipeline_stage_events`
--    tem `entry_id` e `sale_events` tem `stage_event_id`.
--
-- FORMA DO CONSERTO: `UPDATE` explícito (que agora casa N linhas por desenho)
-- seguido de `INSERT` condicional quando o UPDATE não casou nada.
--
-- ⚠️ Armadilha do `IF NOT FOUND`: com N linhas a semântica muda de sentido.
-- `FOUND` após UPDATE é true para QUALQUER número ≥ 1 — então `IF NOT FOUND`
-- depois de um UPDATE que casou 3 linhas **não dispara**, que por acaso é o que
-- queremos. Usamos `GET DIAGNOSTICS ... ROW_COUNT` mesmo assim, por dois
-- motivos: (a) `FOUND` é global do bloco e é reescrito por `SELECT INTO`,
-- `PERFORM` e `EXECUTE` — e o laço tem SELECT INTO antes do UPDATE, então ler
-- `FOUND` obriga o leitor a provar que nada o tocou no meio; (b) ROW_COUNT diz
-- QUANTAS, que é a grandeza que a decisão do CTO tornou relevante.
--
-- ⚠️ Corrida agora possível, declarada e aceita: pré-check + INSERT são duas
-- viagens sem lock. Antes, o unique fechava a janela. Depois desta migration,
-- duas chamadas concorrentes para o mesmo par podem inserir duas entries. Isso é
-- a fatia 2 removendo a garantia de unicidade **por desenho** — "exatamente um"
-- passa a ser problema do negócio (`deals`), não deste par de colunas. NÃO
-- medimos frequência dessa corrida em prod; nenhuma trava foi adicionada aqui
-- porque adicionar lock no meio de um FOREACH sobre array de leads introduz
-- ordem de aquisição e risco de deadlock que esta fatia não precisa pagar.
--
-- PRESERVADO VERBATIM do corpo lido em prod (nada aqui é "limpeza"):
--   • `SECURITY DEFINER` + `SET search_path TO 'public', 'pg_temp'`
--   • `RETURNS void`, mesma assinatura, mesmos nomes de parâmetro
--   • checagem de master via `public.is_master_user()`
--   • pin de org do membro em `team_members` (+ `RAISE EXCEPTION` quando não há
--     vínculo ativo)
--   • resolução da org POR LEAD (nunca confia em org vinda de input) e o
--     `CONTINUE` silencioso para lead inexistente/deletado/sem permissão
--   • validação de pipeline/etapa alvo e seus `CONTINUE`
--   • comentários originais (inclusive sem acento, como estavam)
--
-- `CREATE OR REPLACE` (e não DROP + CREATE) de propósito: a assinatura não muda
-- e o REPLACE **preserva o ACL**. DROP + CREATE zeraria os grants e os
-- recriaria pelo `ALTER DEFAULT PRIVILEGES` do projeto, que concede a `anon` —
-- ou seja, DROP + CREATE REABRIRIA exatamente o buraco que a seção 1b fecha.
-- O ACL só muda onde a gente manda mudar, explicitamente, na 1b.
--
-- HERDADO, mas FECHADO AQUI (seção 1b, logo depois da segunda função):
-- medido em prod 2026-07-31, `bulk_add_to_custom_pipe` tem EXECUTE para PUBLIC e
-- para `anon` (`proacl = {=X/postgres,postgres=X/postgres,anon=X/postgres,
-- authenticated=X/postgres,service_role=X/postgres}`), enquanto `bulk_move_stage`
-- não tem (`{postgres=X,authenticated=X,service_role=X}`). Mesma impressão digital
-- do caso `import_lead_into_custom_pipeline` (2026-07-29).
--
-- O alcance real hoje é NULO, e isso foi verificado, não presumido:
-- `is_master_user(_user_id uuid DEFAULT auth.uid())` faz `RETURN EXISTS (...)` —
-- nunca devolve NULL (se devolvesse, o `IF NOT v_is_master` seria pulado em
-- silêncio). Com `anon`, `auth.uid()` é NULL, `is_master_user()` é false, o pin de
-- org não acha nada e a função morre no `RAISE EXCEPTION 'No active organization
-- membership'` antes de tocar em qualquer tabela.
--
-- Mesmo assim o grant sai. Não é escopo-creep gratuito: (a) esta migration já tem
-- a função aberta em `CREATE OR REPLACE`, então fechar custa 2 linhas agora e uma
-- migration inteira depois; (b) é uma SECURITY DEFINER que escreve em tabela de
-- tenant, exposta à anon key que vive no bundle do frontend; (c) a regra do repo é
-- explícita de que os dois grants chegam por caminhos DIFERENTES — o implícito via
-- `PUBLIC` (toda função nasce com ele) e o nominal via `ALTER DEFAULT PRIVILEGES`
-- — e revogar de um lado só deixa a função aberta pelo outro. Por isso os DOIS
-- REVOKE, sempre. `authenticated` e `service_role` têm grant nominal próprio
-- (visível no proacl acima) e não são afetados.
--
-- Confirmado que ninguém legítimo perde acesso: os únicos chamadores são
-- `useBulkActions.ts:12,39` (client logado = `authenticated`) e
-- `tests/integration/bulk-add-to-custom-pipe.test.ts` (service client). Nenhuma
-- edge function chama a RPC. Com o REVOKE aplicado, a checagem 4d passa a ABORTAR
-- se `anon` ainda executar qualquer uma das duas — verificação que vale, em vez de
-- um NOTICE que ninguém lê.

CREATE OR REPLACE FUNCTION public.bulk_move_stage(
  p_lead_ids uuid[],
  p_target_pipe text,
  p_target_stage text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_master   boolean := public.is_master_user();
  v_member_org  uuid;
  v_lead_id     uuid;
  v_lead_org    uuid;
  v_pipeline_id uuid;
  v_movidos     integer;
BEGIN
  -- Membros: pinam a propria org. Master: sem pin (escopo limitado por p_lead_ids).
  IF NOT v_is_master THEN
    SELECT tm.organization_id INTO v_member_org
    FROM public.team_members tm
    WHERE tm.user_id = auth.uid() AND tm.is_active = true
    LIMIT 1;

    IF v_member_org IS NULL THEN
      RAISE EXCEPTION 'No active organization membership';
    END IF;
  END IF;

  FOREACH v_lead_id IN ARRAY p_lead_ids LOOP
    -- Org do lead + autorizacao (membro: so a propria org; master: qualquer org)
    SELECT l.organization_id INTO v_lead_org
    FROM public.leads l
    WHERE l.id = v_lead_id
      AND l.deleted_at IS NULL
      AND (v_is_master OR l.organization_id = v_member_org);

    IF v_lead_org IS NULL THEN
      CONTINUE;  -- inexistente, deletado, ou sem permissao
    END IF;

    -- Pipeline de sistema alvo, dentro da org do lead
    SELECT p.id INTO v_pipeline_id
    FROM public.pipelines p
    WHERE p.slug = p_target_pipe
      AND p.organization_id = v_lead_org
      AND p.type = 'system' -- metric-lint-allow: predicado PRESERVADO verbatim da função original, e não é filtro de métrica — é o roteamento entre as duas RPCs: bulk_move_stage resolve os 3 funis de sistema por slug, funil custom tem RPC própria (bulk_add_to_custom_pipe, por pipeline_id). Parametrizar aqui mudaria o contrato da função, fora do escopo desta fatia.
    LIMIT 1;

    IF v_pipeline_id IS NULL THEN
      CONTINUE;
    END IF;

    -- MOVE TODOS os negócios do lead nesse funil (decisão CTO 2026-07-31).
    -- Casar N linhas aqui é o comportamento pretendido, não um efeito colateral.
    -- O filtro por organization_id é redundante com a resolução de v_pipeline_id
    -- (o pipeline já foi buscado dentro de v_lead_org) e é defesa em
    -- profundidade contra linha com org divergente; medido em prod 2026-07-31:
    -- 0 linhas de pipeline_entries com organization_id ≠ org do lead (`IS
    -- DISTINCT FROM`, não `<>`, para não mascarar NULL — e a coluna é NOT NULL
    -- nas duas tabelas), então o filtro não esconde nenhuma linha existente.
    -- `closed_at IS NULL`: move todos os negócios ABERTOS do lead, nunca os
    -- fechados (decisão CTO 2026-07-31, revendo o "todos" da véspera).
    --
    -- Por que o fechado fica de fora, medido em prod 2026-07-31: tirar um
    -- negócio da etapa de ganho estorna a venda, e o estorno é IRREVERSÍVEL.
    -- A cadeia é UPDATE de stage_key → `trg_pipeline_entries_stage_event_update`
    -- → `fn_capture_pipeline_stage_event` → `trg_pipeline_stage_events_sale_capture`
    -- → `fn_capture_sale_event`, que em `from_role = 'won' AND to_role <> 'won'`
    -- insere `sale_reversed` — e casa a venda original por
    -- `lead_id + pipeline_id`, NUNCA por entry. `trg_sale_events_immutable`
    -- (BEFORE DELETE OR UPDATE) impede desfazer. Exposição medida: 217 cards em
    -- etapa ganha, 217 leads, 23 orgs, 273 vendas no ledger. Sem este filtro,
    -- um arraste em massa mexeria no painel de receita de terceiros.
    UPDATE public.pipeline_entries pe
       SET stage_key        = p_target_stage,
           stage_changed_at = now(),
           updated_at       = now()
     WHERE pe.pipeline_id     = v_pipeline_id
       AND pe.lead_id         = v_lead_id
       AND pe.organization_id = v_lead_org
       AND pe.closed_at IS NULL;

    GET DIAGNOSTICS v_movidos = ROW_COUNT;

    -- Cria quando o lead não tem nenhum negócio ABERTO neste funil — o que
    -- inclui o caso "só tem negócio fechado". Isso é recompra, e é a feature
    -- funcionando: o negócio ganho de março fica intacto no histórico e a
    -- movimentação de hoje abre um segundo negócio. Antes do drop dos cadeados
    -- isso era impossível, e o upsert resolvia em UPDATE do card fechado —
    -- que é exatamente o caminho que estornava a venda.
    --
    -- Frequência de trigger, dito com precisão (medido em `pg_trigger`, prod
    -- 2026-07-31) — a afirmação larga "o volume de triggers de INSERT não muda"
    -- estava numa versão anterior deste comentário e é falsa pela metade:
    --   • AFTER INSERT (`trg_pipeline_entries_stage_event_insert`): frequência
    --     IDÊNTICA. Com conflito o Postgres já disparava AFTER UPDATE, nunca
    --     AFTER INSERT — o caminho não muda.
    --   • BEFORE INSERT (`trg_pe_snapshot_responsibles`;
    --     `trg_enforce_closed_at` é BEFORE INSERT OR UPDATE OF stage_key):
    --     disparavam para toda linha PROPOSTA, inclusive quando o upsert anterior
    --     resolvia em UPDATE. Agora só disparam no INSERT de verdade — o volume
    --     CAI. Sem efeito observável hoje: li as duas funções em prod e ambas só
    --     mutam `NEW`, que era descartado no caminho de conflito. Quem adicionar
    --     um BEFORE INSERT com efeito colateral externo (escrita em outra tabela,
    --     http_post) precisa saber disso e não pode ler "a reescrita foi neutra".
    --   • UPDATE: aí sim a frequência MUDA por desenho — passa a ser 1 por
    --     negócio do lead neste funil, não 1 por lead. Ver "Consequência 3" no
    --     cabeçalho (fan-out de `stage_changed` e de dispatch).
    IF v_movidos = 0 THEN
      INSERT INTO public.pipeline_entries (
        organization_id, pipeline_id, lead_id, stage_key, stage_changed_at, entered_at
      ) VALUES (
        v_lead_org, v_pipeline_id, v_lead_id, p_target_stage, now(), now()
      );
    END IF;
  END LOOP;
END;
$function$;


CREATE OR REPLACE FUNCTION public.bulk_add_to_custom_pipe(
  p_lead_ids uuid[],
  p_pipeline_id uuid,
  p_stage_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_master  boolean := public.is_master_user();
  v_member_org uuid;
  v_lead_id    uuid;
  v_lead_org   uuid;
  v_movidos    integer;
BEGIN
  -- Membros: pinam a propria org. Master: sem pin (escopo limitado por p_lead_ids).
  IF NOT v_is_master THEN
    SELECT tm.organization_id INTO v_member_org
    FROM public.team_members tm
    WHERE tm.user_id = auth.uid() AND tm.is_active = true
    LIMIT 1;

    IF v_member_org IS NULL THEN
      RAISE EXCEPTION 'No active organization membership';
    END IF;
  END IF;

  FOREACH v_lead_id IN ARRAY p_lead_ids LOOP
    -- Org do lead + autorizacao (membro: so a propria org; master: qualquer org)
    SELECT l.organization_id INTO v_lead_org
    FROM public.leads l
    WHERE l.id = v_lead_id
      AND l.deleted_at IS NULL
      AND (v_is_master OR l.organization_id = v_member_org);

    IF v_lead_org IS NULL THEN
      CONTINUE;  -- inexistente, deletado, ou sem permissao
    END IF;

    -- Funil custom alvo deve pertencer a org do lead e estar ativo
    IF NOT EXISTS (
      SELECT 1 FROM public.custom_pipelines cp
      WHERE cp.id = p_pipeline_id
        AND cp.organization_id = v_lead_org
        AND cp.is_active = true
    ) THEN
      CONTINUE;
    END IF;

    -- Etapa alvo deve pertencer ao funil
    IF NOT EXISTS (
      SELECT 1 FROM public.custom_pipeline_stages cps
      WHERE cps.id = p_stage_id
        AND cps.pipeline_id = p_pipeline_id
    ) THEN
      CONTINUE;
    END IF;

    -- Move todos os negócios ABERTOS do lead nesse funil (decisão CTO
    -- 2026-07-31). Medido em prod 2026-07-31: 0 linhas de custom_pipe_entries
    -- com organization_id ≠ org do lead, então o filtro de org não esconde
    -- linha existente.
    --
    -- `custom_pipe_entries` NÃO tem `closed_at` (medido: 0 colunas), então
    -- "fechado" aqui só pode vir do papel da etapa. E hoje o filtro é
    -- DEFENSIVO, não ativo: `custom_pipeline_stages.stage_role` em prod tem
    -- apenas `open`, `meeting_booked` e `meeting_held` — nenhum `won`/`lost`,
    -- logo 0 entries custom em etapa fechada. Fica escrito para o dia em que
    -- alguém criar uma etapa de ganho num funil custom, porque aí o espelho em
    -- `pipeline_entries` passa a alcançar a mesma cadeia de estorno.
    UPDATE public.custom_pipe_entries ce
       SET stage_id         = p_stage_id,
           stage_changed_at = now(),
           updated_at       = now()
     WHERE ce.pipeline_id     = p_pipeline_id
       AND ce.lead_id         = v_lead_id
       AND ce.organization_id = v_lead_org
       AND NOT EXISTS (
         SELECT 1
         FROM public.custom_pipeline_stages cs
         WHERE cs.id = ce.stage_id
           AND cs.stage_role IN ('won', 'lost')
       );

    GET DIAGNOSTICS v_movidos = ROW_COUNT;

    -- Mesma condição do upsert anterior: só insere quando não havia nada.
    -- Importa porque INSERT em custom_pipe_entries dispara
    -- `trg_workflow_custom_pipe_entry` (medido: AFTER INSERT), que re-emite
    -- lead_created sem origin no contexto — armadilha conhecida de envio em massa.
    --
    -- Escopo exato da afirmação, porque aqui do lado tem uma armadilha de envio e
    -- imprecisão custa caro: a frequência de **AFTER INSERT** não muda (com
    -- conflito o Postgres já disparava AFTER UPDATE, não AFTER INSERT), logo ESTA
    -- armadilha não é ampliada. O que MUDA é o caminho de **UPDATE**: passa a ser
    -- 1 disparo por negócio do lead neste funil, não 1 por lead — ver
    -- "Consequência 3" no cabeçalho. Uma versão anterior deste comentário concluía
    -- "o risco não é ampliado aqui" sem essa distinção; era falso por omissão, e
    -- falso justamente na direção que a decisão "mover TODOS" cria.
    IF v_movidos = 0 THEN
      INSERT INTO public.custom_pipe_entries (
        organization_id, pipeline_id, lead_id, stage_id, entered_at, stage_changed_at
      ) VALUES (
        v_lead_org, p_pipeline_id, v_lead_id, p_stage_id, now(), now()
      );
    END IF;
  END LOOP;
END;
$function$;


-- ── 1b. Fechar o grant herdado de `bulk_add_to_custom_pipe` ─────────────────
-- As DUAS metades, porque chegam por caminhos diferentes e revogar uma só deixa
-- a função aberta pela outra (ver nota HERDADO na seção 1). `authenticated` e
-- `service_role` têm grant nominal próprio e continuam executando — a checagem
-- 4d aborta se `authenticated` perder acesso.
-- `bulk_move_stage` já não tinha nenhum dos dois; os REVOKE abaixo são inertes
-- para ela e ficam explícitos mesmo assim, para que a intenção não dependa de o
-- próximo leitor lembrar qual das duas estava aberta.
REVOKE ALL     ON FUNCTION public.bulk_add_to_custom_pipe(uuid[], uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bulk_add_to_custom_pipe(uuid[], uuid, uuid) FROM anon;
REVOKE ALL     ON FUNCTION public.bulk_move_stage(uuid[], text, text)         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bulk_move_stage(uuid[], text, text)         FROM anon;


-- ── 2. Os três cadeados ─────────────────────────────────────────────────────
-- `IF EXISTS` para o arquivo ser re-executável; a seção 4 é quem prova o
-- resultado. `RESTRICT` implícito (sem CASCADE) de propósito: se algo depender
-- do objeto, a migration falha em vez de derrubar o dependente junto.
--
-- ⚠️ `lock_timeout` antes dos drops. `ALTER TABLE ... DROP CONSTRAINT` e
-- `DROP INDEX` tomam ACCESS EXCLUSIVE em `pipeline_entries` (36.727 linhas
-- medidas em 2026-07-31, a tabela mais quente do produto) e em
-- `custom_pipe_entries` (16.195), e o `db push` roda o arquivo em transação — o
-- lock fica retido até o COMMIT, portanto também durante o bloco DO da seção 4.
-- Sem timeout, uma transação longa concorrente faz o ALTER esperar
-- indefinidamente e enfileirar TODO o tráfego de escrita da tabela atrás dele.
-- Falhar rápido e reaplicar é estritamente melhor.
-- 🟠 Os 10s são ESCOLHA, não medição: não medimos a duração real destes drops.
-- Precedente do repo: `archive/20261119000011_rls_wrap_initplan_hot_tables.sql`
-- foi aplicada em prod sob carga com `lock_timeout='20s'`, uma tabela por
-- transação, depois de a versão single-transaction ter DEADLOCKADO. Aqui os três
-- drops têm de cair juntos (ver cabeçalho), então não há a saída de fatiar por
-- tabela: se estourar, o certo é reaplicar em janela mais calma, não afrouxar.
-- Em branch efêmera (o alvo desta migration) não há concorrência e o timeout é
-- inerte — ele existe para o dia do apply em prod.
-- (Nenhuma dependência impede os drops: nenhuma FK referencia o par — só há FKs
-- para `pipeline_entries(id)` — e `relreplident='d'` nas duas tabelas, então
-- nenhum dos índices é REPLICA IDENTITY.)
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.pipeline_entries
  DROP CONSTRAINT IF EXISTS uq_pipeline_entries_pipeline_lead;

DROP INDEX IF EXISTS public.idx_pipeline_entries_pipeline_lead;

ALTER TABLE public.custom_pipe_entries
  DROP CONSTRAINT IF EXISTS custom_pipe_entries_pipeline_id_lead_id_key;


-- ── 3. Outros consumidores da chave (pg_proc + código) ──────────────────────
--
-- Varredura feita, não presumida:
--   • `pg_proc.prosrc ~* 'on\s+conflict\s*\(\s*pipeline_id\s*,\s*lead_id\s*\)'`
--     em TODOS os schemas de prod → exatamente 2 acertos, os dois reescritos
--     acima. São os mesmos DOIS que o plano nomeia (vault
--     `lead-negocio-migrations-db.md:151-169`, callout "São DOIS consumidores, não
--     um — e saem do mesmo botão", com tabela `bulk_move_stage` ×
--     `bulk_add_to_custom_pipe`). A varredura confirma o plano; não o corrige.
--     (Versão anterior desta linha dizia "o plano do vault dizia 'um só'; eram
--     dois" — falso, e inverteria o registro para quem for revisar os documentos.)
--   • `pg_proc.prosrc` citando qualquer um dos 3 nomes dropados → 0 acertos,
--     logo não existe `ON CONFLICT ON CONSTRAINT <nome>` escondido.
--   • grep por `onConflict` em `supabase/functions/` → nenhum usa
--     `pipeline_id,lead_id`.
--
-- ⚠️ LIMITE DECLARADO DESTA VARREDURA: ela procura `ON CONFLICT` e os 3 nomes.
-- Ela NÃO acha quem apenas ASSUME "1 entry por (lead, funil)" sem citar nenhum
-- dos dois. Os consumidores desse tipo achados depois estão em (g); a lista não
-- é provada exaustiva.
--
-- Consumidores que NÃO quebram mas MUDAM de comportamento — listados aqui
-- porque migration é imutável e o próximo leitor precisa achar isso escrito:
--
--   (a) `public.merge_leads(uuid, uuid)` — descobre por catálogo os índices
--       ÚNICOS que contêm a FK `lead_id` e pré-deleta as linhas do lead mesclado
--       que colidiriam. Com os 3 cadeados fora, `pipeline_entries` e
--       `custom_pipe_entries` deixam de aparecer nessa varredura: nada é
--       pré-deletado e o segundo laço (UPDATE ... SET lead_id = keep) passa a
--       ACUMULAR as entries do lead mesclado no lead mantido. Mesclar dois
--       duplicados que estavam no mesmo funil deixa de resultar em 1 card e
--       passa a resultar em 2 negócios. Não é erro — é a nova semântica batendo
--       num fluxo que ninguém revisou. NÃO tratado aqui: mudar merge_leads é
--       decisão de produto (dois cards de um cadastro duplicado provavelmente
--       deveriam fundir, não coexistir).
--
--   (b) `public.sync_custom_pipe_to_entries()` — usa `ON CONFLICT (id)`, e ali
--       isso está CERTO: o trigger copia `NEW.id` explicitamente para
--       `pipeline_entries.id`, então o arbiter dispara de verdade (é o oposto do
--       caso dos bulk_*, onde o id seria gerado por default). Não precisa de
--       reescrita; passa a funcionar para recompra graças ao drop do cadeado (1).
--
--   (c) Leitores single-row do par, no frontend — depois deste arquivo, um lead
--       com 2 negócios no mesmo funil faz `.maybeSingle()` retornar erro
--       PGRST116 em vez de linha:
--         - `src/modules/pipelines/lib/stageTransition.ts:24-29`
--           (`upsertLeadIntoCustomPipe`: select → if/else insert; vira
--           duplicador quando a leitura falha)
--         - `src/modules/pipelines/hooks/custom/useCustomPipelines.ts:911,921,931`
--         - `src/modules/communication/hooks/useWhatsAppLeadIntegration.ts:175,176,265,266,398,399,400`
--       (Uma versão anterior desta lista trazia também
--       `src/modules/leads/hooks/useLeadAllPipelines.ts:92-94`. É FALSO e foi
--       removido: aquelas linhas são `.from("upsell").select("id, status")
--       .eq("lead_id",…).eq("organization_id",…).maybeSingle()` — outra tabela,
--       sem relação com o par. A leitura de `pipeline_entries` nesse arquivo
--       (:68-71) não usa `.maybeSingle()` e já tolera N linhas.)
--       `src/modules/pipelines/hooks/model/usePipelineEntries.ts` e
--       `supabase/functions/_shared/pipeline-adapter.ts` JÁ foram convertidos
--       para tolerar N linhas (trabalho paralelo desta mesma fatia).
--       Nenhum dos três é corrigido aqui: são arquivos de frontend, não cabem
--       numa migration, e pertencem a outra tarefa em voo.
--
--   (d) `tests/unit/usePipePropostas.dedup.test.ts:227` — o teste simula
--       23505 citando `idx_pipeline_entries_pipeline_lead` como rede do create.
--       Essa rede deixa de existir; o teste continua verde (ele mocka o erro),
--       mas passa a testar um cenário que o banco não produz mais.
--
--   (e) `src/modules/pipelines/lib/confirmacao-migration.ts:51-58`
--       (`resolveDedup`) existe para escolher qual row deletar "pra evitar
--       colisão UNIQUE(lead_id, pipeline_id)". A colisão deixa de existir; a
--       função vira dedup por escolha de produto, não por imposição do banco.
--
--   (f) `tests/integration/bulk-add-to-custom-pipe.test.ts` continua válido:
--       o caso "lead já no funil vira update de etapa" agora é servido pelo
--       UPDATE (casa 1 linha), e o `expect(count).toBe(1)` segue verdadeiro
--       porque o INSERT só roda quando o UPDATE casa 0.
--       ⚠️ Mas o helper `entryFor()` (:49-56) é o MESMO padrão que (c) condena —
--       `.eq('pipeline_id').eq('lead_id').maybeSingle()` em `custom_pipe_entries`.
--       Continua verde só porque naquele teste a contagem permanece 1. O primeiro
--       caso de recompra escrito nesse arquivo vai bater em PGRST116 no helper, e
--       o sintoma vai parecer bug da RPC. Trocar por `.order(...).limit(1)` ou por
--       leitura de N linhas é trabalho de quem escrever esse caso.
--
--   (g) 🔴 CONSUMIDORES QUE ASSUMEM 1 ENTRY POR (LEAD, FUNIL) sem citar chave
--       nenhuma — não apareceriam na varredura acima, foram achados lendo a
--       cadeia de gatilhos em prod. São o motivo de a "Consequência 2" existir no
--       cabeçalho, e ficam repetidos aqui porque é nesta seção que o próximo
--       leitor vem procurar:
--         - `public.fn_capture_sale_event` — o estorno casa a venda original por
--           `s.lead_id = NEW.lead_id AND s.pipeline_id = NEW.pipeline_id`, LEAD +
--           FUNIL. Com 2 negócios no mesmo funil, mover o negócio A (que estava
--           em `won`) emite `sale_reversed` contra a venda mais recente do LEAD,
--           que pode nem ser a de A. `sale_events` é imutável.
--         - `public.fn_capture_meeting_event` — deduplica `meeting_booked` por
--           `lead_id` + org (`v_prev`), então mover N entries de `confirmacao`
--           registra 1 reunião e faz UPDATE de metadata nas demais, não N
--           reuniões. Aqui a direção do erro é subcontagem, não duplicação.
--       Os dois gravam colunas que permitiriam casar por ENTRY (`entry_id` em
--       `pipeline_stage_events`, `stage_event_id` em `sale_events`,
--       `source_entry_id` em `meeting_events`) e simplesmente não as usam no
--       match. Corrigir isso é mudança de comportamento de métrica: issue própria,
--       não esta migration.


-- ── 4. Verificação (aborta) ─────────────────────────────────────────────────
DO $$
DECLARE
  r          record;
  v_n        integer;
  v_esperado text;
BEGIN
  -- 4a. Os três cadeados, pelo nome.
  -- Escopado por schema E tabela de propósito: `conname` NÃO é único no banco (a
  -- unicidade de catálogo é por `(conrelid, contypid, conname)`), então sem o
  -- filtro uma constraint homônima em qualquer outra tabela abortaria a migration
  -- com uma mensagem que aponta para o objeto errado. Medido em prod 2026-07-31:
  -- hoje só existem as 2 esperadas, ambas em `public` e nas tabelas certas — o
  -- filtro é rigor de asserção, não conserto de bug ativo. A 4b logo abaixo já
  -- fazia esse join; a 4a não fazia, e a seção ficava com dois padrões de rigor.
  SELECT count(*) INTO v_n
  FROM pg_constraint c
  JOIN pg_class c2     ON c2.oid = c.conrelid
  JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
  WHERE c.conname IN ('uq_pipeline_entries_pipeline_lead',
                      'custom_pipe_entries_pipeline_id_lead_id_key')
    AND n2.nspname = 'public'
    AND c2.relname IN ('pipeline_entries', 'custom_pipe_entries');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FAIL: % constraint(s) UNIQUE(pipeline_id, lead_id) ainda viva(s).', v_n;
  END IF;

  SELECT count(*) INTO v_n
  FROM pg_class i
  JOIN pg_namespace n ON n.oid = i.relnamespace
  WHERE n.nspname = 'public' AND i.relname = 'idx_pipeline_entries_pipeline_lead';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FAIL: índice idx_pipeline_entries_pipeline_lead ainda existe.';
  END IF;

  -- 4b. Nenhum OUTRO índice único cobre exatamente (pipeline_id, lead_id) —
  -- pega gêmeo com nome diferente, que reintroduziria o cadeado por acidente.
  FOR r IN
    SELECT i.relname AS idx, t.relname AS tbl
    FROM pg_index ix
    JOIN pg_class i     ON i.oid = ix.indexrelid
    JOIN pg_class t     ON t.oid = ix.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname IN ('pipeline_entries', 'custom_pipe_entries')
      AND ix.indisunique
      AND ix.indnkeyatts = 2
      -- `attname` é do tipo `name`; sem o cast explícito a comparação vira
      -- `name[] = text[]`, para o qual NÃO existe operador (testado: ERROR
      -- "operator does not exist"). O cast é obrigatório, não estilo.
      --
      -- `WITH ORDINALITY` + `k.ord <= ix.indnkeyatts` porque `indkey` carrega as
      -- `indnatts` colunas, ou seja as CHAVE **mais** as de `INCLUDE`. Um
      -- `UNIQUE (pipeline_id, lead_id) INCLUDE (stage_key)` tem `indnkeyatts = 2`
      -- (passa o filtro acima) mas produziria 3 nomes no array_agg, a igualdade
      -- falharia e o gêmeo escaparia — a migration imprimiria VALIDATION PASSED
      -- com o cadeado vivo. Hoje os 3 índices reais têm `indnatts = 2` (medido em
      -- prod 2026-07-31, nenhum tem INCLUDE), então o corte não muda o resultado
      -- de agora; ele existe porque esta asserção é a rede PERMANENTE contra
      -- reintrodução acidental da unicidade, e uma rede com furo de forma não
      -- serve.
      AND (
        SELECT array_agg(a.attname::text ORDER BY a.attname::text)
        FROM unnest(ix.indkey::smallint[]) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.attnum
        WHERE k.ord <= ix.indnkeyatts
      ) = ARRAY['lead_id', 'pipeline_id']
  LOOP
    RAISE EXCEPTION
      'FAIL: índice único % em % ainda casa (pipeline_id, lead_id) — recompra continua travada.',
      r.idx, r.tbl;
  END LOOP;

  -- 4c. Nenhuma função em `public` com ON CONFLICT sobre o par (qualquer ordem),
  -- nem referência aos nomes dropados via ON CONFLICT ON CONSTRAINT.
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (
        p.prosrc ~* 'on\s+conflict\s*\(\s*pipeline_id\s*,\s*lead_id\s*\)'
        OR p.prosrc ~* 'on\s+conflict\s*\(\s*lead_id\s*,\s*pipeline_id\s*\)'
        OR p.prosrc ~* '(uq_pipeline_entries_pipeline_lead|idx_pipeline_entries_pipeline_lead|custom_pipe_entries_pipeline_id_lead_id_key)'
      )
  LOOP
    RAISE EXCEPTION
      'FAIL: % ainda infere ON CONFLICT por (pipeline_id, lead_id) ou cita cadeado dropado — levantaria 42P10 em runtime.',
      r.sig;
  END LOOP;

  -- 4d. As duas funções: existem, assinatura única e idêntica, mesmo prosecdef,
  -- mesmo search_path, guardas de autorização preservadas, e o corpo carrega a
  -- forma "move todos".
  -- ⚠️ Prova ESTRUTURAL (inspeção de pg_proc), não comportamental: provar
  -- "moveu 3 de 3" exigiria escrever dado de cliente, o que uma migration não
  -- faz. A prova comportamental é o teste de integração.
  SELECT count(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('bulk_move_stage', 'bulk_add_to_custom_pipe');
  IF v_n <> 2 THEN
    RAISE EXCEPTION
      'FAIL: esperava 2 assinaturas (1 por função), achei % — overload torna a chamada 42725.', v_n;
  END IF;

  FOR r IN
    SELECT p.proname,
           p.oid::regprocedure                        AS sig,
           p.prosecdef,
           p.prosrc,
           COALESCE(array_to_string(p.proconfig, ','), '') AS cfg,
           pg_get_function_identity_arguments(p.oid)  AS args,
           pg_get_function_result(p.oid)              AS ret
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('bulk_move_stage', 'bulk_add_to_custom_pipe')
  LOOP
    v_esperado := CASE r.proname
      WHEN 'bulk_move_stage'         THEN 'p_lead_ids uuid[], p_target_pipe text, p_target_stage text'
      ELSE                                'p_lead_ids uuid[], p_pipeline_id uuid, p_stage_id uuid'
    END;
    IF r.args <> v_esperado THEN
      RAISE EXCEPTION 'FAIL: assinatura de % mudou: "%" (esperava "%").', r.proname, r.args, v_esperado;
    END IF;

    IF r.ret <> 'void' THEN
      RAISE EXCEPTION 'FAIL: % retorna % (esperava void).', r.proname, r.ret;
    END IF;

    IF NOT r.prosecdef THEN
      RAISE EXCEPTION 'FAIL: % perdeu SECURITY DEFINER.', r.proname;
    END IF;

    IF r.cfg NOT LIKE '%search_path=public, pg_temp%' THEN
      RAISE EXCEPTION 'FAIL: % perdeu SET search_path (config = "%").', r.proname, r.cfg;
    END IF;

    -- Guardas de autorização preservadas.
    IF r.prosrc NOT LIKE '%is_master_user()%'
       OR r.prosrc NOT LIKE '%team_members%'
       OR r.prosrc NOT LIKE '%No active organization membership%'
       OR r.prosrc NOT LIKE '%l.deleted_at IS NULL%' THEN
      RAISE EXCEPTION 'FAIL: % perdeu alguma checagem de master/org/lead na reescrita.', r.proname;
    END IF;

    -- Semântica "move todos": UPDATE explícito pelo par + contagem de linhas,
    -- e nenhum resquício de upsert.
    IF r.prosrc ~* 'on\s+conflict' THEN
      RAISE EXCEPTION 'FAIL: % ainda contém ON CONFLICT.', r.proname;
    END IF;
    IF r.prosrc NOT LIKE '%GET DIAGNOSTICS%' THEN
      RAISE EXCEPTION 'FAIL: % não conta linhas movidas (GET DIAGNOSTICS ausente).', r.proname;
    END IF;
    IF r.prosrc !~* 'update\s+public\.(pipeline_entries|custom_pipe_entries)' THEN
      RAISE EXCEPTION 'FAIL: % não tem UPDATE explícito na tabela de entries.', r.proname;
    END IF;
    IF r.prosrc !~* '\.lead_id\s*=\s*v_lead_id' OR r.prosrc !~* '\.pipeline_id\s*=' THEN
      RAISE EXCEPTION 'FAIL: % não filtra o UPDATE pelo par (pipeline_id, lead_id).', r.proname;
    END IF;
    IF r.prosrc NOT LIKE '%v_movidos = 0%' THEN
      RAISE EXCEPTION 'FAIL: % não gateia o INSERT em "nenhuma linha movida".', r.proname;
    END IF;

    -- ACL: `authenticated` PRECISA executar (é quem clica no diálogo).
    IF NOT has_function_privilege('authenticated', r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: authenticated não executa % — o bulk move quebraria.', r.sig;
    END IF;

    -- ACL: `anon` NÃO pode executar. Era NOTICE enquanto o grant herdado ficava
    -- de pé; a seção 1b revoga as duas metades (PUBLIC + nominal), então agora a
    -- verificação ABORTA. É esta linha, rodada contra o alvo do apply, que prova o
    -- revoke — o SQL escrito não prova (o grant é concedido pelo banco no momento
    -- do CREATE, por `ALTER DEFAULT PRIVILEGES`, não pelo nosso arquivo).
    IF has_function_privilege('anon', r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION
        'FAIL: anon ainda executa % — o REVOKE da seção 1b não pegou (confira as DUAS metades: PUBLIC e nominal).',
        r.sig;
    END IF;
  END LOOP;

  RAISE NOTICE 'VALIDATION PASSED: 3 cadeados fora, nenhum índice único remanescente sobre (pipeline_id, lead_id), nenhuma função com ON CONFLICT no par, bulk_* com assinatura/segurança intactas, anon sem EXECUTE e semântica move-todos no corpo.';
END$$;


-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- ⚠️ O rollback só é possível ENQUANTO NÃO EXISTIR NENHUM LEAD COM 2 ENTRIES NO
-- MESMO FUNIL. Depois que a primeira recompra for criada, recriar os cadeados é
-- IMPOSSÍVEL sem apagar negócio de cliente — e apagar negócio é apagar venda.
-- Não existe rollback "seguro por padrão" deste arquivo; existe uma janela.
--
-- PASSO 0 — medir a janela ANTES de tentar qualquer coisa. As duas queries
-- precisam devolver ZERO linhas:
--
--   SELECT pipeline_id, lead_id, count(*)
--   FROM public.pipeline_entries
--   WHERE lead_id IS NOT NULL
--   GROUP BY 1, 2 HAVING count(*) > 1;
--
--   SELECT pipeline_id, lead_id, count(*)
--   FROM public.custom_pipe_entries
--   GROUP BY 1, 2 HAVING count(*) > 1;
--
-- (Baseline medido em prod 2026-07-31, imediatamente antes desta migration: 0 e
-- 0, sobre 36.727 e 16.195 linhas. Se você está lendo isso depois do apply, meça
-- de novo — o número de hoje não vale amanhã, esse é justamente o ponto.)
--
-- PASSO 1 — reverter as duas funções para a forma `ON CONFLICT`. A FONTE do corpo
-- original é o baseline versionado, e só ele:
--
--     supabase/migrations/20260101000000_baseline_prod_schema.sql
--       • bulk_add_to_custom_pipe  → linhas 1373-1440 (ON CONFLICT na 1430)
--       • bulk_move_stage          → linhas 1531-1592 (ON CONFLICT na 1583)
--
-- ⚠️ Duas fontes que uma versão anterior deste passo indicava e que NÃO servem:
--   (i) "os comentários acima" — eles listam o que foi PRESERVADO, em bullets;
--       o `INSERT … ON CONFLICT … DO UPDATE SET … = EXCLUDED.…` original não
--       aparece em lugar nenhum deste arquivo (`grep -n EXCLUDED` devolve zero).
--   (ii) `pg_get_functiondef` "em qualquer réplica" — depois do apply, prod e
--       qualquer branch efêmera criada a partir dela devolvem o corpo NOVO.
-- Num arquivo de ponto-de-não-retorno, o passo 1 do rollback não pode apontar
-- para uma fonte que o próprio apply destrói.
--
-- Reverter as funções ANTES de recriar os índices não é obrigatório, mas evita a
-- janela inversa (índice de volta + função ainda em UPDATE/INSERT é apenas menos
-- eficiente, não quebra; o contrário — função com ON CONFLICT sem índice — é
-- 42P10 na cara do usuário).
--
-- PASSO 2 — recriar os cadeados. Duas formas, com limitações diferentes:
--
--   -- (2.1) Constraints: tomam ACCESS EXCLUSIVE e constroem o índice sob lock.
--   -- Nas ordens de grandeza atuais (36.7k / 16.2k linhas) o lock é curto, mas
--   -- é lock de escrita na tabela mais quente do produto. NÃO medimos a duração.
--   ALTER TABLE public.pipeline_entries
--     ADD CONSTRAINT uq_pipeline_entries_pipeline_lead UNIQUE (pipeline_id, lead_id);
--   ALTER TABLE public.custom_pipe_entries
--     ADD CONSTRAINT custom_pipe_entries_pipeline_id_lead_id_key UNIQUE (pipeline_id, lead_id);
--
--   -- (2.2) O índice único PARCIAL não pode ser recriado por ALTER TABLE
--   -- (constraint UNIQUE não aceita predicado). Precisa de CREATE UNIQUE INDEX,
--   -- e existem DUAS variantes — uma versão anterior deste passo mandava o
--   -- operador direto para o comando manual, que é o caminho mais arriscado na
--   -- hora pior:
--   --
--   --   (2.2a) VERSIONADA — cabe numa migration de revert. `CREATE UNIQUE INDEX`
--   --   SEM `CONCURRENTLY` roda normalmente dentro da transação do `db push`.
--   --   Toma ACCESS EXCLUSIVE enquanto constrói; nas 36,7k linhas de hoje isso é
--   --   breve, mas 🟠 NÃO MEDIMOS a duração. É a forma preferida: fica no repo,
--   --   passa por review, e o ledger registra.
--   CREATE UNIQUE INDEX idx_pipeline_entries_pipeline_lead
--     ON public.pipeline_entries (pipeline_id, lead_id) WHERE (lead_id IS NOT NULL);
--   --
--   --   (2.2b) MANUAL — só quando NÃO se puder travar escrita na tabela.
--   --   `CONCURRENTLY` não roda dentro de transação e o `supabase db push`
--   --   envolve cada arquivo numa; então esta variante, e só ela, é comando
--   --   manual fora do push.
--   CREATE UNIQUE INDEX CONCURRENTLY idx_pipeline_entries_pipeline_lead
--     ON public.pipeline_entries (pipeline_id, lead_id) WHERE (lead_id IS NOT NULL);
--   -- (CONCURRENTLY pode terminar INVALID se houver duplicata; nesse caso o
--   -- índice fica lá, inválido e inútil, e precisa de DROP INDEX antes de nova
--   -- tentativa. Verifique com: SELECT indisvalid FROM pg_index WHERE ...)
--
-- PASSO 3 — o que o rollback NÃO desfaz, e não deve desfazer:
--   • O REVOKE da seção 1b. `anon` não volta a executar `bulk_add_to_custom_pipe`
--     — o grant era herdado, não é o que esta migration quebrou, e reconcedê-lo
--     seria reabrir uma SECURITY DEFINER de tenant à anon key do bundle. Se por
--     algum motivo precisar voltar, é `GRANT EXECUTE … TO anon` explícito, numa
--     migration própria, com justificativa própria.
--   • `merge_leads` volta a pré-deletar colisões (item 3a acima) e o espelho
--     `sync_custom_pipe_to_entries` volta a poder levantar 23505 quando uma org
--     tentar segunda entry em funil custom.
-- ============================================================================
