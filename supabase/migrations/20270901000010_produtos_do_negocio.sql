-- Produtos do Negócio — as portas de escrita de `deal_items`, com a validação
-- no banco em vez de no navegador.
--
-- ── O QUE JÁ EXISTIA, E POR QUE ISTO NÃO CRIA TABELA ──────────────────────
-- `deal_items` existe desde a Wave 1 com tudo o que o pedido precisa: produto
-- (de catálogo por `product_id`, ou avulso por `product_name`), `quantity`,
-- `unit_price`, `discount_percent` e `total` como coluna **GENERATED**
-- `((quantity*unit_price)*(1-discount_percent/100)) STORED`. E o valor do
-- negócio já é derivado: `trg_deal_items_sync_value` roda AFTER INSERT/UPDATE/
-- DELETE e faz `UPDATE deals SET value = SUM(deal_items.total)`.
--
-- Ou seja, a conta **já é do banco**. Criar tabela nova seria criar a segunda
-- verdade. O que faltava era (a) porta de UPDATE/DELETE — o repo inteiro só
-- tinha um INSERT cru — e (b) as três validações abaixo, que a RLS sozinha
-- não faz.
--
-- ── AS TRÊS COISAS QUE A RLS NÃO CHECA (e que estas funções passam a checar) ─
-- A policy `"Users manage deal items"` é `FOR ALL` com
-- `organization_id IN (SELECT get_my_organization_ids())` no USING e no
-- WITH CHECK. Ela prova que **a linha** é de uma org minha, e mais nada:
--
--   1. **`deal_id` não é checado.** Nada impede gravar um item com a MINHA
--      org apontando para o negócio de OUTRA. E como
--      `fn_sync_deal_value_from_items` é SECURITY DEFINER e atualiza
--      `deals` só por `id`, o valor daquele outro negócio seria reescrito.
--      Aqui a org passa a ser **derivada do negócio**, nunca recebida.
--   2. **`product_id` não é checado.** Dava para pendurar produto de outra
--      organização num negócio meu. É exatamente o "não permitir selecionar
--      produtos de outra organização" do pedido, e o lugar de garantir isso
--      é aqui — o front pode ser contornado.
--   3. **quantidade/preço/desconto** chegavam crus do navegador. Os CHECKs da
--      tabela pegam o caso absurdo, mas devolvem `23514` sem contexto.
--
-- Por isso as três funções são **SECURITY INVOKER**: a permissão continua
-- sendo a da RLS (basta ser membro ativo da org — não há checagem de cargo em
-- `deal_items`, e não é esta migration que vai inventar uma). O que muda é que
-- o *escopo* deixa de ser escolhido pelo chamador.
--
-- 🚨 **E VALIDAÇÃO EM PORTA NOVA NÃO VALE NADA COM A PAREDE ABERTA.**
-- `GRANT ALL ON TABLE public.deal_items TO authenticated` (baseline:44955) deixa
-- qualquer usuário logado fazer `POST /rest/v1/deal_items` direto, com
-- `organization_id` = a minha e `deal_id` = o de outra org. A policy aprova
-- (ela só olha a coluna `organization_id` da própria linha), e daí o
-- `fn_sync_deal_value_from_items`, que é SECURITY DEFINER e atualiza `deals`
-- **só por id**, reescreve o valor do negócio alheio.
--
-- Por isso a garantia NÃO mora nas RPCs: mora no gatilho
-- `trg_deal_items_tenant_coerente` do bloco 3b, que recusa qualquer item cuja
-- org não seja a do negócio, ou cujo produto seja de outra org — venha ele das
-- RPCs, de um `POST` direto no PostgREST, de `service_role` ou de uma edge
-- function que ainda não existe. As validações das RPCs continuam valendo pela
-- MENSAGEM (dizem o que houve, em vez de devolver `23514` cru), não por serem
-- a última linha de defesa. O bloco 7 explica por que o `GRANT` da tabela não
-- pode simplesmente ser revogado.
--
-- ── REGRA DE PRODUTO DUPLICADO: CONSOLIDA ─────────────────────────────────
-- Lançar duas vezes o mesmo produto passa a **somar na linha que já existe**,
-- em vez de criar uma segunda. Não é preferência de gosto — hoje o duplicado
-- QUEBRA o negócio (ver o bloco 3 abaixo). Item avulso consolida por nome
-- normalizado (`lower(btrim(...))`), que é a única identidade que ele tem.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. A FK que nunca existiu: `deal_items.deal_id` → `deals.id`
-- ═══════════════════════════════════════════════════════════════════════════
-- `deal_items` tem FK para `organizations` e para `products`, e **nenhuma para
-- `deals`** — apesar de `deal_id` ser NOT NULL. Consequências que já valem
-- hoje: apagar um negócio deixa os itens vivos e invisíveis, e um `deal_id`
-- inexistente entra sem reclamação.
--
-- Entra **VALIDADA**, e isso é uma decisão medida, não otimismo: em prod, em
-- 26/08/2026, `deal_items` tem **5 linhas** e **0 órfãs**
-- (`LEFT JOIN deals … WHERE d.id IS NULL` → 0). Com esse tamanho a validação é
-- instantânea e o lock é irrelevante.
--
-- Se em outro ambiente a validação falhar, é porque existe órfão de verdade
-- ali — e aí o certo é olhar os dados, não trocar por `NOT VALID` para o apply
-- passar.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deal_items_deal_id_fkey'
      AND conrelid = 'public.deal_items'::regclass
  ) THEN
    ALTER TABLE public.deal_items
      ADD CONSTRAINT deal_items_deal_id_fkey
      FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── O ÚNICO QUE FAZ O DUPLICADO SER IMPOSSÍVEL ────────────────────────────
-- Um mesmo `product_id` duas vezes no mesmo negócio é o que estoura `21000` no
-- gatilho de negócio ganho (bloco 3). O `GROUP BY` de lá conserta o efeito; o
-- índice abaixo mata a causa.
--
-- Medido em prod antes de escrever: **0 pares (deal_id, product_id) repetidos**
-- — então o índice entra sem varrer para cima de dado torto. É parcial porque
-- item **avulso** tem `product_id` NULL, e NULL não conflita em unique: para
-- ele a identidade é o nome, e quem serializa é o lock consultivo do bloco 4.
--
-- O que isto CUSTA, e é decisão consciente: deixa de ser possível ter a mesma
-- referência de catálogo duas vezes no mesmo negócio com preços diferentes.
-- Quem precisar disso lança como avulso, ou usa o desconto por linha. O preço
-- de permitir era um negócio que não fecha.
CREATE UNIQUE INDEX IF NOT EXISTS uq_deal_items_deal_produto
  ON public.deal_items (deal_id, product_id)
  WHERE product_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. `updated_at` — editar um item deixava zero rastro
-- ═══════════════════════════════════════════════════════════════════════════
-- A tabela tem `created_at` e não tinha `updated_at`. Sem UPDATE no repo isso
-- não incomodava ninguém; com edição de quantidade e preço, incomoda: passa a
-- existir uma alteração de dinheiro sem quando.
--
-- Mesmo padrão da irmã `lead_products` (`set_lead_products_updated_at`).
ALTER TABLE public.deal_items
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS set_deal_items_updated_at ON public.deal_items;
CREATE TRIGGER set_deal_items_updated_at
  BEFORE UPDATE ON public.deal_items
  FOR EACH ROW
  EXECUTE FUNCTION extensions.moddatetime('updated_at');

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. CONSERTO: produto duplicado ABORTA o "ganhar negócio"
-- ═══════════════════════════════════════════════════════════════════════════
-- `trg_deal_won_lead_products` dispara quando `deals.won` vira true e copia os
-- itens para `lead_products` com
-- `ON CONFLICT (lead_id, product_id, organization_id) DO UPDATE`.
--
-- `deal_items` **não tem UNIQUE (deal_id, product_id)** — o mesmo produto pode
-- estar duas vezes no mesmo negócio, e a tela permitia isso. Quando acontece,
-- o SELECT devolve DUAS linhas com a mesma chave de conflito, e o Postgres
-- recusa com `21000 — ON CONFLICT DO UPDATE command cannot affect row a second
-- time`. Como o gatilho é AFTER UPDATE na mesma transação, o erro **derruba o
-- UPDATE que marcou `won = true`**: o negócio simplesmente não é ganho, e a
-- mensagem que chega na tela não fala de produto nenhum.
--
-- O conserto é agregar por produto antes do ON CONFLICT. Assim o gatilho passa
-- a ser correto por construção, e não por confiar que ninguém duplicou —
-- inclusive para os duplicados que já existirem na base, que a consolidação da
-- porta nova não desfaz.
--
-- Nada mais do corpo muda: mesma cláusula de disparo, mesmo `source`, mesmo
-- `purchase_count = 1` por negócio ganho, mesmo cálculo de `avg_cycle_days`.
CREATE OR REPLACE FUNCTION public.fn_deal_won_populate_lead_products()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  IF NEW.won = true AND (OLD.won IS DISTINCT FROM true) AND NEW.source_lead_id IS NOT NULL THEN
    INSERT INTO public.lead_products (
      lead_id, product_id, organization_id,
      source, source_deal_id,
      quantity_total, revenue_total,
      first_purchased_at, last_purchased_at,
      purchase_count, status
    )
    SELECT
      NEW.source_lead_id,
      di.product_id,
      NEW.organization_id,
      'deal',
      NEW.id,
      -- AGREGADO: duas linhas do mesmo produto viram uma compra só, com a
      -- quantidade e a receita somadas. Sem isto, `21000`.
      SUM(di.quantity),
      SUM(di.total),
      COALESCE(NEW.closed_at, now()),
      COALESCE(NEW.closed_at, now()),
      1,
      'active'
    FROM public.deal_items di
    WHERE di.deal_id = NEW.id
      AND di.product_id IS NOT NULL
      -- Predicado de org: esta função é SECURITY DEFINER e escreve
      -- `lead_products` com `organization_id = NEW.organization_id`. Sem ele,
      -- um item de outra org pendurado neste negócio entraria no histórico de
      -- compras DESTA. O gatilho `trg_deal_items_tenant_coerente` impede que
      -- essa linha nasça, mas o caminho fica fechado dos dois lados: um deles
      -- vale para as linhas que já existiam antes desta migration.
      AND di.organization_id = NEW.organization_id
    GROUP BY di.product_id
    ON CONFLICT (lead_id, product_id, organization_id)
    DO UPDATE SET
      source = 'deal',
      source_deal_id = NEW.id,
      quantity_total = lead_products.quantity_total + EXCLUDED.quantity_total,
      revenue_total = lead_products.revenue_total + EXCLUDED.revenue_total,
      last_purchased_at = EXCLUDED.last_purchased_at,
      purchase_count = lead_products.purchase_count + 1,
      avg_cycle_days = CASE
        WHEN lead_products.purchase_count >= 1
          AND lead_products.first_purchased_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (EXCLUDED.last_purchased_at - lead_products.first_purchased_at))::integer
             / 86400
             / (lead_products.purchase_count + 1)
        ELSE NULL
      END,
      status = 'active',
      updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_deal_won_populate_lead_products() IS
  'Copia os produtos do negócio ganho para lead_products. AGREGA por product_id antes do ON CONFLICT: sem GROUP BY, dois itens do mesmo produto no mesmo negócio davam 21000 e derrubavam o UPDATE que marcava won=true.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3b. A COERÊNCIA DE TENANT, garantida no banco e não na porta
-- ═══════════════════════════════════════════════════════════════════════════
-- A RLS de `deal_items` prova que a LINHA é de uma org minha, e nada além
-- disso: `deal_id` e `product_id` não são olhados por nenhuma policy. Este
-- gatilho passa a exigir que os três concordem.
--
-- É gatilho, e não a `CHECK`/FK composta que seria mais bonita, por um motivo
-- prático: FK composta `(deal_id, organization_id) → deals(id, organization_id)`
-- exigiria um UNIQUE novo em `deals(id, organization_id)` e a validação de
-- TODAS as linhas existentes — que ninguém mediu. O gatilho vale só para
-- escrita nova, que é exatamente o recorte seguro.
--
-- `SECURITY INVOKER` de propósito: ele só precisa LER `deals` e `products`, e
-- se quem escreve não enxerga aquele negócio, o `NOT FOUND` já é a resposta
-- certa. DEFINER aqui daria ao gatilho mais visão do que quem o disparou.
CREATE OR REPLACE FUNCTION public.fn_deal_items_tenant_coerente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_do_negocio uuid;
BEGIN
  SELECT d.organization_id INTO v_org_do_negocio
    FROM public.deals d
   WHERE d.id = NEW.deal_id;

  IF v_org_do_negocio IS NULL THEN
    RAISE EXCEPTION 'Negócio % não existe (ou não é visível para quem está escrevendo).', NEW.deal_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.organization_id IS DISTINCT FROM v_org_do_negocio THEN
    RAISE EXCEPTION 'Item de produto não pode pertencer a uma organização diferente da do negócio.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.product_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.products p
        WHERE p.id = NEW.product_id
          AND p.organization_id = NEW.organization_id
     ) THEN
    RAISE EXCEPTION 'Produto % não pertence à organização deste negócio.', NEW.product_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_deal_items_tenant_coerente() IS
  'Exige que deal_items.organization_id seja a org do negócio e que o produto seja da mesma org. A RLS de deal_items só olha a coluna organization_id da própria linha — sem isto, um membro grava item com a org dele apontando para o negócio de outra, e o trigger SECURITY DEFINER de sincronia reescreve o valor daquele negócio alheio.';

DROP TRIGGER IF EXISTS trg_deal_items_tenant_coerente ON public.deal_items;
CREATE TRIGGER trg_deal_items_tenant_coerente
  BEFORE INSERT OR UPDATE OF deal_id, organization_id, product_id ON public.deal_items
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_deal_items_tenant_coerente();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. `deal_item_lancar` — adicionar produto (consolidando duplicado)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.deal_item_lancar(
  p_deal_id          uuid,
  p_product_id       uuid,
  p_product_name     text,
  p_quantity         numeric,
  p_unit_price       numeric,
  p_discount_percent numeric DEFAULT 0
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_org      uuid;
  v_nome     text    := NULLIF(btrim(COALESCE(p_product_name, '')), '');
  v_desconto numeric := COALESCE(p_discount_percent, 0);
  v_id       uuid;
BEGIN
  -- A org vem do NEGÓCIO, nunca de parâmetro. Com RLS de invoker, negócio de
  -- outra organização não é visível e a função aborta aqui — o chamador não
  -- consegue escolher em qual org escreve. Mesmo desenho de `abrir_negocio`.
  SELECT d.organization_id INTO v_org
    FROM public.deals d
   WHERE d.id = p_deal_id
     AND d.deleted_at IS NULL;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Negócio % não encontrado (ou está na lixeira).', p_deal_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_nome IS NULL THEN
    RAISE EXCEPTION 'O item precisa de um nome de produto.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantidade tem de ser maior que zero (recebi %).', p_quantity
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_unit_price IS NULL OR p_unit_price < 0 THEN
    RAISE EXCEPTION 'Preço unitário não pode ser negativo (recebi %).', p_unit_price
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_desconto < 0 OR v_desconto > 100 THEN
    RAISE EXCEPTION 'Desconto tem de ficar entre 0 e 100 (recebi %).', v_desconto
      USING ERRCODE = 'check_violation';
  END IF;

  -- Produto de OUTRA organização é recusado aqui, e não pela RLS — que não
  -- olha `product_id`. A mensagem daqui diz o que aconteceu; a da FK diria
  -- apenas que uma constraint falhou (e nem falharia, porque a FK só exige que
  -- o produto exista, não que seja meu).
  --
  -- `products.organization_id` é NULLABLE no schema. Produto sem dono NÃO
  -- passa: a tela também não o oferece (`useProducts` filtra por org), e
  -- deixar entrar por aqui abriria uma porta que a tela não tem.
  IF p_product_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.products p
        WHERE p.id = p_product_id
          AND p.organization_id = v_org
     ) THEN
    RAISE EXCEPTION 'Produto % não pertence à organização deste negócio.', p_product_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- ── Consolidação ───────────────────────────────────────────────────────
  -- Produto de catálogo casa por `product_id`; avulso casa por nome
  -- normalizado, que é a única identidade que ele tem.
  --
  -- 🚨 **`FOR UPDATE` não resolveria o caso que importa.** Ele tranca a linha
  -- que ENCONTRA — e o pior caso é justamente o primeiro lançamento, quando não
  -- há linha nenhuma: duas abas confirmando ao mesmo tempo passariam as duas
  -- pelo `SELECT` vazio e criariam as duas linhas, que é exatamente o duplicado
  -- que esta regra existe para impedir.
  --
  -- Trava de verdade é o lock consultivo abaixo, tomado sobre a IDENTIDADE do
  -- par (negócio, produto) antes da leitura. É de transação (`_xact_`), então
  -- solta sozinho no commit ou no rollback, sem risco de lock preso.
  --
  -- Ele COEXISTE com o `uq_deal_items_deal_produto` do bloco 1, e não é
  -- redundância: o índice cobre produto de CATÁLOGO e é a garantia dura; o
  -- lock cobre também o **avulso**, cuja identidade é o nome e que o índice
  -- não alcança (`product_id` NULL não conflita em unique). Sem o lock, duas
  -- abas lançando o mesmo avulso ao mesmo tempo criariam duas linhas.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_deal_id::text || ':' || COALESCE(p_product_id::text, 'avulso:' || lower(v_nome)),
      0
    )
  );

  SELECT di.id INTO v_id
    FROM public.deal_items di
   WHERE di.deal_id = p_deal_id
     AND (
       (p_product_id IS NOT NULL AND di.product_id = p_product_id)
       OR
       (p_product_id IS NULL AND di.product_id IS NULL
        AND lower(btrim(di.product_name)) = lower(v_nome))
     )
   ORDER BY di.created_at
   LIMIT 1
   FOR UPDATE;

  IF v_id IS NOT NULL THEN
    -- Soma a quantidade e adota o preço/desconto informados AGORA. A tela
    -- pré-preenche esses dois com os da linha existente, então quem só quer
    -- somar quantidade não muda preço sem querer — e quem quer corrigir o
    -- preço no mesmo gesto consegue.
    UPDATE public.deal_items
       SET quantity         = quantity + p_quantity,
           unit_price       = p_unit_price,
           discount_percent = v_desconto
     WHERE id = v_id;

    RETURN v_id;
  END IF;

  INSERT INTO public.deal_items (
    organization_id, deal_id, product_id, product_name,
    quantity, unit_price, discount_percent, sort_order
  )
  VALUES (
    v_org, p_deal_id, p_product_id, v_nome,
    p_quantity, p_unit_price, v_desconto,
    -- `sort_order` nasce no fim da lista. O escritor anterior deixava tudo em
    -- 0, e como a leitura não ordenava, a ordem na tela era a que o Postgres
    -- devolvesse — mudava sozinha entre dois carregamentos.
    COALESCE((SELECT MAX(di.sort_order) + 1 FROM public.deal_items di WHERE di.deal_id = p_deal_id), 0)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.deal_item_lancar(uuid, uuid, text, numeric, numeric, numeric) IS
  'Lança produto no negócio. A org é DERIVADA do negócio (nunca recebida), o produto é obrigado a ser da mesma org, e o mesmo produto CONSOLIDA na linha existente somando a quantidade. SECURITY INVOKER: a permissão continua sendo a RLS de deal_items.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. `deal_item_atualizar` — mudar quantidade, preço ou desconto
-- ═══════════════════════════════════════════════════════════════════════════
-- Devolve o `deal_id` afetado — e não a linha inteira — de propósito. Um
-- `RETURNS TABLE` faria dos nomes das colunas (`id`, `quantity`, `total`…)
-- variáveis de plpgsql dentro do próprio UPDATE, que é a receita clássica de
-- ambiguidade coluna×variável; e a tela não usa a linha de volta de qualquer
-- forma: ela invalida a chave do painel e relê. Mesma assinatura de saída da
-- irmã `deal_item_remover`, o que deixa as três portas com o mesmo formato.
CREATE OR REPLACE FUNCTION public.deal_item_atualizar(
  p_item_id          uuid,
  p_quantity         numeric,
  p_unit_price       numeric,
  p_discount_percent numeric DEFAULT 0
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_desconto numeric := COALESCE(p_discount_percent, 0);
  v_deal_id  uuid;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    -- Quantidade 0 não é "remover": a tabela tem CHECK (quantity > 0) e
    -- devolveria `23514` cru. Remover tem porta própria (`deal_item_remover`),
    -- e as duas ações precisam continuar distintas para o usuário.
    RAISE EXCEPTION 'Quantidade tem de ser maior que zero. Para tirar o produto do negócio, use Remover.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_unit_price IS NULL OR p_unit_price < 0 THEN
    RAISE EXCEPTION 'Preço unitário não pode ser negativo (recebi %).', p_unit_price
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_desconto < 0 OR v_desconto > 100 THEN
    RAISE EXCEPTION 'Desconto tem de ficar entre 0 e 100 (recebi %).', v_desconto
      USING ERRCODE = 'check_violation';
  END IF;

  -- Sem predicado de organização: a RLS de invoker já esconde item de outra
  -- org, e aí o UPDATE não acha linha nenhuma — que cai no ramo abaixo, com a
  -- MESMA mensagem de um id inexistente. Isso é de propósito: mensagens
  -- diferentes para "não é seu" e "não existe" viram um oráculo que confirma a
  -- existência de itens alheios.
  --
  -- `total` NÃO entra no SET: é coluna GENERATED e mandá-la devolve `428C9`.
  -- `deals.value` também não: quem o reescreve é `trg_deal_items_sync_value`.
  UPDATE public.deal_items di
     SET quantity         = p_quantity,
         unit_price       = p_unit_price,
         discount_percent = v_desconto
   WHERE di.id = p_item_id
  RETURNING di.deal_id INTO v_deal_id;

  IF v_deal_id IS NULL THEN
    RAISE EXCEPTION 'Item % não encontrado neste negócio.', p_item_id
      USING ERRCODE = 'no_data_found';
  END IF;

  RETURN v_deal_id;
END;
$$;

COMMENT ON FUNCTION public.deal_item_atualizar(uuid, numeric, numeric, numeric) IS
  'Edita quantidade/preço/desconto de um item do negócio. Valida as três faixas com mensagem legível em vez do 23514 cru, e nunca escreve `total` (GENERATED) nem `deals.value` (reescrito por trg_deal_items_sync_value).';

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. `deal_item_remover`
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.deal_item_remover(p_item_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_deal_id uuid;
BEGIN
  DELETE FROM public.deal_items di
   WHERE di.id = p_item_id
  RETURNING di.deal_id INTO v_deal_id;

  IF v_deal_id IS NULL THEN
    RAISE EXCEPTION 'Item % não encontrado neste negócio.', p_item_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Devolve o negócio afetado para quem chamou poder invalidar a tela certa.
  -- `deals.value` já foi reescrito pelo `trg_deal_items_sync_value` — inclusive
  -- para 0, quando este era o último item. Isso é o comportamento que já
  -- existia e está preservado de propósito: com itens, o valor do negócio É a
  -- soma deles, e um valor antigo sobrevivente seria uma segunda verdade.
  RETURN v_deal_id;
END;
$$;

COMMENT ON FUNCTION public.deal_item_remover(uuid) IS
  'Remove um item do negócio e devolve o deal_id afetado. O valor do negócio se recalcula sozinho pelo trg_deal_items_sync_value.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. ACL
-- ═══════════════════════════════════════════════════════════════════════════
-- A armadilha deste projeto tem dois lados e nenhum revoke sozinho fecha os
-- dois: `PUBLIC` concede implícito no CREATE, e um `ALTER DEFAULT PRIVILEGES`
-- concede NOMINALMENTE a `anon` e `authenticated` em toda função nova do
-- schema. Revogar dos dois, e conferir — gabarito no fim.
REVOKE ALL     ON FUNCTION public.deal_item_lancar(uuid, uuid, text, numeric, numeric, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.deal_item_lancar(uuid, uuid, text, numeric, numeric, numeric) FROM anon;
GRANT  EXECUTE ON FUNCTION public.deal_item_lancar(uuid, uuid, text, numeric, numeric, numeric) TO authenticated;

REVOKE ALL     ON FUNCTION public.deal_item_atualizar(uuid, numeric, numeric, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.deal_item_atualizar(uuid, numeric, numeric, numeric) FROM anon;
GRANT  EXECUTE ON FUNCTION public.deal_item_atualizar(uuid, numeric, numeric, numeric) TO authenticated;

REVOKE ALL     ON FUNCTION public.deal_item_remover(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.deal_item_remover(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.deal_item_remover(uuid) TO authenticated;

-- O gatilho é chamado no contexto de quem escreve; sem EXECUTE ele derruba a
-- própria escrita que deveria validar.
REVOKE ALL     ON FUNCTION public.fn_deal_items_tenant_coerente() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_deal_items_tenant_coerente() FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_deal_items_tenant_coerente() TO authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_deal_items_tenant_coerente() TO service_role;

-- ── POR QUE O `GRANT` DE ESCRITA DA TABELA **FICA** ───────────────────────
-- A tentação óbvia era `REVOKE INSERT, UPDATE, DELETE ON public.deal_items
-- FROM authenticated`, para fazer das três RPCs o único caminho de escrita.
-- **Isso se autodestruiria**: as três são `SECURITY INVOKER`, ou seja, correm
-- com as permissões de quem chama — o mesmo `authenticated`. Revogar o GRANT
-- da tabela derruba as RPCs junto, e a única saída seria torná-las
-- `SECURITY DEFINER`, o que troca um buraco pequeno por uma superfície bem
-- maior (é a classe de função que o `guard:master-ghost` deste repo existe
-- para vigiar).
--
-- Quem fecha o buraco de verdade é o `trg_deal_items_tenant_coerente` do bloco
-- 3b, e ele fecha MELHOR do que o revoke fecharia: vale para escrita direta na
-- tabela, para as RPCs, para `service_role` e para qualquer edge function
-- futura — nenhuma delas consegue mais pendurar item de uma org no negócio de
-- outra, que era o caminho pelo qual o `fn_sync_deal_value_from_items`
-- (SECURITY DEFINER, `UPDATE deals ... WHERE id = ...` sem predicado de org)
-- reescrevia o valor de um negócio alheio.

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Gabarito — que ASSERTA, não relata
-- ═══════════════════════════════════════════════════════════════════════════
-- Este bloco `DO` aborta a migration se qualquer garantia não tiver ficado de
-- pé. A diferença não é estilo: um `SELECT` de conferência devolve "false" numa
-- coluna e a migration termina **com sucesso** — foi assim que a
-- `20270829000001` deixou `anon` com EXECUTE e só se descobriu depois, medindo
-- em prod (ver `20270829000011`). O que precisa ser verdade tem de derrubar o
-- apply quando não for.
--
-- ⚠️ `REVOKE ... FROM PUBLIC` sozinho NÃO tira o grant NOMINAL que o
-- `ALTER DEFAULT PRIVILEGES` do schema concede a `anon` em toda função nova.
-- Os três `REVOKE ... FROM anon` acima é que fecham — e é isto que a asserção
-- de `anon` abaixo prova.
DO $$
DECLARE
  v_falhas text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'deal_items_deal_id_fkey'
       AND conrelid = 'public.deal_items'::regclass
  ) THEN v_falhas := v_falhas || ' · FK deal_items.deal_id não existe'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'deal_items' AND column_name = 'updated_at'
  ) THEN v_falhas := v_falhas || ' · coluna updated_at não existe'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_deal_items_tenant_coerente'
       AND tgrelid = 'public.deal_items'::regclass
  ) THEN v_falhas := v_falhas || ' · gatilho de coerência de tenant não armado'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'deal_items'
       AND indexname = 'uq_deal_items_deal_produto'
  ) THEN v_falhas := v_falhas || ' · índice único (deal_id, product_id) não existe'; END IF;

  -- A FK tem de estar VALIDADA (`convalidated`), não só presente: NOT VALID
  -- passaria na checagem de existência e deixaria as linhas antigas fora.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'deal_items_deal_id_fkey'
       AND conrelid = 'public.deal_items'::regclass
       AND convalidated
  ) THEN v_falhas := v_falhas || ' · FK deal_items.deal_id existe mas NÃO está validada'; END IF;

  -- `COALESCE(..., false)`: função ausente devolveria NULL, e `IF NOT NULL`
  -- não entra no ramo — a checagem passaria justamente no pior caso.
  IF NOT COALESCE((SELECT prosrc LIKE '%GROUP BY di.product_id%'
                     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'public' AND p.proname = 'fn_deal_won_populate_lead_products'), false)
  THEN v_falhas := v_falhas || ' · fn_deal_won_populate_lead_products sem o GROUP BY'; END IF;

  IF NOT COALESCE((SELECT prosrc LIKE '%di.organization_id = NEW.organization_id%'
                     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'public' AND p.proname = 'fn_deal_won_populate_lead_products'), false)
  THEN v_falhas := v_falhas || ' · fn_deal_won_populate_lead_products sem o predicado de org'; END IF;

  -- As três NÃO podem ser SECURITY DEFINER: a permissão tem de continuar sendo
  -- a RLS de quem chama.
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('deal_item_lancar', 'deal_item_atualizar', 'deal_item_remover')
         AND p.prosecdef = false) <> 3
  THEN v_falhas := v_falhas || ' · alguma das 3 RPCs não é SECURITY INVOKER'; END IF;

  IF has_function_privilege('anon', 'public.deal_item_lancar(uuid, uuid, text, numeric, numeric, numeric)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.deal_item_atualizar(uuid, numeric, numeric, numeric)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.deal_item_remover(uuid)', 'EXECUTE')
  THEN v_falhas := v_falhas || ' · anon ainda tem EXECUTE em alguma RPC'; END IF;

  IF NOT (has_function_privilege('authenticated', 'public.deal_item_lancar(uuid, uuid, text, numeric, numeric, numeric)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.deal_item_atualizar(uuid, numeric, numeric, numeric)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.deal_item_remover(uuid)', 'EXECUTE'))
  THEN v_falhas := v_falhas || ' · authenticated NÃO tem EXECUTE em alguma RPC'; END IF;

  IF v_falhas <> '' THEN
    RAISE EXCEPTION 'Produtos do Negócio — apply INCOMPLETO:%', v_falhas;
  END IF;
END $$;

-- Gabarito visível. Fica no ÚLTIMO statement de propósito: a Management API
-- devolve só o resultado dele, então quem aplicar vê a prova em vez de um "OK"
-- mudo. Todas as colunas têm de vir `true`, e `as_tres_sao_invoker` = 3.
SELECT
  EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'deal_items_deal_id_fkey'
       AND conrelid = 'public.deal_items'::regclass
  ) AS fk_deal_id,
  EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'deal_items' AND column_name = 'updated_at'
  ) AS coluna_updated_at,
  EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'set_deal_items_updated_at'
       AND tgrelid = 'public.deal_items'::regclass
  ) AS trigger_updated_at,
  EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_deal_items_tenant_coerente'
       AND tgrelid = 'public.deal_items'::regclass
  ) AS trigger_tenant_coerente,
  (SELECT prosrc LIKE '%di.organization_id = NEW.organization_id%'
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_deal_won_populate_lead_products'
  ) AS won_filtra_por_org,
  (SELECT prosrc LIKE '%GROUP BY di.product_id%'
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_deal_won_populate_lead_products'
  ) AS won_agrega_por_produto,
  has_function_privilege('anon',          'public.deal_item_lancar(uuid, uuid, text, numeric, numeric, numeric)', 'EXECUTE') AS lancar_anon,
  has_function_privilege('authenticated', 'public.deal_item_lancar(uuid, uuid, text, numeric, numeric, numeric)', 'EXECUTE') AS lancar_auth,
  has_function_privilege('anon',          'public.deal_item_atualizar(uuid, numeric, numeric, numeric)', 'EXECUTE') AS atualizar_anon,
  has_function_privilege('authenticated', 'public.deal_item_atualizar(uuid, numeric, numeric, numeric)', 'EXECUTE') AS atualizar_auth,
  has_function_privilege('anon',          'public.deal_item_remover(uuid)', 'EXECUTE') AS remover_anon,
  has_function_privilege('authenticated', 'public.deal_item_remover(uuid)', 'EXECUTE') AS remover_auth,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('deal_item_lancar', 'deal_item_atualizar', 'deal_item_remover')
      AND p.prosecdef = false
  ) AS as_tres_sao_invoker;
