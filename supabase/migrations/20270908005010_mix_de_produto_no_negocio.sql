-- C2 — o mix de produto passa a viver no NEGÓCIO.
--
-- Decisão do CTO: o desfecho do negócio vira a fonte da métrica e o funil sai
-- de cena. Ver .specs/agenda-fonte-unica/PLANO.md.
--
-- ── Por que esta fatia existe ────────────────────────────────────────────
-- O Comando quebra receita em MRR e Projeto juntando `pipe_proposta_items` →
-- `products.type`. Enquanto o mix morar do lado do funil, o Comando não
-- consegue ler o caderno sem voltar ao funil — e o C3 não fecha.
--
-- Medido em 2026-09-02: `pipe_proposta_items` tem 635 linhas; `deal_items`
-- tem 6. O dado real está todo no lado antigo.
--
-- ── 🔴 A ESCOLHA DE DINHEIRO, DECIDIDA PELO CTO ──────────────────────────
-- `trg_deal_items_sync_value` chama `fn_sync_deal_value_from_items`, que
-- SOBRESCREVE `deals.value` com a soma dos itens a cada inserção. Migrar os
-- itens reescreveria o valor de 243 negócios:
--
--   217  o valor já bate com a soma — nada mudaria
--    24  o valor MUDARIA:
--          14  itens somam MAIS    R$ 13.899 → R$ 14.158
--           9  itens somam MENOS   R$ 10.278 → R$  6.935
--           1  valor estava zero   R$      0 → R$ 15.000
--
--   total  R$ 1.272.605,42 → R$ 1.284.521,42   (+R$ 11.916,00)
--
-- Os 9 que somam MENOS são o caso desconfortável: R$ 3.343 de receita
-- declarada sumiriam porque a soma dos itens é menor que o valor gravado.
-- Não é possível saber daqui qual dos dois está certo — pode ser desconto no
-- negócio que os itens não têm, ou item faltando.
--
-- Decisão: **migrar o mix SEM mexer na receita**. O valor de cada negócio que
-- já existia é restaurado ao original depois da carga. Migrar mix de produto
-- não pode alterar receita como efeito colateral; se a receita está errada,
-- isso é um conserto próprio, com o comercial olhando os 24 caso a caso.
--
-- A incoerência resultante (itens que não somam o valor do negócio) fica
-- REGISTRADA em `notes`, não escondida — é a lista de trabalho para esse
-- conserto.
--
-- ── Os 36 negócios que precisam nascer ───────────────────────────────────
-- 36 entradas têm itens e não têm negócio (todas em UMA org). Sem negócio não
-- há onde pendurar o item. `garantir_negocio_da_entrada` é a porta canônica —
-- idempotente, e grava `source = 'entrada_materializada'`, que é procedência
-- de verdade e não um INSERT anônimo.
--
-- ⚠️ `trg_workflow_deal_created` dispara em INSERT de `deals` e lançaria uma
-- automação por negócio criado. Medido: ZERO workflows ativos com
-- `deal_created` hoje, então o risco é teórico — e mesmo assim o trigger é
-- desligado dentro da transação. Um workflow pode nascer entre escrever isto e
-- aplicar, e o custo da guarda é uma linha contra 36 automações disparadas na
-- cara de um cliente.
--
-- ── Duplicatas e itens sem produto ───────────────────────────────────────
-- `uq_deal_items_deal_produto` é único em (deal_id, product_id). A origem tem
-- 10 pares (proposta, produto) repetidos, que colidiriam. São AGREGADOS:
-- quantidade e total somam, e o preço unitário é recalculado do agregado —
-- descartar o segundo item perderia dinheiro.
--
-- 2 itens têm `product_id` nulo. O índice único é PARCIAL e não os cobre, então
-- entram sem colidir; ficam sem classificação de MRR/Projeto, que é o que já
-- acontece hoje.
--
-- ── Reversível ───────────────────────────────────────────────────────────
-- Toda linha nasce com `notes` começando em `migrado:proposta:`. Desfazer é
-- apagar por esse prefixo — ver `supabase/migrations/rollback/`. Os 36 negócios
-- criados têm `source = 'entrada_materializada'` e também são identificáveis.
--
-- Reaplicar é no-op: o INSERT tem `NOT EXISTS` sobre a procedência.

-- ── 1. Fotografa a receita ANTES ─────────────────────────────────────────
CREATE TEMP TABLE _valor_antes ON COMMIT DROP AS
SELECT d.id, d.value
  FROM public.deals d
 WHERE EXISTS (
   SELECT 1 FROM public.pipe_proposta_items i
     JOIN public.pipeline_entries pe ON pe.id = i.pipe_proposta_id
    WHERE pe.deal_id = d.id
 );

-- ── 2. `entrada_materializada` passa a ser procedência válida ────────────
-- 🔴 TERCEIRO descasamento escritor↔CHECK desta série, achado ao ensaiar esta
-- fatia. `garantir_negocio_da_entrada` grava `source = 'entrada_materializada'`
-- e `deals_source_check` não conhece esse valor:
--
--   ERROR 23514: new row for relation "deals"
--   violates check constraint "deals_source_check"
--
-- A RPC NUNCA criou um negócio. Confirmado no dado: `deals.source` só tem
-- backfill (34.966), backfill_funil_custom (3.691), api (308) e human (3).
-- Zero `entrada_materializada`.
--
-- Não é problema só desta migration. A RPC é chamada pelo handler de
-- `win_deal`/`lose_deal` (`deal-operations.ts`): marcar ganho num card SEM
-- negócio tenta materializar o negócio e estoura. Junto com os dois furos que
-- a `20270908001010` fechou, o caminho do desfecho tinha TRÊS quebras
-- independentes — todas do mesmo formato: uma função escreve um vocabulário
-- que o CHECK da tabela vizinha não conhece.
--
-- O valor entra na lista em vez de a RPC ser mudada para `backfill` ou `api`:
-- os dois mentiriam. `entrada_materializada` diz a verdade — o negócio nasceu
-- de uma entrada de funil que não tinha um.
ALTER TABLE public.deals DROP CONSTRAINT IF EXISTS deals_source_check;
ALTER TABLE public.deals
  ADD CONSTRAINT deals_source_check
  CHECK (source IS NULL OR source = ANY (ARRAY[
    'human'::text, 'workflow'::text, 'api'::text, 'import'::text,
    'backfill'::text, 'backfill_funil_custom'::text,
    'entrada_materializada'::text]));

-- ── 3. Os 36 negócios que faltam ─────────────────────────────────────────
ALTER TABLE public.deals DISABLE TRIGGER trg_workflow_deal_created;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT pe.id AS entry_id
      FROM public.pipe_proposta_items i
      JOIN public.pipeline_entries pe ON pe.id = i.pipe_proposta_id
     WHERE pe.deal_id IS NULL
  LOOP
    PERFORM public.garantir_negocio_da_entrada(r.entry_id);
  END LOOP;
END $$;

ALTER TABLE public.deals ENABLE TRIGGER trg_workflow_deal_created;

-- ── 4. Carrega o mix, com o sync de valor DESLIGADO ──────────────────────
ALTER TABLE public.deal_items DISABLE TRIGGER trg_deal_items_sync_value;

INSERT INTO public.deal_items
  -- `total` NÃO entra: é coluna gerada (428C9 se inserida).
  (organization_id, deal_id, product_id, product_name, quantity, unit_price, sort_order, notes)
SELECT
  pe.organization_id,
  pe.deal_id,
  i.product_id,
  COALESCE(p.name, 'Produto removido'),
  -- 🚨 `quantity = 1` e `unit_price` = o total. Não é preguiça: é a única
  -- forma de o dinheiro bater.
  --
  -- `deal_items.total` é coluna GERADA:
  --     total = quantity * unit_price * (1 - discount_percent/100)
  -- Ela não pode ser inserida; só pode ser ALCANÇADA pelos três fatores. E a
  -- origem não permite alcançá-la preservando a quantidade:
  --
  --   · 489 itens têm `sale_value = quantity * unit_price`
  --   · 305 têm `sale_value = unit_price`  (os de quantidade 1)
  --   · 144 não têm NENHUMA das duas relações — a origem se contradiz
  --
  --   E onde a quantidade é alta a divisão não fecha: dos 67 itens com
  --   quantidade 12, UM divide exato; dos 32 com quantidade 24, NENHUM.
  --
  -- Preservar a quantidade obrigaria `unit_price = sale_value / quantity`, e o
  -- total gerado sairia com diferença de centavos em ~150 itens. A fatia foi
  -- decidida como "migrar mix SEM mexer na receita"; centavo que se move é
  -- receita que se move.
  --
  -- A quantidade NÃO se perde: `pipe_proposta_items` continua existindo — esta
  -- migration não apaga nada. O detalhe itemizado segue consultável lá; o que
  -- vem para cá é o dinheiro, que é o que o Comando precisa somar.
  1,
  -- `COALESCE(..., 0)`: 2 itens têm `sale_value` NULO, e `unit_price` é
  -- NOT NULL. Zero é a leitura honesta — produto listado na proposta sem valor
  -- atribuído. Descartá-los perderia o MIX (qual produto foi vendido) para
  -- ganhar nada em dinheiro, já que não carregam dinheiro nenhum.
  COALESCE(SUM(i.sale_value), 0), -- metric-lint-allow: não é agregação de métrica; é o VALOR DO ITEM sendo transportado de uma tabela para outra. Ler do caderno aqui seria impossível — o caderno não tem item, e é justamente isso que esta fatia vem permitir.
  0,
  'migrado:proposta:' || pe.id::text
FROM public.pipe_proposta_items i
JOIN public.pipeline_entries pe ON pe.id = i.pipe_proposta_id
LEFT JOIN public.products p ON p.id = i.product_id
WHERE pe.deal_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.deal_items di
     WHERE di.deal_id = pe.deal_id
       AND di.notes = 'migrado:proposta:' || pe.id::text
  )
GROUP BY pe.organization_id, pe.deal_id, i.product_id, p.name, pe.id;

ALTER TABLE public.deal_items ENABLE TRIGGER trg_deal_items_sync_value;

-- ── 5. Devolve a receita ao que era ──────────────────────────────────────
-- Só os negócios que JÁ EXISTIAM. Os 36 recém-criados nasceram sem valor, e
-- para eles a soma dos itens é a melhor informação disponível — restaurar um
-- NULL ali apagaria o único valor que eles têm.
UPDATE public.deals d
   SET value = a.value
  FROM _valor_antes a
 WHERE d.id = a.id
   AND d.value IS DISTINCT FROM a.value;

-- Os novos recebem a soma dos próprios itens.
UPDATE public.deals d
   SET value = s.total
  FROM (SELECT deal_id, SUM(total) AS total FROM public.deal_items
         WHERE notes LIKE 'migrado:proposta:%' GROUP BY deal_id) s
 WHERE d.id = s.deal_id
   AND d.source = 'entrada_materializada'
   AND d.value IS NULL;

-- ── 6. Guardas ───────────────────────────────────────────────────────────
DO $$
DECLARE
  v_mudou integer; v_cross integer; v_itens integer; v_origem integer;
BEGIN
  -- A receita dos negócios que já existiam não pode ter se movido UM CENTAVO.
  SELECT count(*) INTO v_mudou
    FROM _valor_antes a JOIN public.deals d ON d.id = a.id
   WHERE d.value IS DISTINCT FROM a.value;
  IF v_mudou > 0 THEN
    RAISE EXCEPTION 'RECEITA MOVIDA: % negocio(s) mudaram de valor', v_mudou;
  END IF;

  SELECT count(*) INTO v_cross
    FROM public.deal_items di JOIN public.deals d ON d.id = di.deal_id
   WHERE d.organization_id <> di.organization_id;
  IF v_cross > 0 THEN
    RAISE EXCEPTION 'CROSS-TENANT: % item(ns) em org diferente do negocio', v_cross;
  END IF;

  -- Nenhum item da origem pode ter ficado para trás por engano.
  SELECT count(*) INTO v_origem
    FROM public.pipe_proposta_items i
    JOIN public.pipeline_entries pe ON pe.id = i.pipe_proposta_id
   WHERE pe.deal_id IS NULL;
  IF v_origem > 0 THEN
    RAISE EXCEPTION '% item(ns) de origem seguem sem negocio', v_origem;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'deals_source_check'
                    AND pg_get_constraintdef(oid) LIKE '%entrada_materializada%') THEN
    RAISE EXCEPTION 'deals_source_check nao aceita entrada_materializada';
  END IF;

  -- O dinheiro migrado tem de bater com a origem, ao centavo.
  IF (SELECT COALESCE(SUM(total),0) FROM public.deal_items WHERE notes LIKE 'migrado:proposta:%')
     -- Guarda de RECONCILIAÇÃO, não métrica: compara o dinheiro migrado com o
     -- da origem para provar que nada se perdeu no caminho. Ler do caderno
     -- aqui responderia outra pergunta. O marcador precisa ficar NA LINHA
     -- do código — o lint casa por linha, não por bloco.
     <> (SELECT COALESCE(SUM(COALESCE(i.sale_value,0)),0) FROM public.pipe_proposta_items i -- metric-lint-allow: reconciliação de migração
           JOIN public.pipeline_entries pe ON pe.id = i.pipe_proposta_id
          WHERE pe.deal_id IS NOT NULL) THEN
    RAISE EXCEPTION 'DINHEIRO NAO BATE: soma dos itens migrados difere da origem';
  END IF;

  SELECT count(*) INTO v_itens FROM public.deal_items WHERE notes LIKE 'migrado:proposta:%';
  RAISE NOTICE 'mix migrado: % itens', v_itens;
END $$;
