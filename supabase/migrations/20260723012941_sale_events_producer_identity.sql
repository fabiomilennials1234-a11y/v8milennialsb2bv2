-- 20260722234500_sale_events_producer_identity.sql
--
-- ISSUE #1199 (PRD #1194 · #986) — Métricas Montáveis S5.
-- Identidade de produtor e chave de idempotência no livro-razão de vendas.
--
-- FATIA ADITIVA E ESCURA: nenhum produtor novo é ligado aqui. Só prepara o
-- livro para receber mais de um. Reversível.
--
-- ACHADO QUE ESTA FATIA FECHA
-- ---------------------------
-- `sale_events` NÃO TEM chave de idempotência. Verificado no catálogo de
-- produção: o único índice único da tabela é a própria PK (`sale_events_pkey`).
-- A não-duplicação de hoje é ESTRUTURAL — vem da condição dos gatilhos de
-- funil e do CHECK de transição real — não DECLARADA. Enquanto houver um só
-- produtor isso se sustenta por acidente feliz; no instante em que entrar o
-- segundo (Carteira, #1201), nada impede o mesmo pedido de emitir venda duas
-- vezes. Duplicar linha de dinheiro é o erro que não se descobre olhando.
--
-- O QUE MUDA
-- ----------
-- 1. `producer`         — quem emitiu o evento.
-- 2. `origin_record_id` — o registro do mundo que originou o evento
--                         (para Carteira: upsell_orders.id).
-- 3. Índice único parcial (producer, origin_record_id, event_type):
--    um pedido emite venda UMA vez e estorno UMA vez, POR CONSTRUÇÃO.
-- 4. `pipeline_id` e `stage_key` passam a aceitar NULL, com CHECK amarrando a
--    permissão ao produtor — só produtor sem funil pode omitir.
-- 5. A normalização de data passa a ISENTAR o produtor de Carteira.
--
-- POR QUE O RETROATIVO É `DEFAULT` E NÃO `UPDATE`
-- ------------------------------------------------
-- `trg_sale_events_immutable` bloqueia **todo** UPDATE em sale_events, sem
-- escape (fn_sale_events_block_mutation levanta P0001 em TG_OP='UPDATE',
-- incondicionalmente). Então não existe caminho de UPDATE para retroagir as
-- linhas existentes ao produtor de funil — e forçar um seria abrir buraco na
-- imutabilidade do livro para uma conveniência de migration.
--
-- `ADD COLUMN ... NOT NULL DEFAULT 'funnel'` resolve sem tocar em linha: desde
-- o PG11 o default é gravado no catálogo e materializado na leitura, sem
-- rewrite e SEM disparar trigger de linha. As 214 linhas existentes passam a
-- responder 'funnel' sem que uma única delas seja reescrita.
--
-- O DEFAULT FICA. Não é descuido: esta fatia é ESCURA, e os dois produtores
-- atuais (fn_capture_sale_event, fn_backfill_state_sales) não declaram
-- `producer`. Remover o default quebraria os dois na hora. Quem entra depois
-- (#1201) declara o produtor explicitamente.
--
-- SOBRE A ISENÇÃO DE DATA — o ponto delicado
-- -------------------------------------------
-- `fn_sale_events_force_sold_at` sobrescreve `sold_at := now()` sempre que
-- `source = 'trigger'`. O pedido de Carteira tem data PRÓPRIA
-- (`upsell_orders.sold_at`; os 273 pedidos têm data real) que precisa
-- sobreviver, senão a receita histórica inteira entra com a data do dia da
-- carga.
--
-- O atalho seria gravar `source = 'backfill'` para escapar da normalização.
-- Isso teria efeito colateral: a projeção de comissão é disparada por
--   CREATE TRIGGER trg_sale_events_project_commission ... WHEN (NEW.source = 'trigger')
-- ou seja, `backfill` NÃO projeta comissão. Trocar a fonte para fugir da data
-- desligaria dinheiro por tabela.
--
-- Por isso a isenção é pelo PRODUTOR e não pela FONTE: Carteira mantém
-- `source='trigger'` e é dispensada da normalização.
--
-- NOTA DE ESTADO REAL (medido em prod nesta data, e vale registrar):
-- `trg_sale_events_project_commission` e a função de projeção NÃO EXISTEM em
-- produção — só a coluna `commissions.source` chegou lá, e `commissions` tem 0
-- linhas. Ou seja: hoje, em prod, nenhum dos dois caminhos ligaria ou
-- desligaria comissão, porque não há projeção ligada. A isenção é feita do
-- jeito certo mesmo assim — quando a projeção for religada, Carteira precisa
-- cair do lado certo sem que ninguém tenha que lembrar disso.
--
-- ESTA FATIA NÃO LIGA PROJEÇÃO DE COMISSÃO. O CTO decidiu que Carteira gera
-- comissão, mas não desde quando nem para quem; a #1201 entrega com projeção
-- DESLIGADA, que é o estado seguro.

-- ---------------------------------------------------------------------------
-- 1. Colunas de identidade
-- ---------------------------------------------------------------------------
ALTER TABLE public.sale_events
  ADD COLUMN IF NOT EXISTS producer         text NOT NULL DEFAULT 'funnel',
  ADD COLUMN IF NOT EXISTS origin_record_id uuid;

COMMENT ON COLUMN public.sale_events.producer IS
  'Quem emitiu este evento. "funnel" = transição de etapa (fn_capture_sale_event / '
  'fn_backfill_state_sales). "carteira" = pedido de Carteira (#1201). Linhas '
  'anteriores a #1199 retroagem a "funnel" pelo DEFAULT da coluna, sem UPDATE — '
  'o livro é append-only e trg_sale_events_immutable bloqueia UPDATE sem escape.';

COMMENT ON COLUMN public.sale_events.origin_record_id IS
  'Registro do mundo que originou o evento — para "carteira", upsell_orders.id. '
  'É a metade da chave de idempotência (ver uq_sale_events_producer_origin_event). '
  'NULL nas linhas de funil anteriores a #1199, e por isso o índice é PARCIAL.';

-- Vocabulário fechado. Produtor desconhecido é erro, não extensão silenciosa:
-- um produtor novo tem que passar por migration, e a migration é onde se
-- pergunta "e o CHECK de coerência, e a chave de idempotência?".
ALTER TABLE public.sale_events
  DROP CONSTRAINT IF EXISTS sale_events_producer_check;
ALTER TABLE public.sale_events
  ADD CONSTRAINT sale_events_producer_check
  CHECK (producer IN ('funnel', 'carteira'));

-- ---------------------------------------------------------------------------
-- 2. Funil e etapa passam a ser opcionais — para quem não tem funil
-- ---------------------------------------------------------------------------
ALTER TABLE public.sale_events ALTER COLUMN pipeline_id DROP NOT NULL;
ALTER TABLE public.sale_events ALTER COLUMN stage_key   DROP NOT NULL;

-- A permissão de omitir é do PRODUTOR, não geral. Sem isto, afrouxar o
-- NOT NULL abriria a porta para o produtor de funil gravar venda sem funil —
-- que é exatamente o tipo de linha que quebra get_funnel_flow em silêncio.
ALTER TABLE public.sale_events
  DROP CONSTRAINT IF EXISTS sale_events_producer_funnel_coherence;
ALTER TABLE public.sale_events
  ADD CONSTRAINT sale_events_producer_funnel_coherence
  CHECK (
    CASE producer
      WHEN 'funnel'   THEN pipeline_id IS NOT NULL AND stage_key IS NOT NULL
      WHEN 'carteira' THEN true   -- Carteira não tem funil nem etapa
      ELSE false                  -- produtor fora do vocabulário: barrado
    END
  );

-- Produtor sem funil é obrigado a declarar a origem. É o que torna a chave de
-- idempotência load-bearing: sem origem declarada, o índice parcial não pega.
ALTER TABLE public.sale_events
  DROP CONSTRAINT IF EXISTS sale_events_origin_required_off_funnel;
ALTER TABLE public.sale_events
  ADD CONSTRAINT sale_events_origin_required_off_funnel
  CHECK (producer = 'funnel' OR origin_record_id IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 3. CHAVE DE IDEMPOTÊNCIA — o coração da fatia
-- ---------------------------------------------------------------------------
-- Um registro de origem emite, por produtor, no máximo um evento de cada tipo:
-- uma venda e um estorno. Segunda tentativa levanta unique_violation em vez de
-- duplicar dinheiro.
--
-- PARCIAL em origin_record_id IS NOT NULL: as 214 linhas de funil existentes
-- têm origem NULL e colidiriam entre si num índice total (NULLs não colidem em
-- btree, mas o índice parcial deixa a intenção explícita e mantém o índice
-- pequeno). Quando o produtor de funil passar a declarar origem, ele entra na
-- mesma proteção sem mudar nada aqui.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sale_events_producer_origin_event
  ON public.sale_events (producer, origin_record_id, event_type)
  WHERE origin_record_id IS NOT NULL;

COMMENT ON INDEX public.uq_sale_events_producer_origin_event IS
  'Chave de idempotência do livro-razão (#1199). Um registro de origem emite, '
  'por produtor, no máximo um evento de cada tipo. Antes desta fatia a '
  'não-duplicação era estrutural (condição dos gatilhos), não declarada — e o '
  'único índice único da tabela era a PK.';

-- ---------------------------------------------------------------------------
-- 4. Normalização de data — isenta o produtor de Carteira
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_sale_events_force_sold_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- A normalização existe para o funil: lá o `sold_at` que o produtor manda não
  -- é confiável (vem de estado mutável), e o instante do evento é a melhor
  -- âncora disponível.
  --
  -- Carteira é o caso oposto: o pedido TEM data própria e verdadeira
  -- (upsell_orders.sold_at). Sobrescrever com now() jogaria a receita histórica
  -- inteira para o dia da carga.
  --
  -- A isenção é pelo PRODUTOR, não pela FONTE, de propósito: trocar a fonte
  -- para 'backfill' também escaparia da normalização, mas desligaria a projeção
  -- de comissão (trg_sale_events_project_commission dispara WHEN source =
  -- 'trigger'). Fugir da data pela fonte custaria dinheiro por efeito colateral.
  IF NEW.source = 'trigger' AND NEW.producer <> 'carteira' THEN
    NEW.sold_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_sale_events_force_sold_at() IS
  'Normaliza sold_at para o instante do evento quando a fonte é gatilho. ISENTA '
  'o produtor "carteira", cujo pedido tem data própria (#1199). A isenção é por '
  'produtor e não por fonte porque source="backfill" desligaria a projeção de '
  'comissão.';

-- ---------------------------------------------------------------------------
-- 5. Índice de apoio para a leitura por produtor
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_sale_events_producer_sold_at
  ON public.sale_events (producer, sold_at);
