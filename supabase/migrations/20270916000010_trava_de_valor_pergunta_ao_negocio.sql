-- B2a — a trava de valor passa a perguntar ao NEGÓCIO, não à etapa.
--
-- Pré-requisito de todo o resto do B. Ver .specs/agenda-fonte-unica/PLANO.md.
--
-- ── Por que isto vem antes de aposentar etapa nenhuma ────────────────────
-- `fn_exige_valor_na_venda` (20270909000010) recusa a entrada numa etapa de
-- ganho marcada como exigente quando não há valor. Ela olha
-- `pipeline_stages.requires_sale_value` e `stage_role = 'won'`.
--
-- Quando as etapas de ganho saírem (B2d), ela deixa de encontrar o que
-- perguntar — e o vazamento que ela veio estancar volta inteiro: 44% das
-- vendas sem valor, 194 de 439 em 6 meses, com ticket médio subestimado em
-- até 12.089%.
--
-- Aposentar as etapas sem mover a trava primeiro seria desfazer, na mesma
-- semana, o conserto que a motivou.
--
-- ── A trava muda de sujeito, não de regra ────────────────────────────────
-- Antes:  entrar numa ETAPA de ganho exige valor na entrada do funil.
-- Agora:  marcar um NEGÓCIO como ganho exige valor no negócio.
--
-- É a mesma pergunta feita ao dono certo. E ela passa a valer para os TRÊS
-- caminhos de uma vez, porque todos terminam no mesmo UPDATE de
-- `deals.outcome`:
--   · `definir_desfecho_da_entrada`  → botão da UI      (source='ui')
--   · `fn_capture_sale_event`        → arrastar o card  (source='stage')
--   · `deal-operations.ts`           → automação        (source='workflow')
--
-- A trava antiga cobria só o caminho de arrastar; esta cobre os três por
-- construção, porque mora no choke.
--
-- ── 🚨 O valor mora em DOIS lugares, e eles não conversam ────────────────
-- Achado ao medir, e é o que decide o desenho desta migration.
--
-- Arrastar o card grava o valor em `pipeline_entries.metadata->>'sale_value'`.
-- O botão do negócio grava em `deals.value`. São campos distintos, em tabelas
-- distintas, e NENHUM trigger os sincroniza.
--
-- O valor cruza da entrada para o negócio uma única vez: dentro de
-- `garantir_negocio_da_entrada`, no instante em que o negócio NASCE. Depois
-- disso, quem arrasta um card cujo negócio já existe informa o valor na
-- entrada e deixa `deals.value` nulo para sempre.
--
-- Medido em prod, sobre os 385 negócios ganhos que têm entrada:
--   221 com valor na entrada · 227 com valor no negócio
--     2 SÓ na entrada   ← o negócio jura que não sabe quanto vendeu
--     8 só no negócio   ← negócio sem funil, esperado
--
-- Uma trava que perguntasse apenas `deals.value` recusaria exatamente esses
-- 2 casos — vendas em que a pessoa INFORMOU o valor. Barrar quem obedeceu é
-- pior que não travar: ensina a contornar a trava.
--
-- ── Então a trava recupera antes de recusar ──────────────────────────────
-- Se o negócio não tem valor, ela procura na entrada ligada a ele. Achou,
-- copia para `deals.value` e deixa passar. Não achou, recusa.
--
-- Isso conserta um segundo defeito de graça: hoje o negócio fica em branco
-- enquanto o caderno tem o número, porque `_registrar_desfecho_no_caderno` já
-- faz `COALESCE(d.value, metadata)`. O caderno sempre soube; o negócio é que
-- não era avisado. A partir daqui os dois dizem a mesma coisa.
--
-- E a receita NÃO se move: o caderno continua lendo o mesmo número, só que
-- agora pelo primeiro ramo do COALESCE em vez do segundo.
--
-- ── Onde vive a decisão de "esta org exige?" ─────────────────────────────
-- Continua em `rollout_exige_valor_venda` — a mesma lista de 20270909000010,
-- com motivo e números. Nada de inventar um segundo lugar para configurar a
-- mesma coisa.
--
-- A lista é de orgs POUPADAS, então a regra é: exige, salvo se estiver lá.
-- Preserva exatamente o rollout em vigor — 86 exigindo, 19 poupadas — sem que
-- ninguém entre ou saia por efeito colateral desta migration.
--
-- ⚠️ No B2d, `pipeline_stages.requires_sale_value` fica sem dono e esta lista
-- passa a ser a ÚNICA chave. Por isso ela já é a consultada aqui.
--
-- ── Só ganho, e só na transição ──────────────────────────────────────────
-- Perder um negócio sem valor é legítimo: não se cobra pelo que não vendeu.
--
-- E só quando o desfecho MUDA para ganho. Verificar em toda escrita travaria
-- a edição de um negócio já ganho — trocar o dono, corrigir o título, o toque
-- de `updated_at` de um trigger vizinho. Mesmo desenho da trava da etapa,
-- pelo mesmo motivo.
--
-- ── O alcance, medido ────────────────────────────────────────────────────
--   389 negócios ganhos hoje · 159 sem valor
--   155 desses pertencem às 19 orgs poupadas
--     4 sem valor em org que JÁ exige
--
-- Os 4 são pré-existentes e não são tocados: a trava vale para transições
-- novas, não para o que já está gravado. Ficam como dívida visível.
--
-- ── As duas travas convivem ──────────────────────────────────────────────
-- A trava da etapa NÃO é removida aqui. Enquanto as etapas existirem, as duas
-- valem, e não há conflito: quem arrasta passa pela da etapa e, em seguida,
-- pela do negócio. A da etapa some junto com as etapas, no B2d.
--
-- Reaplicar é no-op.

CREATE OR REPLACE FUNCTION public.fn_exige_valor_no_negocio()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_recuperado numeric;
BEGIN
  -- Só na transição PARA ganho. Ver o cabeçalho: verificar na permanência
  -- travaria a edição de um negócio já ganho.
  IF NEW.outcome IS DISTINCT FROM 'won' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.outcome IS NOT DISTINCT FROM NEW.outcome THEN
    RETURN NEW;
  END IF;

  -- ── Recuperar antes de recusar ──────────────────────────────────────────
  -- Roda MESMO em org poupada: o objetivo aqui não é travar, é fazer o
  -- negócio parar de mentir sobre a própria receita. Quem foi poupado da
  -- exigência não foi poupado de ter o número certo.
  IF NEW.value IS NULL THEN
    BEGIN
      SELECT NULLIF(btrim(pe.metadata->>'sale_value'), '')::numeric
        INTO v_recuperado
        FROM public.pipeline_entries pe
       WHERE pe.deal_id = NEW.id
         AND NULLIF(btrim(COALESCE(pe.metadata->>'sale_value', '')), '') IS NOT NULL
       ORDER BY pe.closed_at DESC NULLS LAST, pe.entered_at DESC
       LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      -- Metadata é campo livre: já houve texto onde devia haver número.
      -- Texto ilegível vale o mesmo que ausência — cai na recusa abaixo.
      v_recuperado := NULL;
    END;

    IF v_recuperado IS NOT NULL THEN
      NEW.value := v_recuperado;
    END IF;
  END IF;

  IF NEW.value IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Org poupada do rollout segue passando sem valor.
  IF EXISTS (
    SELECT 1 FROM public.rollout_exige_valor_venda r
     WHERE r.organization_id = NEW.organization_id
       AND r.religado_em IS NULL
  ) THEN
    RETURN NEW;
  END IF;

  -- Zero é resposta válida — venda de cortesia, troca, ajuste. AUSÊNCIA não é:
  -- "não informei" e "informei zero" são coisas diferentes que hoje viram o
  -- mesmo NULL na conta do ticket médio.
  RAISE EXCEPTION
    'Informe o valor antes de marcar o negócio como ganho.'
    USING ERRCODE = 'check_violation',
          HINT = 'Abra o negócio e preencha o valor, ou adicione os produtos vendidos. Se foi sem cobrança, informe 0.';
END;
$function$;

COMMENT ON FUNCTION public.fn_exige_valor_no_negocio() IS
  'Recusa marcar um negócio como ganho sem valor, e antes disso recupera o valor da entrada do funil quando ele só existe lá. Vale para os TRÊS caminhos (botão, arrastar, automação) porque mora no choke: o UPDATE de deals.outcome. Orgs em rollout_exige_valor_venda ficam de fora da recusa, mas não da recuperação.';

DROP TRIGGER IF EXISTS trg_exige_valor_no_negocio ON public.deals;
-- Prefixo `a_` para disparar antes dos demais BEFORE de `deals`. Não é questão
-- de correção — uma exceção aqui aborta a instrução inteira e desfaz o que os
-- outros tiverem feito —, é para que a recuperação de `value` aconteça antes
-- de qualquer trigger que venha a ler a coluna. Postgres ordena triggers de
-- mesmo tipo por nome.
CREATE TRIGGER a_trg_exige_valor_no_negocio
  BEFORE INSERT OR UPDATE OF outcome ON public.deals
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_exige_valor_no_negocio();

-- ── Guardas ──────────────────────────────────────────────────────────────
DO $$
DECLARE v_trg integer; v_antes integer;
BEGIN
  SELECT count(*) INTO v_trg FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
   WHERE c.relname = 'deals' AND t.tgname = 'a_trg_exige_valor_no_negocio'
     AND NOT t.tgisinternal;
  IF v_trg <> 1 THEN
    RAISE EXCEPTION 'trigger a_trg_exige_valor_no_negocio nao foi criado';
  END IF;

  -- O caderno (`trg_deal_outcome_para_caderno`) é AFTER; a trava é BEFORE.
  -- É ISSO que garante que nada seja gravado num livro append-only antes de a
  -- recusa acontecer — não a ordem alfabética. Se alguém converter a trava em
  -- AFTER, ou o caderno em BEFORE, isto grita.
  SELECT count(*) INTO v_antes FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
   WHERE c.relname = 'deals' AND NOT t.tgisinternal
     AND ((t.tgname = 'a_trg_exige_valor_no_negocio'   AND (t.tgtype & 2) = 2)   -- BEFORE
       OR (t.tgname = 'trg_deal_outcome_para_caderno'  AND (t.tgtype & 2) = 0)); -- AFTER
  IF v_antes <> 2 THEN
    RAISE EXCEPTION 'a trava precisa ser BEFORE e o caderno AFTER (encontrados %/2)', v_antes;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- Backfill: os 2 negócios que já estão ganhos e cujo valor só existe na
-- entrada.
--
-- O trigger acima só alcança transições NOVAS. Estes dois já transitaram, e
-- ficariam para sempre dizendo que não sabem quanto venderam enquanto a
-- entrada ao lado tem o número. São R$ 14.935,40 invisíveis na tela do
-- negócio.
--
-- Medido: 2 candidatos, 2 legíveis, 0 com texto no lugar de número, e nenhum
-- caso em `open` ou `lost` esperando o mesmo conserto.
--
-- ⚠️ A RECEITA NÃO SE MOVE. `_registrar_desfecho_no_caderno` já grava
-- `COALESCE(d.value, metadata)` — o caderno sempre leu esses R$ 14.935,40,
-- pelo segundo ramo. Depois daqui lê pelo primeiro, com o mesmo número. Os
-- eventos já gravados não são tocados: `sale_events` é append-only (ADR-0017).
--
-- ⚠️ `trg_deal_touch_activity` é desabilitado durante o UPDATE. Ele carimba
-- `last_activity_at := now()` mesmo quando a escrita repete o valor anterior
-- (`IS NOT DISTINCT FROM OLD` → bump), então não há como preservar a coluna
-- por escrita explícita, como há para `updated_at` via `torque.activity_only`.
-- Sem isso, dois negócios fechados há meses passariam a parecer ativos hoje —
-- e `last_activity_at` é cursor de "negócio parado". Corrigir o valor não pode
-- falsificar a data do último toque.
--
-- O DISABLE vale só dentro desta transação e pega ACCESS EXCLUSIVE em `deals`
-- pelo tempo dela. São 2 linhas; o lock é sub-segundo.

ALTER TABLE public.deals DISABLE TRIGGER trg_deal_touch_activity;

UPDATE public.deals d
   SET value = rec.valor
  FROM (
    SELECT dd.id,
           (SELECT NULLIF(btrim(pe.metadata->>'sale_value'), '')::numeric
              FROM public.pipeline_entries pe
             WHERE pe.deal_id = dd.id
               AND NULLIF(btrim(COALESCE(pe.metadata->>'sale_value', '')), '') ~ '^-?[0-9]+(\.[0-9]+)?$'
             ORDER BY pe.closed_at DESC NULLS LAST, pe.entered_at DESC
             LIMIT 1) AS valor
      FROM public.deals dd
     WHERE dd.value IS NULL
  ) rec
 WHERE d.id = rec.id
   AND rec.valor IS NOT NULL;

ALTER TABLE public.deals ENABLE TRIGGER trg_deal_touch_activity;

DO $$
DECLARE v_restam integer; v_trg_on boolean;
BEGIN
  -- Ninguém pode ficar com valor só na entrada.
  SELECT count(*) INTO v_restam
    FROM public.deals d
   WHERE d.value IS NULL
     AND EXISTS (
       SELECT 1 FROM public.pipeline_entries pe
        WHERE pe.deal_id = d.id
          AND NULLIF(btrim(COALESCE(pe.metadata->>'sale_value', '')), '') ~ '^-?[0-9]+(\.[0-9]+)?$');
  IF v_restam > 0 THEN
    RAISE EXCEPTION '% negocio(s) ainda com valor apenas na entrada', v_restam;
  END IF;

  -- Deixar o touch desabilitado congelaria o cursor de inatividade do produto
  -- inteiro, e em silêncio. Vale mais abortar.
  SELECT t.tgenabled <> 'D' INTO v_trg_on FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
   WHERE c.relname = 'deals' AND t.tgname = 'trg_deal_touch_activity';
  IF NOT COALESCE(v_trg_on, false) THEN
    RAISE EXCEPTION 'trg_deal_touch_activity ficou DESABILITADO';
  END IF;
END $$;
