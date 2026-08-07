-- ROLLBACK de 20270803000050_mover_negocio.sql
--
-- SCRUM-248. A migration cria `mover_negocio(uuid, uuid, text, text, uuid)` — a
-- porta única de MOVIMENTO do Negócio (ADR-0023 decisão 4). Ela substitui o par
-- "UPDATE na origem + INSERT no destino" que as três páginas de funil faziam, e
-- que deixava a origem para trás: é esse gêmeo que fazia 801 leads em prod
-- (medido 2026-08-03) aparecerem em mais de um funil de sistema ao mesmo tempo.
--
-- 🔴 ESTE É O ROLLBACK MAIS PERIGOSO DOS SETE, E O PERIGO NÃO ESTÁ NO BANCO.
-- A função é chamada pelo FRONTEND — `src/modules/pipelines/lib/moverNegocio.ts`,
-- consumido pelas quatro páginas de funil. Derrubá-la sem reverter o frontend
-- junto não degrada nada: quebra "avançar etapa" para as 98 organizações, na
-- hora, com 404 do PostgREST (`Could not find the function`). Não há fallback no
-- código — a porta é única de propósito.
--
--   ORDEM OBRIGATÓRIA:  reverter o frontend PRIMEIRO (ou no mesmo minuto), só
--   depois rodar este arquivo. O inverso é indisponibilidade.
--
-- A seção 0 não consegue provar isso do lado do banco — o Postgres não sabe quem
-- chama por PostgREST. Ela imprime o aviso e exige a variável de escape
-- `rollback.mover_negocio_frontend_revertido`, para que derrubar a porta seja um
-- ato deliberado e não o efeito colateral de rodar um lote de rollbacks.
--
-- ⚠️ O QUE ESTE ROLLBACK **NÃO** DESFAZ: os movimentos já feitos. Card que já
-- mudou de funil continua no destino, com o mesmo id — o move é UPDATE, não
-- INSERT, então não há linha nova para apagar nem linha velha para ressuscitar.
-- A posição anterior é irrecuperável a partir daqui; a fonte, se precisar
-- reconstruir, é `lead_history` / o ledger de eventos, não `pipeline_entries`.
--
-- ⚠️ E O QUE ELE RE-INTRODUZ: com a porta fora e o frontend antigo de volta, o
-- caminho de duas escritas volta, e com ele o gêmeo. Cada avanço de etapa passa a
-- deixar a origem para trás de novo. É dívida que cresce por uso, não por tempo —
-- quanto mais tempo revertido, mais gêmeos para reconciliar depois.
--
-- QUANDO PRECISA, DE VERDADE: se a função recusar movimento legítimo em massa
-- (por exemplo, orgs cujo funil de destino não é `type = 'system'` e que hoje
-- avançam por caminho custom), ou se os dois UPDATE dispararem gatilho em volume
-- inesperado. "A mensagem de erro é feia" não é motivo — é ajuste na função.
--
-- NÃO EXISTE VERSÃO ANTERIOR PARA REPOR. A função nasce nesta migration, então o
-- rollback é DROP, não CREATE OR REPLACE com o corpo antigo. Se você chegou aqui
-- procurando o corpo velho: ele não existe no banco, existe no frontend, no par
-- de escritas que a migration veio eliminar.

BEGIN;

-- ── 0. Guarda de ordem: o frontend foi revertido? ───────────────────────────
DO $$
DECLARE v_ok text;
BEGIN
  v_ok := current_setting('rollback.mover_negocio_frontend_revertido', true);

  IF v_ok IS DISTINCT FROM 'sim' THEN
    RAISE EXCEPTION
      'ABORTADO: derrubar mover_negocio quebra "avançar etapa" nas 98 organizações se o frontend ainda a chamar. Reverta `src/modules/pipelines/lib/moverNegocio.ts` e as quatro páginas de funil PRIMEIRO; depois rode com: SET LOCAL "rollback.mover_negocio_frontend_revertido" = ''sim'';'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RAISE NOTICE 'Guarda liberada: frontend declarado revertido.';
END$$;

-- ── 1. Diagnóstico ANTES do DROP ────────────────────────────────────────────
-- Colhido agora porque depois do DROP a informação continua existindo, mas quem
-- roda um rollback às pressas não volta para buscá-la. São os números que dizem
-- o tamanho da dívida que o caminho antigo vai recomeçar a produzir.
DO $$
DECLARE v_gemeos bigint; v_com_deal bigint;
BEGIN
  -- Leads ocupando mais de um funil de SISTEMA ao mesmo tempo — a forma do gêmeo
  -- que a migration veio eliminar. Este é o número que volta a crescer.
  SELECT count(*) INTO v_gemeos FROM (
    SELECT pe.lead_id
      FROM public.pipeline_entries pe
      JOIN public.pipelines p ON p.id = pe.pipeline_id
     WHERE p.type = 'system'
     GROUP BY pe.lead_id
    HAVING count(DISTINCT pe.pipeline_id) > 1
  ) x;

  SELECT count(*) INTO v_com_deal
    FROM public.pipeline_entries WHERE deal_id IS NOT NULL;

  RAISE NOTICE 'ANTES DO DROP: % lead(s) já em mais de um funil de sistema; % entry(ies) com deal_id.',
    v_gemeos, v_com_deal;
END$$;

-- ── 2. A porta ──────────────────────────────────────────────────────────────
-- Assinatura completa e explícita: `DROP FUNCTION` por nome nu falharia se
-- alguém tiver criado overload, e falhar aqui é melhor que derrubar a errada.
DROP FUNCTION IF EXISTS public.mover_negocio(uuid, uuid, text, text, uuid);

-- ── 3. Verificação ──────────────────────────────────────────────────────────
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'mover_negocio';

  IF v_n <> 0 THEN
    RAISE EXCEPTION
      'FAIL: ainda existe(m) % assinatura(s) de mover_negocio. Provável overload criado fora desta migration — liste com: SELECT oid::regprocedure FROM pg_proc WHERE proname = ''mover_negocio'';',
      v_n;
  END IF;

  RAISE NOTICE
    'ROLLBACK OK: mover_negocio fora. A partir daqui o avanço de etapa depende do caminho de DUAS escritas no frontend — e cada avanço volta a deixar a origem para trás. Reaplicar a migration restaura a porta; os gêmeos criados no intervalo NÃO são desfeitos por ela e precisam de reconciliação própria.';
END$$;

COMMIT;
