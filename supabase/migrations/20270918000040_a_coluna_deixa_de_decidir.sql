-- B2d, parte 2 de 2 — a coluna deixa de decidir ganho e perda.
--
-- ⚠️⚠️ NÃO APLICAR ANTES DO DEPLOY DO FRONT DA PARTE 1 (20270918000030).
--
-- A guarda no fim deste arquivo tenta impedir o erro, mas ela só enxerga o
-- banco. Se o front antigo ainda estiver no ar, `useFunilMetrics` deriva
-- ganho/perda das etapas fechadas, `closedKeys` fica vazio, e o cabeçalho de
-- todo funil passa a dizer "0 vendidos" em 107 orgs.
--
-- ── O que muda ───────────────────────────────────────────────────────────
-- 375 etapas perdem `stage_role = won/lost` e passam a 'open'. As colunas
-- CONTINUAM no quadro, com o mesmo nome, na mesma posição, com os mesmos
-- cards. O que elas perdem é o poder de registrar a venda.
--
-- Decisão do CTO, nas palavras dele: "deixar as colunas em si, mas elas viram
-- colunas normais; o que importa é se o negócio tá como ganhou ou perdeu".
--
-- ── A migração dos antigos JÁ ESTÁ FEITA ─────────────────────────────────
-- O CTO pediu para os cards que estão nessas colunas serem considerados ganho
-- ou perda conforme a coluna. Isso foi o B1 (20270914000010).
--
-- Medido agora, antes de escrever: dos 1.567 cards parados em etapa de
-- desfecho, 1.567 têm negócio e ZERO discordam. Nenhum card precisa ser
-- tocado aqui — só o papel da etapa sai.
--
-- ── O que se perde, e quem sente ─────────────────────────────────────────
-- `fn_capture_sale_event` só age quando o papel de origem ou destino é
-- won/lost. Sem papel nenhum, ele nunca dispara: **arrastar o card deixa de
-- registrar a venda**.
--
-- Medido em prod, 30 dias: 468 fechamentos por arrastar contra 5 pelo botão.
-- 99% da operação fecha arrastando, em 17 organizações:
--
--   Goletric Perdizes 193 · Goletric Pinheiros 180 · Basic4u 75
--   HGE ILUMINAÇÃO 34 · Chique Distribuidora 15 · Cantini Alimentos 11
--   Mapila Alimentos 11 · Agilsul 9 · Bolivar 5 · Maria Bonita 5
--   Milennials 3 · VZ Alimentos, Cervejaria Insana, Grafica Cauta,
--   Improving, Liris, TESTE — 1 cada
--
-- Quatro fecharam venda arrastando nos últimos 7 dias: Chique Distribuidora,
-- Cantini, Bolivar e HGE.
--
-- As 4 orgs que já usam o botão — Villa Branca, Metam, Carol Distribuidora e
-- Café Jurerê — nunca arrastaram. Os dois grupos não se cruzam.
--
-- 🔴 ISTO NÃO É EFEITO COLATERAL: é a fatia. O CTO decidiu com estes números
-- na frente. Fica escrito aqui para que ninguém, meses depois, leia isto como
-- descuido.
--
-- ── E o que se ganha junto ───────────────────────────────────────────────
-- `fn_capture_sale_event` também REABRE: tirar o card da coluna de ganho
-- voltava o negócio para 'open'. Some junto. O desfecho passa a grudar no
-- negócio independente de onde o card esteja — que é exatamente o que o CTO
-- pediu ao dizer "independente de tirar daquela coluna, já vai estar como
-- ganho ou perda".
--
-- A trava de valor antiga (`fn_exige_valor_na_venda`) também fica inerte pelo
-- mesmo motivo. Ela não é derrubada: a trava do NEGÓCIO (20270916000010) já
-- cobre os três caminhos, e deixar a velha de pé, inofensiva, significa que
-- reativar um papel won em alguma etapa volta a ter as duas defesas.
--
-- Reaplicar é no-op.

DO $$
DECLARE v_sem_negocio integer; v_discordam integer;
BEGIN
  -- ── Pré-condição: nenhum card pode perder o desfecho nesta troca ────────
  -- Se existisse card em etapa de ganho SEM negócio, ou com negócio dizendo
  -- outra coisa, tirar o papel apagaria a única evidência de que ele foi
  -- vendido. O B1 zerou os dois casos; esta guarda existe para o caso de
  -- alguém aplicar isto fora de ordem, ou meses depois.
  SELECT
    count(*) FILTER (WHERE pe.deal_id IS NULL),
    count(*) FILTER (WHERE pe.deal_id IS NOT NULL AND d.outcome NOT IN ('won','lost'))
  INTO v_sem_negocio, v_discordam
  FROM public.pipeline_entries pe
  JOIN public.pipelines p ON p.id = pe.pipeline_id
  JOIN public.pipeline_stages s
    ON s.organization_id = pe.organization_id
   AND s.pipeline_type = p.slug
   AND s.stage_key = pe.stage_key
  LEFT JOIN public.deals d ON d.id = pe.deal_id
  WHERE s.stage_role IN ('won','lost');

  IF v_sem_negocio > 0 THEN
    RAISE EXCEPTION '% card(s) em etapa de desfecho SEM negócio — rode o B1 antes, senão o desfecho deles se perde', v_sem_negocio;
  END IF;
  IF v_discordam > 0 THEN
    RAISE EXCEPTION '% card(s) em etapa de desfecho cujo negócio discorda — investigue antes de tirar o papel', v_discordam;
  END IF;
END $$;

-- ── O papel sai. A coluna fica. ──────────────────────────────────────────
-- `fn_pipeline_stages_guard_money_role` não bloqueia: ele só barra quem tenta
-- DEFINIR won/lost, e retorna cedo quando o papel novo não é dinheiro.
UPDATE public.pipeline_stages
   SET stage_role = 'open'
 WHERE stage_role IN ('won', 'lost');

DO $$
DECLARE v_restam integer; v_reuniao integer;
BEGIN
  SELECT count(*) INTO v_restam FROM public.pipeline_stages
   WHERE stage_role IN ('won','lost');
  IF v_restam > 0 THEN
    RAISE EXCEPTION '% etapa(s) ainda governadas como dinheiro', v_restam;
  END IF;

  -- Os papéis de REUNIÃO não podem ter ido junto: a agenda depende deles, e é
  -- o outro arco deste mesmo trabalho.
  SELECT count(*) INTO v_reuniao FROM public.pipeline_stages
   WHERE stage_role IN ('meeting_booked','meeting_held');
  IF v_reuniao = 0 THEN
    RAISE EXCEPTION 'os papeis de reuniao sumiram junto — isso quebra a agenda';
  END IF;
  RAISE NOTICE 'papeis de reuniao preservados: %', v_reuniao;
END $$;
