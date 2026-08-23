-- 20270812100001_metric_taxa_qualidade.sql
--
-- SCRUM-311, fatia 7 de 19: "Taxa de qualidade de leads".
--
-- ⚠ O NÚMERO DESTA MIGRATION PULOU PARA 2027-08-12, DE PROPÓSITO
--
-- A sequência natural seria `20270811180000`. Ela está TOMADA — e não pelo
-- épico de métricas. Medido em 2026-08-12 varrendo `git log --all` mais o
-- ledger de prod:
--
--     20270811150000  metric_boas_avaliacoes      ✗  billing_cycle_semiannual_canonical
--     20270811160000  metric_negocios_perdidos    ✗  payment_history_receipt_period_method
--                                                 ✗  payment_links_package
--     20270811170001  metric_tempo_resposta_equipe ✗ payment_link_charges_method_do_port
--     20270811180000  (livre no épico)            ✗  revoke_anon_on_public_views_dos_vector
--     20270812000000                              ✗  (ocupada)
--
-- Duas dessas colisões JÁ ESTÃO EM PROD: o ledger tem `20270811150000` e
-- `20270811160000` gravadas com as migrations de billing. Consequência para o
-- épico, e ela é séria — `db push` PULA arquivo cuja versão já consta no
-- ledger, sem erro e sem aviso. As fatias 4 e 5 (boas_avaliacoes e
-- negocios_perdidos) não chegariam em prod, e nada avisaria.
--
-- Não é dívida desta fatia e não se conserta aqui: renumerar aquelas duas é
-- reescrever commit de PR alheio na pilha. Fica reportado; esta fatia apenas
-- não repete o erro.
--
-- É A PRIMEIRA RAZÃO DA SÉRIE, E POR ISSO ESTA MIGRATION NÃO TEM FUNÇÃO NENHUMA
--
-- As seis fatias anteriores acrescentaram uma medida cada: catálogo + leaf +
-- despachante + grants. Esta não acrescenta nem leaf nem ramo, e a ausência é o
-- ponto. `taxa_qualidade` é `boas_avaliacoes ÷ leads_avaliados` — a divisão já é
-- do motor (`fn_metric_measure`, ramo `kind='ratio'`), e os dois filhos já
-- existem no catálogo (20270811130000 e 20270811150000). Escrever um leaf que
-- divide seria contrabandear divisão para dentro do catálogo de MEDIDAS, que o
-- ADR-0023 separa de propósito — foi exatamente o que o cabeçalho da
-- 20270811150000 mandou não fazer, deixando esta fatia marcada.
--
-- O QUE UMA LINHA EM `metric_catalog_ratios` FAZ, MEDIDO E NÃO SUPOSTO
--
-- O motor NUNCA lê `metric_catalog_ratios`. Verificado nesta fatia: nem
-- `fn_metric_measure`, nem `_metric_leaf`, nem `fn_dashboard_snapshot`, nem o
-- trigger `validate_widget_against_catalog` a consultam — o widget de razão
-- guarda `num_measure_id`/`den_measure_id` direto e o motor executa o par. A
-- tabela é servida por `fn_metric_catalog()->'ratios'` e existe para uma coisa
-- só: **ser descoberta**. Sem esta linha, a razão só existiria se alguém
-- soubesse de cor qual par formar.
--
-- Consequência prática, e é o motivo da guarda no fim: como nada valida a
-- linha em runtime, uma linha incoerente não quebra — ela MENTE. Ver abaixo.
--
-- POR QUE O PAR É ESTE, E POR QUE A ÂNCORA IMPORTA
--
-- `boas_avaliacoes` (prata|ouro|diamante) é subconjunto de `leads_avaliados`
-- (tier preenchido), como a 20270811150000 estabeleceu e o pgTAP daquela
-- família afirma. Logo a razão está sempre em [0, 100] por construção — não é
-- uma taxa que pode estourar.
--
-- As duas ancoram em `entradas`, e isso não é coincidência: o motor devolve
-- como âncora da razão a âncora do NUMERADOR, apenas (`'anchor', v_num->>'anchor'`).
-- Par com âncoras diferentes divide duas coortes de janelas distintas e nada no
-- payload sinaliza. A razão `conversao`, semeada em 2026-07, já faz isso —
-- `num_vendas` ancora em `fechamentos` e `leads_criados` em `entradas`. Não é
-- erro dela (é a conversão que a operação pede), mas é o precedente que obriga
-- a guarda: a família de qualidade compartilha coorte de propósito, e uma
-- linha que quebrasse isso passaria despercebida.
--
-- CUSTO MEDIDO (prod, julho/2026, 44 orgs com lead na janela, em 2026-08-12):
--
--     leads criados   13.439
--     avaliados        1.519   (11,3% da base)
--     bons               660
--     taxa_qualidade   43,45%
--
-- Os 11,3% são o recado que a métrica carrega: ela fala do subconjunto que a
-- operação julgou, não da base. Uma org que avalia 10 leads e aprova 9 mostra
-- 90% — e isso é verdade sobre os 10, não sobre os 400 que entraram. Quem
-- quiser a leitura sobre a base já tem as duas medidas separadas na tela.
--
-- A GUARDA: UNIDADE DERIVADA × FORMATO DECLARADO
--
-- Este é o defeito de classe que a fatia fecha, e ele vale para toda razão
-- futura, não só para esta.
--
-- O motor DERIVA a unidade do par: count/count → 'percent' (e aí multiplica por
-- 100), currency/count → 'currency', e QUALQUER outra combinação cai no ramo
-- final como 'ratio' (fração crua, 4 casas). O front, por outro lado, formata
-- pelo `format_id` do mapa — e `percent_1` apenas SUFIXA '%', sem multiplicar.
--
-- Cruzando os dois: um preset `duration_seconds ÷ count` (por exemplo
-- `tempo_resposta_equipe ÷ num_vendas`) deriva 'ratio', devolve 0,4212, e com
-- `format_id = 'percent_1'` a tela imprime "0,4%" onde o número é 42%. Erro de
-- 100×, silencioso, e nenhuma camada o detecta hoje: a tabela só tem FK para
-- `metric_catalog_formats`, e o teste do mapa no front pula razão
-- (`if (m.measureRef.kind !== 'leaf') continue`).
--
-- O bloco `DO` abaixo confere a coerência de TODAS as linhas da tabela, não só
-- da nova, e ABORTA. As três semeadas em 2026-07 passam — foram conferidas.
--
-- ROLLBACK pareado: rollback/20270812100001_metric_taxa_qualidade.sql

-- ===========================================================================
-- 1 — CATÁLOGO (a linha inteira da fatia)
-- ===========================================================================
INSERT INTO public.metric_catalog_ratios (id, label, num_measure_id, den_measure_id, format_id, sort) VALUES
  ('taxa_qualidade', 'Taxa de qualidade de leads', 'boas_avaliacoes', 'leads_avaliados', 'percent_1', 40)
ON CONFLICT (id) DO NOTHING;

-- ===========================================================================
-- 2 — GUARDA (aborta a transação)
-- ===========================================================================
DO $guard$
DECLARE
  v_num   text := 'boas_avaliacoes';
  v_den   text := 'leads_avaliados';
  v_row   record;
  v_unit  text;
  v_fmt   text;
  v_falta text;
BEGIN
  -- (a) Os dois filhos existem. Filho ausente do catálogo levanta 22023 no
  -- motor — mas só quando alguém abrir a janela. Aqui o apply já recusa.
  SELECT string_agg(x.id, ', ') INTO v_falta
  FROM (SELECT unnest(ARRAY[v_num, v_den]) AS id) x
  WHERE NOT EXISTS (SELECT 1 FROM public.metric_catalog_measures m WHERE m.id = x.id);
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'GUARDA: taxa_qualidade referencia medida inexistente: %', v_falta;
  END IF;

  -- (b) Os dois aceitam o recorte 'total'. O motor força 'total' nos dois
  -- filhos; par (medida,'total') ausente da compatibilidade levanta 22023, que
  -- o front NÃO trata como schema faltando — derruba a janela inteira.
  SELECT string_agg(x.id, ', ') INTO v_falta
  FROM (SELECT unnest(ARRAY[v_num, v_den]) AS id) x
  WHERE NOT EXISTS (
    SELECT 1 FROM public.metric_catalog_measure_recortes mr
    WHERE mr.measure_id = x.id AND mr.recorte_id = 'total');
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'GUARDA: filho de razão sem recorte total (22023 em runtime): %', v_falta;
  END IF;

  -- (c) Mesma âncora nos dois filhos. A razão herda a âncora do numerador e
  -- cala sobre a do denominador; âncoras diferentes dividem janelas diferentes.
  IF (SELECT count(DISTINCT m.anchor) FROM public.metric_catalog_measures m
        WHERE m.id IN (v_num, v_den)) <> 1 THEN
    RAISE EXCEPTION 'GUARDA: % e % ancoram diferente — a razão dividiria duas coortes', v_num, v_den;
  END IF;

  -- (d) Coerência unidade-derivada × formato-declarado, em TODAS as linhas.
  -- Mesma regra do motor, transcrita: count/count→percent, currency/count→
  -- currency, resto→ratio.
  FOR v_row IN
    SELECT r.id, r.format_id, mn.unit AS num_unit, md.unit AS den_unit
    FROM public.metric_catalog_ratios r
    JOIN public.metric_catalog_measures mn ON mn.id = r.num_measure_id
    JOIN public.metric_catalog_measures md ON md.id = r.den_measure_id
  LOOP
    v_unit := CASE
      WHEN v_row.num_unit = 'count'    AND v_row.den_unit = 'count' THEN 'percent'
      WHEN v_row.num_unit = 'currency' AND v_row.den_unit = 'count' THEN 'currency'
      ELSE 'ratio'
    END;

    -- O formato esperado sai para uma variável em vez de ficar embutido no `IF`.
    -- Não é estilo: `IF x <> CASE ... THEN ... END THEN` NÃO compila em plpgsql —
    -- o parser encerra a condição do `IF` no PRIMEIRO `THEN`, que é o do `CASE`,
    -- e o apply morre com `42601 syntax error at end of input`. Pego na branch
    -- efêmera, antes de existir PR.
    v_fmt := CASE v_unit
               WHEN 'percent'  THEN 'percent_1'
               WHEN 'currency' THEN 'currency_brl'
               ELSE 'ratio_2'
             END;

    IF v_row.format_id <> v_fmt THEN
      RAISE EXCEPTION
        'GUARDA: razão % deriva unidade % (% ÷ %) mas declara formato % — a tela imprimiria número errado',
        v_row.id, v_unit, v_row.num_unit, v_row.den_unit, v_row.format_id;
    END IF;
  END LOOP;

  -- (e) O caminho público continua aberto a quem usa o produto.
  IF NOT has_function_privilege(
       'authenticated',
       'public.fn_metric_measure(uuid, jsonb, text, text, date, date, date, jsonb)'::regprocedure,
       'EXECUTE') THEN
    RAISE EXCEPTION 'GUARDA: authenticated perdeu fn_metric_measure';
  END IF;

  -- (f) O catálogo é read-only para o tenant. Esta fatia escreve nele por
  -- migration; se a RLS tivesse caído, a linha nova seria editável pelo cliente.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE relname = 'metric_catalog_ratios') THEN
    RAISE EXCEPTION 'GUARDA: metric_catalog_ratios sem RLS — o catálogo deixou de ser fechado';
  END IF;
END
$guard$;
