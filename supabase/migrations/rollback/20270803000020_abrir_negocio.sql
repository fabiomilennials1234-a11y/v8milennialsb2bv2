-- ROLLBACK de 20270803000020_abrir_negocio.sql
--
-- SCRUM-248. A migration cria DUAS funções, e o rollback derruba as duas:
--
--   `abrir_negocio(uuid, text, text, uuid, numeric, timestamptz, text, text)`
--       a porta única de CRIAÇÃO do Negócio (ADR-0023 decisão 3: nasce só por
--       clique humano). Faz as duas escritas inseparáveis — identidade em
--       `deals` e posição em `pipeline_entries`/`custom_pipe_entries`, ligadas
--       por `deal_id` — dentro de um corpo só, para que falha no meio não deixe
--       card órfão;
--
--   `fn_negocio_titulo_padrao(timestamptz, text)`
--       o título derivado `Negócio de <mês>/<ano>` no fuso da org (decisão 9).
--
-- 🔴 MESMO PERIGO DO ROLLBACK DE `mover_negocio`, E PELO MESMO MOTIVO: a porta é
-- chamada pelo FRONTEND (`.../modal/pipes/useAbrirNegocio.ts` → `NewDealDialog`,
-- e o `LeadCardNewDeal` do Card do Lead). Derrubá-la sem reverter o frontend
-- junto quebra "criar negócio" para as 98 organizações, na hora, com 404 do
-- PostgREST. Não existe fallback: a decisão 3 é justamente que não haja outro
-- caminho.
--
--   ORDEM OBRIGATÓRIA: reverter o frontend PRIMEIRO, depois este arquivo.
--
-- A seção 0 exige `rollback.abrir_negocio_frontend_revertido = 'sim'` pelo mesmo
-- motivo do outro: o Postgres não enxerga quem chama por PostgREST, então a
-- guarda é declarativa e serve para que a porta não caia como efeito colateral de
-- um lote de rollbacks rodado às pressas.
--
-- ⚠️ O QUE ESTE ROLLBACK **NÃO** DESFAZ: os negócios já abertos. As linhas em
-- `deals` e os `deal_id` já gravados nas entries continuam lá, e devem continuar
-- — apagá-los seria destruir dado de cliente para reverter uma função. Depois
-- deste rollback o estado é "existem negócios, e não há porta para criar mais".
--
-- ⚠️ E O QUE ELE DEIXA SEM RESPOSTA: com a porta fora, **não sobra caminho
-- nenhum de criação de negócio no repo** — o único `INSERT INTO deals` vivia em
-- `carteira/hooks/useDeals.ts`, apagado junto com a rota `/negocios` no passo 3.
-- Este é o estado medido em 2026-08-03 que motivou escrever a porta. Voltar a ele
-- é voltar a um produto em que ninguém abre negócio, não a um produto anterior
-- que funcionava de outro jeito.
--
-- POR ISSO: se o motivo do rollback for a porta recusar caso legítimo (lead na
-- lixeira, responsável de outra org, funil que "não abre negócio por esta
-- porta"), o certo é afrouxar a validação com uma migration nova, não derrubar a
-- porta. Este arquivo existe para o caso em que a função em si esteja errada —
-- transação que não fecha, card órfão, título gravado errado em volume.
--
-- NÃO EXISTE VERSÃO ANTERIOR PARA REPOR: as duas funções nascem nesta migration.
-- O rollback é DROP, e sem `CASCADE` de propósito — ver seção 2.

BEGIN;

-- ── 0. Guarda de ordem: o frontend foi revertido? ───────────────────────────
DO $$
DECLARE v_ok text;
BEGIN
  v_ok := current_setting('rollback.abrir_negocio_frontend_revertido', true);

  IF v_ok IS DISTINCT FROM 'sim' THEN
    RAISE EXCEPTION
      'ABORTADO: derrubar abrir_negocio quebra "criar negócio" nas 98 organizações se o frontend ainda a chamar — e não há outro caminho de criação no repo. Reverta `useAbrirNegocio.ts` / `NewDealDialog` / `LeadCardNewDeal` PRIMEIRO; depois rode com: SET LOCAL "rollback.abrir_negocio_frontend_revertido" = ''sim'';'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RAISE NOTICE 'Guarda liberada: frontend declarado revertido.';
END$$;

-- ── 1. Diagnóstico ANTES do DROP ────────────────────────────────────────────
-- O que a porta já produziu. Colhido agora porque é o insumo de qualquer decisão
-- posterior sobre reconciliar — e porque depois do DROP ninguém volta para pegar.
DO $$
DECLARE v_deals bigint; v_ligados bigint; v_orfaos bigint;
BEGIN
  SELECT count(*) INTO v_deals FROM public.deals;

  SELECT count(*) INTO v_ligados
    FROM public.pipeline_entries WHERE deal_id IS NOT NULL;

  -- Negócio sem nenhuma posição: o estado que a função existe para impedir. Se
  -- for > 0 AGORA, a porta não é a causa (ela é atômica) — vem de backfill ou de
  -- escrita direta, e é isso que precisa ser investigado, não a função.
  SELECT count(*) INTO v_orfaos
    FROM public.deals d
   WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_entries pe WHERE pe.deal_id = d.id)
     AND NOT EXISTS (SELECT 1 FROM public.custom_pipe_entries ce WHERE ce.deal_id = d.id);

  RAISE NOTICE 'ANTES DO DROP: % negócio(s) em deals; % entry(ies) ligada(s) por deal_id; % negócio(s) SEM posição.',
    v_deals, v_ligados, v_orfaos;

  IF v_orfaos > 0 THEN
    RAISE WARNING
      '% negócio(s) sem posição. A porta é atômica, então isto NÃO veio dela — procure em backfill ou escrita direta antes de culpar a função que você está prestes a derrubar.',
      v_orfaos;
  END IF;
END$$;

-- ── 2. As duas funções ──────────────────────────────────────────────────────
-- Sem `CASCADE`, de propósito e nas duas. `fn_negocio_titulo_padrao` é candidata
-- a ter virado dependência de outra coisa depois (default de coluna, view,
-- índice de expressão, outra função). Com CASCADE, o rollback levaria esses
-- objetos junto em silêncio; sem ele, o Postgres recusa e nomeia o dependente —
-- que é exatamente a informação de que quem roda precisa.
DROP FUNCTION IF EXISTS public.abrir_negocio(uuid, text, text, uuid, numeric, timestamptz, text, text);
DROP FUNCTION IF EXISTS public.fn_negocio_titulo_padrao(timestamptz, text);

-- ── 3. Verificação ──────────────────────────────────────────────────────────
DO $$
DECLARE v_porta int; v_titulo int;
BEGIN
  SELECT count(*) INTO v_porta
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'abrir_negocio';

  SELECT count(*) INTO v_titulo
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_negocio_titulo_padrao';

  IF v_porta <> 0 THEN
    RAISE EXCEPTION
      'FAIL: ainda existe(m) % assinatura(s) de abrir_negocio — provável overload fora desta migration. Liste com: SELECT oid::regprocedure FROM pg_proc WHERE proname = ''abrir_negocio'';',
      v_porta;
  END IF;

  IF v_titulo <> 0 THEN
    RAISE EXCEPTION
      'FAIL: fn_negocio_titulo_padrao ainda existe (% assinatura(s)).', v_titulo;
  END IF;

  RAISE NOTICE
    'ROLLBACK OK: abrir_negocio e fn_negocio_titulo_padrao fora. Os negócios já criados permanecem. NÃO HÁ, a partir daqui, caminho de criação de negócio no produto — reaplicar a migration é o que restaura a porta.';
END$$;

COMMIT;
