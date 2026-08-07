-- ============================================================================
-- Aposenta os funis de Carteira. A Carteira vira faceta do Lead (ADR-0023 §8):
-- cliente é lead com Relação `Cliente`, e cada venda é um Negócio.
--
-- ── MEDIDO EM PROD 2026-08-05, ANTES DE ESCREVER ──────────────────────────
--   • 1.078 etapas de `upsell_base` / `upsell_gestao`, todas ativas, em 98 orgs;
--   • 4 etapas com transição apontando para a carteira, em 4 orgs;
--   • 0 `pipeline_entries` em funil de carteira — e isso NÃO é a prova de que
--     ninguém usa: o board da Carteira nunca escreveu em `pipeline_entries`.
--     Ele agrupa `upsell_clients` por `gestao_stage` / `tipo_cliente_tempo`
--     (UpsellGestaoKanban.tsx:146, UpsellBaseKanban.tsx:150). Não existe LINHA
--     de carteira em `pipelines`: os dois funis existem só como
--     `pipeline_stages` tipadas pelo texto `pipeline_type`;
--   • 739 `upsell_clients` e 346 `upsell_orders`, PRESERVADOS.
--
-- ── A PROVA DE QUE O FUNIL NÃO É USADO (medida na tabela certa) ────────────
-- "739 clientes têm etapa" não diz nada: `gestao_stage` tem DEFAULT
-- 'primeira_compra' e `tipo_cliente_tempo` é NOT NULL DEFAULT '0-3m'. Toda
-- linha nasce com etapa. O que mede uso é quanto SAIU do default:
--   • 10 de 739 saíram de 'primeira_compra' (1,4%);
--   • 10 de 739 saíram de '0-3m';
--   • **1** linha em toda a prod tem `gestao_manual_override = true` — um
--     arrasto humano no board da Gestão, desde sempre.
-- Os funis foram configurados por provisionamento e praticamente nunca usados —
-- mesmo padrão de `deals`, `activities` e `lead_products`.
--
-- Corolário prático: NÃO transformar "existe cliente com etapa" em guarda. Ela
-- daria 739 em qualquer ambiente e travaria esta migration para sempre por um
-- motivo que não tem relação com uso.
--
-- ── O QUE ESTA MIGRATION NÃO FAZ ──────────────────────────────────────────
-- Não apaga nada. Desativa. `upsell_clients` e `upsell_orders` continuam
-- intactos — eles são a FONTE das métricas da relação e a origem dos Negócios
-- ganhos que `scripts/backfill-carteira-negocios` cria. O que morre é o funil,
-- não a carteira.
--
-- ── COMO REVERTER, E POR QUE A FRASE ANTERIOR ERA FALSA ───────────────────
-- Até 2026-08-07 esta linha dizia: "Reverter é `is_active = true` nas mesmas
-- linhas, mais restaurar a versão anterior de `create_default_pipeline_stages`".
-- A segunda metade é verdade (a função está no baseline). A PRIMEIRA É FALSA, e
-- de um jeito que só apareceria no dia de reverter:
--
--   • o bloco 1 abaixo NULLifica `target_pipe_type`/`target_stage_key` — e o
--     predicado que seleciona as linhas (`WHERE target_pipe_type LIKE 'upsell%'`)
--     É O PRÓPRIO VALOR APAGADO. Depois do apply, o conjunto de linhas afetadas
--     não é reconstruível de dentro do banco: não sobra coluna que diga quais
--     etapas apontavam para a carteira, nem para qual etapa apontavam;
--   • `is_final_positive` é reescrito por `CASE` — o valor anterior de cada
--     linha não é derivável do valor novo;
--   • "as mesmas linhas" do `is_active` só existe enquanto alguém souber quais
--     estavam ativas ANTES. O `AND is_active` do bloco 2 faz a migration tocar
--     só as ativas, mas não deixa registro de quais foram.
--
-- Ou seja: o rollback prometido no cabeçalho reativaria etapas SEM restaurar
-- para onde elas apontavam, deixando o banco num terceiro estado — nem o
-- anterior, nem o posterior. Config de cliente, em 98 organizações.
--
-- O bloco 0 conserta isso na origem, e não no rollback: guarda as três colunas
-- antes de tocá-las. É a mesma classe de `backup_cross_org_responsaveis`, com a
-- lição dele aplicada — RLS ANTES do INSERT, não depois (a tabela de backup da
-- limpeza cross-org nasceu legível por qualquer `authenticated`, e a migration
-- que existia para fechar vazamento criou um).
--
-- O rollback executável vive em
-- `supabase/migrations/rollback/20270805000010_aposenta_funis_de_carteira.sql`
-- e lê deste backup.
-- ============================================================================

BEGIN;

-- ── 0. Backup do que os blocos 1 e 2 vão sobrescrever ─────────────────────
-- Sem `IF NOT EXISTS` no CREATE: se a tabela já existir de uma tentativa
-- anterior, é melhor a migration falhar e alguém olhar do que empilhar dois
-- snapshots na mesma tabela e o rollback restaurar uma mistura dos dois.
CREATE TABLE public.backup_aposenta_funis_carteira (
  stage_id                uuid PRIMARY KEY,
  organization_id         uuid,
  pipeline_type           text,
  stage_key               text,
  -- Estado ANTES do bloco 1. `tinha_ponteiro` distingue "apontava para NULL"
  -- de "não estava no conjunto", que o NULL sozinho não distingue.
  tinha_ponteiro          boolean NOT NULL DEFAULT false,
  target_pipe_type_antes  text,
  target_stage_key_antes  text,
  is_final_positive_antes boolean,
  -- Estado ANTES do bloco 2: true só nas linhas que este apply de fato apagou.
  foi_desativada          boolean NOT NULL DEFAULT false,
  capturado_em            timestamptz NOT NULL DEFAULT now()
);

-- RLS ANTES de qualquer INSERT. A tabela carrega `organization_id` de 98 orgs;
-- nascer sem política é o vazamento que a limpeza cross-org já cometeu uma vez.
-- Sem policy = deny-all para `anon`/`authenticated`; só `service_role` (que tem
-- BYPASSRLS) e o dono enxergam. É o que se quer: isto é artefato de operação,
-- não dado de produto.
ALTER TABLE public.backup_aposenta_funis_carteira ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.backup_aposenta_funis_carteira FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.backup_aposenta_funis_carteira IS
  'Snapshot de pipeline_stages imediatamente antes de 20270805000010 aposentar os funis de carteira. Existe porque o UPDATE daquela migration apaga o próprio predicado que seleciona as linhas (target_pipe_type LIKE ''upsell%''), tornando o conjunto irreconstruível de dentro do banco. Lido pelo rollback homônimo. Descartável depois que a virada estabilizar — mas só depois.';

-- Um INSERT só, com as duas metades resolvidas por predicado, para o snapshot
-- ser coerente: os dois blocos abaixo rodam na MESMA transação, então o que se
-- captura aqui é exatamente o que eles vão encontrar.
INSERT INTO public.backup_aposenta_funis_carteira (
  stage_id, organization_id, pipeline_type, stage_key,
  tinha_ponteiro, target_pipe_type_antes, target_stage_key_antes, is_final_positive_antes,
  foi_desativada
)
SELECT
  ps.id,
  ps.organization_id,
  ps.pipeline_type,
  ps.stage_key,
  (ps.target_pipe_type LIKE 'upsell%'),
  ps.target_pipe_type,
  ps.target_stage_key,
  ps.is_final_positive,
  (ps.pipeline_type IN ('upsell_base', 'upsell_gestao') AND ps.is_active)
FROM public.pipeline_stages ps
WHERE ps.target_pipe_type LIKE 'upsell%'
   OR (ps.pipeline_type IN ('upsell_base', 'upsell_gestao') AND ps.is_active);

DO $$
DECLARE v_n bigint; v_ponteiro bigint; v_desativa bigint;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE tinha_ponteiro), count(*) FILTER (WHERE foi_desativada)
    INTO v_n, v_ponteiro, v_desativa
    FROM public.backup_aposenta_funis_carteira;

  RAISE NOTICE 'BACKUP: % linha(s) capturada(s) — % com ponteiro para carteira, % a desativar.',
    v_n, v_ponteiro, v_desativa;

  -- Backup vazio com trabalho a fazer é o modo de falha silencioso: a migration
  -- passaria, os UPDATEs abaixo escreveriam, e o rollback não teria de onde ler.
  IF v_n = 0 THEN
    IF EXISTS (
      SELECT 1 FROM public.pipeline_stages
       WHERE target_pipe_type LIKE 'upsell%'
          OR (pipeline_type IN ('upsell_base','upsell_gestao') AND is_active)
    ) THEN
      RAISE EXCEPTION 'FAIL: há linhas a alterar mas o backup saiu vazio. Não prossiga — o rollback ficaria sem fonte.';
    END IF;
    RAISE NOTICE 'BACKUP vazio e nada a alterar: esta org/banco já está aposentado. Blocos 1 e 2 serão inertes.';
  END IF;
END $$;

-- ── 1. As 4 transições que apontam para a carteira ────────────────────────
-- Etapa com `target_pipe_type` de carteira mandaria o negócio para um funil
-- aposentado. Limpar ANTES de desativar: se as duas metades forem separadas
-- algum dia, a etapa-destino inativa deixa a transição como ponteiro para o
-- nada e o move falha em silêncio. Dentro desta transação não há janela, mas a
-- ordem é a que o card descreve e a que sobrevive a um split.
--
-- SEM o filtro `is_active` de propósito: etapa inativa com ponteiro podre
-- ressuscita o defeito no dia em que alguém a reativa.
--
-- As 4, medidas: 2 em `whatsapp` (Bella Itália "Vendas", Maria Bonita
-- "AJUSTAR" — ambas `stage_role = 'open'`) e 2 em `propostas` ("Vendido ✓",
-- ambas `stage_role = 'won'`). Todas com `target_pipeline_id`/`target_stage_id`
-- NULL — não existe ponteiro por UUID para a carteira, só por texto.
--
-- ── Por que a flag cai só em `whatsapp` ───────────────────────────────────
-- `PipeWhatsapp.tsx:489` resolve o destino como `target_pipe_type || "confirmacao"`.
-- Esse fallback é LOAD-BEARING — 8 etapas de ganho em 6 orgs já vivem com alvo
-- NULL e contam com ele para encaminhar. Não dá para removê-lo no front.
-- Consequência: se as 2 etapas de `whatsapp` ficarem com a flag de pé e o alvo
-- limpo, elas entram nesse fallback e mover o card passa a EXIGIR agendamento de
-- reunião e a criar entry em `pipe_confirmacao`. Isso é regressão, não
-- aposentadoria. Zerar a flag é o que desarma.
--
-- Restrito a `whatsapp` de propósito. Em `propostas` o encaminhamento só existe
-- para destino custom (`PipePropostas.tsx:1020-1034`, exige `target_pipeline_id`
-- + `target_stage_id`, ambos NULL aqui): zerar não tiraria comportamento nenhum
-- e apagaria o "etapa de sucesso" de duas etapas que SÃO a venda da org.
--
-- ⚠️ MÉTRICA NÃO SE MOVE, e o teste disso é `stage_role`, não esta flag.
--   • `fn_capture_sale_event` só grava em `sale_events` quando
--     `metric_stage_role(...) = 'won'` (ADR-0017 §1: won/lost é papel governado,
--     nunca derivado de `is_final_*`). As 2 etapas tocadas aqui são `'open'` —
--     nunca produziram evento de venda e continuam não produzindo.
--   • O que se perde é a trava de UX `sale-value-guard.ts:69` (ponte
--     pré-governança: `stage_role='open'` + `is_final_positive`). Essas 2 orgs
--     deixam de ser perguntadas pelo valor ao mover o card. Como o caderno
--     ignora etapa não-governada, nenhum valor NULL entra no ledger — mas o
--     conserto de verdade é HERDADO e anterior a esta migration: um admin
--     precisa marcar `stage_role = 'won'` nessas etapas. Papel governado exige
--     confirmação humana; migration não decide isso sozinha.
--
-- Num só UPDATE, e a flag decidida por `CASE`, porque limpar o ponteiro antes
-- apagaria justamente o critério que identifica quem precisa ser desarmado.
-- Nada de UUID de org escrito à mão: o conjunto é derivado do dado.
UPDATE public.pipeline_stages
   SET target_pipe_type  = NULL,
       target_stage_key  = NULL,
       is_final_positive = CASE
                             WHEN pipeline_type = 'whatsapp' THEN false
                             ELSE is_final_positive
                           END
 WHERE target_pipe_type LIKE 'upsell%';

-- ── 2. As etapas ──────────────────────────────────────────────────────────
-- ⚠️ ANTES: desativar etapa NÃO é operação inerte neste schema.
-- `on_pipeline_stage_removed` (AFTER UPDATE) trata `is_active` true→false como
-- remoção e, para os agentes da org com aquele pipe ativo:
--   • tira o `stage_key` de `copilot_agents.active_stages`;
--   • tira de `copilot_agents.move_rules` as regras que citam a etapa;
--   • **`DELETE FROM copilot_agent_kanban_rules`** das regras daquela etapa.
-- Nada disso volta com `is_active = true`: reativar dispara
-- `on_pipeline_stage_created`, que recria uma regra GENÉRICA com
-- `needs_review = true` — não a que a org tinha escrito.
--
-- Medido em prod 2026-08-05: 0 regras de kanban e 0 move_rules de carteira, e
-- 1 agente (de 47) com pipe de carteira em `active_pipes`. Então hoje o
-- caminho de exclusão não alcança linha nenhuma — o cabeçalho ("não apaga
-- nada") é verdade por MEDIÇÃO, não por construção. A guarda abaixo é o que
-- transforma isso em invariante: se alguém configurar regra de carteira entre
-- a medição e o apply, a migration aborta em vez de apagar configuração de
-- cliente em silêncio.
DO $$
DECLARE
  v_regras int;
  v_move   int;
BEGIN
  SELECT count(*) INTO v_regras FROM public.copilot_agent_kanban_rules
   WHERE pipe_type IN ('upsell_base','upsell_gestao');

  SELECT count(*) INTO v_move FROM public.copilot_agents
   WHERE move_rules::text LIKE '%upsell_base%'
      OR move_rules::text LIKE '%upsell_gestao%';

  IF v_regras <> 0 OR v_move <> 0 THEN
    RAISE EXCEPTION 'ABORTADO: desativar apagaria % regra(s) de kanban de carteira e reescreveria move_rules de % agente(s). Decida o destino dessa configuração antes de aposentar.', v_regras, v_move;
  END IF;
END $$;

-- `AND is_active` deixa a reaplicação inerte (0 linhas) em vez de reescrever
-- 1.078 linhas, mover `updated_at` de todas e disparar os 2 triggers de novo.
UPDATE public.pipeline_stages
   SET is_active = false
 WHERE pipeline_type IN ('upsell_base', 'upsell_gestao')
   AND is_active;

-- ── 3. A torneira do BANCO: parar de provisionar funil de carteira ────────
-- `create_default_pipeline_stages` semeia 11 etapas de carteira ATIVAS
-- (6 `upsell_base` + 5 `upsell_gestao`) por org. Deixá-la intacta é deixar a
-- receita de provisionamento do banco declarando um funil que a linha de cima
-- acabou de aposentar. Os outros três funis ficam byte a byte como estão.
--
-- ⚠️ SEJA HONESTO SOBRE O ALCANCE DISTO: esta função NÃO é a torneira viva.
-- Medido em prod: nenhum trigger a chama (`pg_get_triggerdef ILIKE
-- '%create_default_pipeline%'` → 0 linhas), e as orgs recém-nascidas provam quem
-- semeou — Liris (2026-08-04) e Bolivar (2026-08-03) têm 8 etapas de
-- `propostas`, que é o número do `DEFAULT_STAGES` do front; esta função escreve
-- 7. Quem semeia hoje é `ensureDefaultStagesInDb`
-- (usePipelineStages.ts:28), no cliente. Fechar aqui é higiene necessária e
-- insuficiente; a outra metade está nas notas do fim do arquivo.
--
-- Reescrita, não ALTER: a função é um bloco único de INSERTs. `CREATE OR REPLACE`
-- preserva dono, `search_path` e ACL — nenhum grant é criado ou removido aqui.
CREATE OR REPLACE FUNCTION public.create_default_pipeline_stages(org_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  -- Etapas do Pipeline WhatsApp/Qualificacao
  INSERT INTO pipeline_stages (organization_id, pipeline_type, stage_key, name, color, position, is_final_positive, target_pipe_type, target_stage_key) VALUES
    (org_id, 'whatsapp', 'novo', 'Novo', '#6366f1', 0, false, NULL, NULL),
    (org_id, 'whatsapp', 'abordado', 'Abordado', '#f59e0b', 1, false, NULL, NULL),
    (org_id, 'whatsapp', 'respondeu', 'Respondeu', '#3b82f6', 2, false, NULL, NULL),
    (org_id, 'whatsapp', 'esfriou', 'Esfriou', '#ef4444', 3, false, NULL, NULL),
    (org_id, 'whatsapp', 'agendado', 'Agendado', '#22c55e', 4, true, 'confirmacao', 'reuniao_marcada')
  ON CONFLICT (organization_id, pipeline_type, stage_key) DO NOTHING;

  -- Etapas do Pipeline Confirmacao
  INSERT INTO pipeline_stages (organization_id, pipeline_type, stage_key, name, color, position, is_final_positive, is_final_negative, target_pipe_type, target_stage_key) VALUES
    (org_id, 'confirmacao', 'reuniao_marcada', 'Reuniao Marcada', '#6366f1', 0, false, false, NULL, NULL),
    (org_id, 'confirmacao', 'confirmar_d5', 'Confirmar D-5', '#8b5cf6', 1, false, false, NULL, NULL),
    (org_id, 'confirmacao', 'confirmar_d3', 'Confirmar D-3', '#a855f7', 2, false, false, NULL, NULL),
    (org_id, 'confirmacao', 'confirmar_d2', 'Confirmar D-2', '#f59e0b', 3, false, false, NULL, NULL),
    (org_id, 'confirmacao', 'confirmar_d1', 'Confirmar D-1', '#f97316', 4, false, false, NULL, NULL),
    (org_id, 'confirmacao', 'confirmacao_no_dia', 'Confirmacao no Dia', '#ef4444', 5, false, false, NULL, NULL),
    (org_id, 'confirmacao', 'remarcar', 'Remarcar', '#f97316', 6, false, false, NULL, NULL),
    (org_id, 'confirmacao', 'compareceu', 'Compareceu', '#22c55e', 7, true, false, 'propostas', 'marcar_compromisso'),
    (org_id, 'confirmacao', 'perdido', 'Perdido', '#ef4444', 8, false, true, NULL, NULL)
  ON CONFLICT (organization_id, pipeline_type, stage_key) DO NOTHING;

  -- Etapas do Pipeline Propostas
  INSERT INTO pipeline_stages (organization_id, pipeline_type, stage_key, name, color, position, is_final_positive, is_final_negative) VALUES
    (org_id, 'propostas', 'marcar_compromisso', 'Marcar Compromisso', '#F5C518', 0, false, false),
    (org_id, 'propostas', 'reativar', 'Reativar', '#F97316', 1, false, false),
    (org_id, 'propostas', 'compromisso_marcado', 'Compromisso Marcado', '#3B82F6', 2, false, false),
    (org_id, 'propostas', 'esfriou', 'Esfriou', '#64748B', 3, false, false),
    (org_id, 'propostas', 'futuro', 'Futuro', '#8B5CF6', 4, false, false),
    (org_id, 'propostas', 'vendido', 'Vendido', '#22C55E', 5, true, false),
    (org_id, 'propostas', 'perdido', 'Perdido', '#EF4444', 6, false, true)
  ON CONFLICT (organization_id, pipeline_type, stage_key) DO NOTHING;

  -- As etapas dos dois funis de Carteira saíram daqui em 20270805000010.
  -- Funil aposentado (ADR-0023 §8): org nova não nasce mais com ele.
  -- (Sem citar os nomes de propósito: a prova (d) lê o corpo desta função.)
END;
$function$;

-- ── Prova ─────────────────────────────────────────────────────────────────
-- Levanta exceção e desfaz a transação se sobrar qualquer resquício ativo.
DO $$
DECLARE
  v_etapas      int;
  v_transicoes  int;
  v_funis       int;
  v_cards       int;
  v_torneira    int;
BEGIN
  -- (a) nenhuma etapa de carteira ativa
  SELECT count(*) INTO v_etapas FROM public.pipeline_stages
   WHERE pipeline_type IN ('upsell_base','upsell_gestao') AND is_active;
  IF v_etapas <> 0 THEN
    RAISE EXCEPTION 'FALHA: % etapa(s) de carteira seguem ativas', v_etapas;
  END IF;

  -- (b) nenhuma transição apontando para a carteira — ativa OU inativa
  SELECT count(*) INTO v_transicoes FROM public.pipeline_stages
   WHERE target_pipe_type LIKE 'upsell%';
  IF v_transicoes <> 0 THEN
    RAISE EXCEPTION 'FALHA: % transição(ões) ainda apontam para a carteira', v_transicoes;
  END IF;

  -- (c) o modelo não mudou embaixo da migration.
  -- Hoje NÃO existe linha de carteira em `pipelines` — os funis são só
  -- `pipeline_stages` tipadas por texto. Se um dia existir, esta migration está
  -- incompleta e tem que gritar em vez de passar em silêncio.
  --
  -- Filtro por slug canônico, NUNCA por `slug LIKE 'upsell%'`: as duas únicas
  -- linhas que casam com o LIKE em prod são funis CUSTOM chamados "Upsell" e
  -- "Upsell Abril" da org Milennials — funil de usuário, não de sistema. Um
  -- UPDATE por LIKE desativaria o funil de qualquer org que batize o seu de
  -- "Upsell Q3". Foi o que a versão anterior desta migration fazia.
  SELECT count(*) INTO v_funis FROM public.pipelines
   WHERE slug IN ('upsell_base','upsell_gestao');
  IF v_funis <> 0 THEN
    RAISE EXCEPTION 'FALHA: apareceram % linha(s) de funil de carteira em pipelines — reveja esta migration', v_funis;
  END IF;

  -- Guarda de card. NÃO conta `upsell_clients` com etapa (seria 739 sempre —
  -- é o DEFAULT da coluna, ver cabeçalho). Conta o que só o humano produz: o
  -- arrasto no board da Gestão. Hoje = 1, então o teto é 1; passar disso
  -- significa que alguém começou a usar o funil DEPOIS da medição, e aí a
  -- decisão de aposentar tem de voltar para a mesa.
  SELECT count(*) INTO v_cards FROM public.upsell_clients
   WHERE gestao_manual_override;
  IF v_cards > 1 THEN
    RAISE EXCEPTION 'ABORTADO: % cliente(s) movidos à mão no board da Carteira (a medição achou 1). O funil saiu do desuso — reveja antes de aposentar.', v_cards;
  END IF;

  -- (d) a torneira do banco fechou.
  -- Procura o LITERAL entre aspas — a forma como a função semeava —, não a
  -- palavra solta. `pg_get_functiondef` devolve o corpo COM os comentários:
  -- a primeira versão desta prova usava `ILIKE '%upsell%'` e abortou a
  -- migration ao casar com o próprio comentário que ela mesma escreveu.
  SELECT count(*) INTO v_torneira
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_default_pipeline_stages'
     AND pg_get_functiondef(p.oid) LIKE ANY (ARRAY['%''upsell_base''%', '%''upsell_gestao''%']);
  IF v_torneira <> 0 THEN
    RAISE EXCEPTION 'FALHA: create_default_pipeline_stages ainda semeia carteira';
  END IF;

  -- (e) a carteira continua de pé — é o que esta migration promete não tocar
  IF to_regclass('public.upsell_clients') IS NULL
     OR to_regclass('public.upsell_orders') IS NULL THEN
    RAISE EXCEPTION 'FALHA: upsell_clients/upsell_orders sumiram — esta migration não apaga carteira';
  END IF;

  RAISE NOTICE 'OK: funis de carteira aposentados. upsell_clients e upsell_orders intactos.';
END $$;

COMMIT;

-- ============================================================================
-- O QUE ESTA MIGRATION NÃO RESOLVE — a outra metade é do front, e é decisão
-- em aberto (ADR-0005 / "a rota /carteira é terminada ou enterrada?").
--
-- 1. `is_active = false` NÃO tira o funil da tela. `usePipelineStages`
--    (src/modules/pipelines/hooks/model/usePipelineStages.ts:161) devolve
--    `DEFAULT_STAGES` em memória quando o banco não retorna etapa ativa — então
--    `/upsell` segue desenhando as 5 colunas de Gestão e os 739 clientes.
--    Enquanto `DEFAULT_STAGES.upsell_base/upsell_gestao` existirem, o funil
--    sobrevive à própria aposentadoria. Tirá-los quebra `/upsell`, que ainda
--    está no ar por link direto — por isso não entra aqui.
-- 2. A torneira VIVA era `ensureDefaultStagesInDb` (mesmo arquivo, :25-57):
--    upsert das 5 famílias, 1x por sessão por org. `ON CONFLICT DO NOTHING`
--    nunca reativaria o que esta migration desativou, mas org NOVA ganhava as
--    11 etapas de carteira ATIVAS pelo cliente, e é assim que Liris e Bolivar
--    nasceram. **Fechada no mesmo commit desta migration**: o laço agora semeia
--    só `whatsapp`/`confirmacao`/`propostas`. É mudança de front que acompanha
--    a migration porque sem ela o passo 3 não fecha torneira nenhuma.
-- 3. `handle_upsell_order_auto_move` (trigger em `upsell_orders`) procura etapa
--    `upsell_base` ATIVA para classificar o cliente. A partir daqui não acha
--    nenhuma e vira no-op silencioso: `upsell_clients.tipo_cliente_tempo`
--    congela no valor atual. É o efeito desejado (o funil morreu), mas é
--    mudança de comportamento e fica registrada aqui, não descoberta depois.
-- 4. HERDADO — `create_default_pipeline_stages` tem EXECUTE para `anon`, por
--    grant explícito E via PUBLIC (acl `{=X/postgres,...,anon=X/postgres,...}`).
--    Inerte hoje: a função é SECURITY INVOKER e `anon` não tem INSERT em
--    `pipeline_stages`. `CREATE OR REPLACE` preserva a ACL — esta migration não
--    piora nem conserta. Fechar exige REVOKE de PUBLIC **e** de anon, num card
--    próprio.
-- 5. HERDADO — as duas receitas de provisionamento DIVERGEM, e esta migration
--    preserva a divergência de propósito (mexer nela é outro assunto):
--    `create_default_pipeline_stages` escreve 7 etapas de `propostas`;
--    `DEFAULT_STAGES.propostas` escreve 8 (tem `proposta_enviada`, a função
--    não). Foi o que provou quem semeia as orgs novas. Quem for unificar
--    provisionamento começa por aqui.
-- ============================================================================
