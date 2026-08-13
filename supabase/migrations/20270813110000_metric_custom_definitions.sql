-- 20270813110000_metric_custom_definitions.sql
--
-- SCRUM-311, fatia 10 de 19 · SCRUM-316..320: MÉTRICA PERSONALIZADA.
-- Implementa a **Emenda 1** do ADR-0023 (aceita 2026-08-11), e nada além dela.
--
-- O QUE A EMENDA ABRIU, E O QUE ELA MANTEVE FECHADO
--
--   profundidade   exatamente 1        →  N ≤ 3, validada na ESCRITA e no RUNTIME
--   operadores     só razão            →  + − × ÷, conjunto ENUMERADO no código
--   operandos      id do catálogo      →  id do catálogo + filtro da allowlist
--                                         + número literal
--   representação  {kind,num,den}      →  árvore TIPADA em jsonb
--
-- O que NÃO mudou é o que torna a emenda possível: a árvore continua sendo
-- árvore de IDENTIFICADORES, nunca de SQL. Segue valendo, e esta migration
-- preserva cada um:
--
--   • ZERO `EXECUTE` — grep verificável, gate do revisor;
--   • nenhum nome de tabela ou coluna atravessa a fronteira de composição;
--   • `organization_id` vem de parâmetro do servidor, jamais do payload;
--   • `assert_org_access(p_org_id)` como primeira instrução do caminho público;
--   • denominador zero devolve `null` — não `0`, não erro — em qualquer nível.
--
-- ⚠ A ARMADILHA DE 100×, E POR QUE ESTE MOTOR NUNCA MULTIPLICA
--
-- O ramo `kind='ratio'` do motor deriva `count ÷ count → percent` e MULTIPLICA
-- por 100. O front formata pelo `format_id` e apenas SUFIXA '%', sem
-- multiplicar. O par casa nas três razões semeadas — e some no dia em que
-- alguém montar "negócios por lead", que é `count ÷ count` e vale 1,35: o motor
-- devolveria 135, a tela imprimiria "135,0%", e nada no sistema detectaria o
-- erro de 100×.
--
-- A árvore personalizada corta isso pela raiz: **`÷` de count por count deriva
-- `ratio`, não `percent`, e o motor não multiplica nunca.** Quem quer
-- percentual escreve a multiplicação NA ÁRVORE — `(a ÷ b) × 100` —, o que a
-- profundidade 2 já permite. O número que sai é o número que a tela imprime, e
-- a conversão fica visível na composição em vez de escondida no motor.
--
-- A coerência formato × unidade é validada nas duas pontas (constraint + CHECK
-- do validador), pela mesma tabela que o pgTAP exercita.
--
-- FALHAR ALTO, NUNCA EM SILÊNCIO (obrigação 2 da emenda)
--
-- Árvore inválida levanta `22023`. Nunca devolve `null` passando por número —
-- `null` é reservado para "não há dado" e para divisão por zero, que são fatos
-- sobre o período, não defeitos da definição.
--
-- POR QUE A VALIDAÇÃO ACONTECE DUAS VEZES (obrigação 1)
--
-- A linha gravada SOBREVIVE a mudança de validador. Uma árvore aceita hoje pode
-- estar fora do contrato amanhã — trigger na escrita não alcança o que já está
-- no banco. Por isso `fn_metric_measure` revalida antes de avaliar: custa uma
-- varredura de ≤ 15 nós e é o que impede definição legada de virar número
-- errado depois de um aperto de regra.
--
-- ROLLBACK pareado: rollback/20270813110000_metric_custom_definitions.sql

-- ===========================================================================
-- 1 — DERIVAÇÃO DE UNIDADE (pura, sem tenant, sem dado)
-- ===========================================================================
-- Tabela-verdade explícita. Ela é a regra e é o único lugar onde a regra mora:
-- o validador e o avaliador leem daqui, e o pgTAP exercita daqui.
CREATE OR REPLACE FUNCTION public._metric_tree_op_unit(
  p_op text, p_left text, p_right text
) RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  IF p_op NOT IN ('add', 'sub', 'mul', 'div') THEN
    RAISE EXCEPTION 'operador % fora do conjunto enumerado (add, sub, mul, div)', p_op
      USING ERRCODE = '22023';
  END IF;

  IF p_op IN ('add', 'sub') THEN
    -- Somar receita com contagem não tem significado. Falha alto em vez de
    -- inventar unidade.
    IF p_left <> p_right THEN
      RAISE EXCEPTION 'não dá para somar % com % — unidades diferentes', p_left, p_right
        USING ERRCODE = '22023';
    END IF;
    RETURN p_left;
  END IF;

  IF p_op = 'mul' THEN
    -- Escalar preserva a unidade do outro lado. Produto de duas grandezas
    -- (receita × receita) não é grandeza nenhuma.
    IF p_right = 'number' THEN RETURN p_left;  END IF;
    IF p_left  = 'number' THEN RETURN p_right; END IF;
    RAISE EXCEPTION 'multiplicação exige um dos lados literal — % × %', p_left, p_right
      USING ERRCODE = '22023';
  END IF;

  -- div
  --   X ÷ literal          → X          ("por dia útil": medida ÷ 22)
  --   currency ÷ count     → currency   (ticket médio)
  --   duration ÷ count     → duration   (tempo médio por unidade)
  --   resto                → ratio      ← count ÷ count cai AQUI, não em percent
  IF p_right = 'number'                                   THEN RETURN p_left;    END IF;
  IF p_left = 'currency'         AND p_right = 'count'    THEN RETURN 'currency'; END IF;
  IF p_left = 'duration_seconds' AND p_right = 'count'    THEN RETURN 'duration_seconds'; END IF;
  RETURN 'ratio';
END;
$$;

COMMENT ON FUNCTION public._metric_tree_op_unit(text, text, text) IS
  'Tabela-verdade de unidade dos operadores da árvore personalizada (Emenda 1 '
  'do ADR-0023). count ÷ count deriva RATIO de propósito: o motor de árvore '
  'NUNCA multiplica por 100 — quem quer percentual põe × 100 na própria árvore.';

-- Formatos aceitáveis por unidade derivada. Fora desta lista, a tela mentiria.
CREATE OR REPLACE FUNCTION public._metric_tree_formats_for_unit(p_unit text)
RETURNS text[]
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_unit
    WHEN 'currency'         THEN ARRAY['currency_brl']
    WHEN 'count'            THEN ARRAY['integer']
    WHEN 'duration_seconds' THEN ARRAY['duration_human']
    WHEN 'percent'          THEN ARRAY['percent_1']
    -- 'ratio' e 'number' aceitam os dois: `percent_1` é legítimo quando a
    -- própria árvore já multiplicou por 100.
    ELSE ARRAY['ratio_2', 'percent_1']
  END;
$$;

-- ===========================================================================
-- 2 — VALIDADOR RECURSIVO — devolve a unidade, levanta 22023 no que for inválido
-- ===========================================================================
CREATE OR REPLACE FUNCTION public._metric_tree_unit(p_node jsonb, p_depth int)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_tipo text; v_op text; v_id text; v_unit text;
  v_left text; v_right text; v_chave text; v_valor numeric;
BEGIN
  IF p_node IS NULL OR jsonb_typeof(p_node) <> 'object' THEN
    RAISE EXCEPTION 'nó da árvore não é objeto' USING ERRCODE = '22023';
  END IF;

  v_tipo := p_node->>'type';

  -- --- folha: número literal -------------------------------------------
  IF v_tipo = 'literal' THEN
    IF jsonb_typeof(p_node->'value') <> 'number' THEN
      RAISE EXCEPTION 'literal sem valor numérico' USING ERRCODE = '22023';
    END IF;
    v_valor := (p_node->>'value')::numeric;
    -- Teto que existe para impedir payload absurdo, não para limitar o
    -- usuário: "por dia útil" usa 22, "por milheiro" usa 1000.
    IF abs(v_valor) > 1e12 THEN
      RAISE EXCEPTION 'literal % fora do intervalo permitido (|x| ≤ 1e12)', v_valor
        USING ERRCODE = '22023';
    END IF;
    RETURN 'number';
  END IF;

  -- --- folha: medida do catálogo ---------------------------------------
  IF v_tipo = 'measure' THEN
    v_id := p_node->>'id';
    SELECT m.unit INTO v_unit FROM public.metric_catalog_measures m WHERE m.id = v_id;
    IF v_unit IS NULL THEN
      RAISE EXCEPTION 'medida % não existe no catálogo', COALESCE(v_id, '(nula)')
        USING ERRCODE = '22023';
    END IF;

    -- O motor força `total` nos operandos. Medida sem `total` levantaria 22023
    -- só na abertura da janela; aqui a escrita já recusa.
    IF NOT EXISTS (
      SELECT 1 FROM public.metric_catalog_measure_recortes mr
      WHERE mr.measure_id = v_id AND mr.recorte_id = 'total'
    ) THEN
      RAISE EXCEPTION 'medida % não aceita o recorte total e não serve de operando', v_id
        USING ERRCODE = '22023';
    END IF;

    -- Filtro é OPCIONAL e vem da allowlist. Chave fora dela é rejeitada — é a
    -- fronteira que impede a composição de nomear coluna. `organization_id`
    -- NUNCA entra: ele vem do parâmetro do servidor.
    IF p_node ? 'filters' THEN
      IF jsonb_typeof(p_node->'filters') <> 'object' THEN
        RAISE EXCEPTION 'filtros da medida % não são objeto', v_id USING ERRCODE = '22023';
      END IF;
      FOR v_chave IN SELECT jsonb_object_keys(p_node->'filters') LOOP
        IF v_chave NOT IN ('pipeline_id','member_id','origin','tag_id','product_id','stream') THEN
          RAISE EXCEPTION 'filtro % não está na allowlist', v_chave USING ERRCODE = '22023';
        END IF;
      END LOOP;
    END IF;

    RETURN v_unit;
  END IF;

  -- --- nó de operação ---------------------------------------------------
  IF v_tipo = 'op' THEN
    -- O TETO. Profundidade 3 é o menor número que cobre os três pedidos
    -- medidos no grill (por dia útil, aproveitamento, projeção). Validado aqui
    -- E de novo em runtime, porque um lado só não basta.
    IF p_depth > 3 THEN
      RAISE EXCEPTION 'árvore excede a profundidade máxima de 3' USING ERRCODE = '22023';
    END IF;

    v_op := p_node->>'op';
    IF NOT (p_node ? 'left' AND p_node ? 'right') THEN
      RAISE EXCEPTION 'operação % sem os dois operandos', COALESCE(v_op, '(nulo)')
        USING ERRCODE = '22023';
    END IF;

    v_left  := public._metric_tree_unit(p_node->'left',  p_depth + 1);
    v_right := public._metric_tree_unit(p_node->'right', p_depth + 1);
    RETURN public._metric_tree_op_unit(v_op, v_left, v_right);
  END IF;

  RAISE EXCEPTION 'tipo de nó % desconhecido (use measure, literal ou op)',
    COALESCE(v_tipo, '(nulo)') USING ERRCODE = '22023';
END;
$$;

-- Porta pública do validador: uma árvore inteira → a unidade que ela produz.
CREATE OR REPLACE FUNCTION public.fn_metric_tree_validate(p_tree jsonb)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
  SELECT public._metric_tree_unit(p_tree, 1);
$$;

COMMENT ON FUNCTION public.fn_metric_tree_validate(jsonb) IS
  'Valida a árvore de métrica personalizada (Emenda 1 do ADR-0023) e devolve a '
  'unidade derivada. Levanta 22023 em qualquer violação — nunca devolve null '
  'passando por número. Chamada na ESCRITA (trigger) e em RUNTIME (motor).';

-- ===========================================================================
-- 3 — A TABELA
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.metric_custom_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  name        text NOT NULL,
  description text,

  -- A árvore. jsonb TIPADO, nunca texto para parsear (Emenda 1).
  tree jsonb NOT NULL,

  -- Formato de exibição, do catálogo fechado. Coerência com a unidade derivada
  -- é checada no trigger — CHECK de tabela não pode chamar função STABLE.
  format_id text NOT NULL REFERENCES public.metric_catalog_formats(id) ON DELETE RESTRICT,

  -- Unidade derivada, GRAVADA no momento da escrita. Não é fonte da verdade (o
  -- motor rederiva em runtime); existe para a lista lateral saber formatar sem
  -- avaliar a árvore, e para o pgTAP conferir escrita contra runtime.
  --
  -- O cliente NÃO a manda: o trigger BEFORE INSERT a preenche, e constraint de
  -- coluna é avaliada DEPOIS do trigger de linha — por isso `NOT NULL` sem
  -- DEFAULT funciona e é o que se quer. Default aqui seria um valor plausível
  -- para uma coluna que nunca deve ter valor plausível: ela tem o derivado.
  derived_unit text NOT NULL,

  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT metric_custom_definitions_tree_is_object
    CHECK (jsonb_typeof(tree) = 'object'),
  CONSTRAINT metric_custom_definitions_name_len
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  -- Teto de tamanho bruto: profundidade 3 comporta no máximo 15 nós, e nó é
  -- pequeno. 4 KB é folga larga e barra payload absurdo antes do parse.
  CONSTRAINT metric_custom_definitions_tree_size
    CHECK (pg_column_size(tree) <= 4096)
);

COMMENT ON TABLE public.metric_custom_definitions IS
  'Métricas personalizadas do cliente (Emenda 1 do ADR-0023 · SCRUM-316..320). '
  'A árvore referencia SÓ ids do catálogo, filtros da allowlist e números '
  'literais — nunca SQL, nome de tabela, nome de coluna ou organization_id. '
  'Validada na escrita (trigger) e em runtime (fn_metric_measure).';

-- Nome único por org, sem sensibilidade a caixa: duas métricas "Ticket" e
-- "ticket" na mesma lista lateral seriam indistinguíveis na tela.
CREATE UNIQUE INDEX IF NOT EXISTS uq_metric_custom_definitions_org_name
  ON public.metric_custom_definitions (organization_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS idx_metric_custom_definitions_org
  ON public.metric_custom_definitions (organization_id);

-- ===========================================================================
-- 4 — VALIDAÇÃO NA ESCRITA
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.trg_metric_custom_definition_validate()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_unit text;
BEGIN
  -- Levanta 22023 se a árvore violar o contrato. A transação inteira cai —
  -- linha inválida nunca chega ao banco.
  v_unit := public.fn_metric_tree_validate(NEW.tree);

  IF NOT (NEW.format_id = ANY (public._metric_tree_formats_for_unit(v_unit))) THEN
    RAISE EXCEPTION
      'formato % é incoerente com a unidade derivada % — aceitos: %',
      NEW.format_id, v_unit, array_to_string(public._metric_tree_formats_for_unit(v_unit), ', ')
      USING ERRCODE = '22023';
  END IF;

  -- A unidade gravada é a DERIVADA, sempre. Payload que tente ditar outra é
  -- sobrescrito em silêncio de propósito: não é campo do cliente.
  NEW.derived_unit := v_unit;
  NEW.name := btrim(NEW.name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_metric_custom_definitions_validate ON public.metric_custom_definitions;
CREATE TRIGGER trg_metric_custom_definitions_validate
  BEFORE INSERT OR UPDATE ON public.metric_custom_definitions
  FOR EACH ROW EXECUTE FUNCTION public.trg_metric_custom_definition_validate();

DROP TRIGGER IF EXISTS trg_metric_custom_definitions_updated_at ON public.metric_custom_definitions;
CREATE TRIGGER trg_metric_custom_definitions_updated_at
  BEFORE UPDATE ON public.metric_custom_definitions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===========================================================================
-- 5 — RLS
-- ===========================================================================
ALTER TABLE public.metric_custom_definitions ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer membro da org. A métrica é da ORGANIZAÇÃO, não do autor —
-- foi montada para a operação inteira olhar.
DROP POLICY IF EXISTS metric_custom_definitions_select ON public.metric_custom_definitions;
CREATE POLICY metric_custom_definitions_select
  ON public.metric_custom_definitions FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

-- Escrita: só ADMIN DE EQUIPE da org. Definição de métrica muda o número que a
-- operação inteira lê — não é preferência pessoal como o painel do Estúdio.
--
-- ⚠ A helper é `get_my_team_admin_organization_ids()`, NÃO
-- `get_my_admin_organization_ids()`. Os nomes não distinguem; os corpos sim: a
-- segunda inclui GESTOR DE PORTFÓLIO (ADR-0021), papel escopado a funis, que
-- não deveria definir métrica da organização inteira. A escolhida é
-- `role = 'admin' AND is_active = true`, e nada mais.
--
-- Ambas são SECURITY DEFINER e bypassam RLS — subquery inline em team_members
-- aqui causaria recursão no apply_rls do Realtime.
DROP POLICY IF EXISTS metric_custom_definitions_insert ON public.metric_custom_definitions;
CREATE POLICY metric_custom_definitions_insert
  ON public.metric_custom_definitions FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT public.get_my_team_admin_organization_ids()));

DROP POLICY IF EXISTS metric_custom_definitions_update ON public.metric_custom_definitions;
CREATE POLICY metric_custom_definitions_update
  ON public.metric_custom_definitions FOR UPDATE TO authenticated
  USING      (organization_id IN (SELECT public.get_my_team_admin_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.get_my_team_admin_organization_ids()));

DROP POLICY IF EXISTS metric_custom_definitions_delete ON public.metric_custom_definitions;
CREATE POLICY metric_custom_definitions_delete
  ON public.metric_custom_definitions FOR DELETE TO authenticated
  USING (organization_id IN (SELECT public.get_my_team_admin_organization_ids()));

REVOKE ALL ON TABLE public.metric_custom_definitions FROM anon;

-- ===========================================================================
-- 6 — AVALIADOR RECURSIVO
-- ===========================================================================
CREATE OR REPLACE FUNCTION public._metric_tree_eval(
  p_org_id uuid, p_node jsonb, p_period text, p_ref date, p_start date,
  p_end date, p_filters jsonb, p_depth int
) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_tipo text; v_op text; v_left numeric; v_right numeric; v_leaf jsonb;
BEGIN
  v_tipo := p_node->>'type';

  IF v_tipo = 'literal' THEN
    RETURN (p_node->>'value')::numeric;
  END IF;

  IF v_tipo = 'measure' THEN
    -- Operando é SEMPRE `total`: a árvore compõe escalares. Série composta é
    -- outra pergunta, e mais cara — fica fora desta fatia de propósito.
    -- Os filtros do nó sobrescrevem os da chamada, e a allowlist já foi
    -- conferida na validação (que roda antes deste caminho, nas duas pontas).
    v_leaf := public._metric_leaf(
      p_org_id, p_node->>'id', 'total', p_period, p_ref, p_start, p_end,
      COALESCE(p_filters, '{}'::jsonb) || COALESCE(p_node->'filters', '{}'::jsonb));
    RETURN (v_leaf->>'value')::numeric;
  END IF;

  IF v_tipo = 'op' THEN
    IF p_depth > 3 THEN
      RAISE EXCEPTION 'árvore excede a profundidade máxima de 3' USING ERRCODE = '22023';
    END IF;
    v_op    := p_node->>'op';
    v_left  := public._metric_tree_eval(p_org_id, p_node->'left',  p_period, p_ref, p_start, p_end, p_filters, p_depth + 1);
    v_right := public._metric_tree_eval(p_org_id, p_node->'right', p_period, p_ref, p_start, p_end, p_filters, p_depth + 1);

    -- Ausência de dado propaga como ausência. Nunca vira zero: zero é uma
    -- afirmação sobre o período, e "não sei" não é zero.
    IF v_left IS NULL OR v_right IS NULL THEN
      RETURN NULL;
    END IF;

    RETURN CASE v_op
      WHEN 'add' THEN v_left + v_right
      WHEN 'sub' THEN v_left - v_right
      WHEN 'mul' THEN v_left * v_right
      -- Denominador zero devolve null, em qualquer nível (ADR-0023, mantido
      -- pela Emenda 1). Não é erro: é "não dá para dividir por nada".
      WHEN 'div' THEN CASE WHEN v_right = 0 THEN NULL ELSE v_left / v_right END
    END;
  END IF;

  RAISE EXCEPTION 'tipo de nó % desconhecido na avaliação', COALESCE(v_tipo, '(nulo)')
    USING ERRCODE = '22023';
END;
$$;

-- ===========================================================================
-- 7 — O MOTOR GANHA DOIS RAMOS: `custom` (salva) e `tree` (prévia)
-- ===========================================================================
-- Reescrita de `fn_metric_measure` preservando `leaf` e `ratio` INTACTOS —
-- inclusive o `percent` com ×100 do ramo `ratio`, que continua correto para as
-- razões semeadas do catálogo. A árvore personalizada tem a sua própria regra,
-- e é a que não multiplica.
CREATE OR REPLACE FUNCTION public.fn_metric_measure(
  p_org_id     uuid,
  p_measure_ref jsonb,
  p_recorte    text,
  p_period     text     DEFAULT 'month',
  p_ref        date     DEFAULT NULL,
  p_start      date     DEFAULT NULL,
  p_end        date     DEFAULT NULL,
  p_filters    jsonb    DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_kind text; v_num jsonb; v_den jsonb; v_num_v numeric; v_den_v numeric;
  v_unit text; v_val numeric; v_period_label text; v_tz text; v_bounds tstzrange;
  v_tree jsonb; v_ref_id uuid;
  -- ⚠ Escalares, NÃO um `record`. Medido contra banco real: com
  -- `v_def record` atribuído só no ramo `custom`, o payload `kind='tree'`
  -- estourava `record "v_def" is not assigned yet` — plpgsql avalia o acesso a
  -- campo de record MESMO dentro de um `CASE` cujo ramo não é tomado, e o
  -- `jsonb_build_object` do RETURN referencia `v_def.*` nos dois casos.
  -- Escalares nascem NULL e o mesmo RETURN serve aos dois ramos.
  v_def_id uuid; v_def_name text; v_def_format text;
BEGIN
  -- 1ª INSTRUÇÃO — gate de tenancy (padrão canônico ADR-0017).
  PERFORM public.assert_org_access(p_org_id);

  v_kind := COALESCE(p_measure_ref->>'kind', 'leaf');

  BEGIN
    SELECT o.timezone INTO v_tz FROM public.organizations o WHERE o.id = p_org_id;
    v_bounds := public.metric_period_bounds(p_org_id, p_period, p_ref, p_start, p_end);
    v_period_label := to_char(lower(v_bounds) AT TIME ZONE v_tz, 'MM/YYYY');
  EXCEPTION WHEN OTHERS THEN
    v_period_label := NULL;
  END;

  IF v_kind = 'leaf' THEN
    RETURN public._metric_leaf(
             p_org_id, p_measure_ref->>'id', p_recorte,
             p_period, p_ref, p_start, p_end, p_filters)
           || jsonb_build_object('kind', 'leaf',
                'provenance', jsonb_build_object('period_label', v_period_label, 'stream', p_filters->>'stream', 'note', NULL));

  ELSIF v_kind = 'ratio' THEN
    -- Profundidade EXATAMENTE 1, EXATAMENTE 2 filhos. Razão é escalar (total).
    v_num := public._metric_leaf(p_org_id, p_measure_ref->>'num', 'total',
                                 p_period, p_ref, p_start, p_end, p_filters);
    v_den := public._metric_leaf(p_org_id, p_measure_ref->>'den', 'total',
                                 p_period, p_ref, p_start, p_end, p_filters);
    v_num_v := (v_num->>'value')::numeric;
    v_den_v := (v_den->>'value')::numeric;

    v_unit := CASE
      WHEN (v_num->>'unit') = 'count'    AND (v_den->>'unit') = 'count' THEN 'percent'
      WHEN (v_num->>'unit') = 'currency' AND (v_den->>'unit') = 'count' THEN 'currency'
      ELSE 'ratio'
    END;
    v_val := CASE
      WHEN v_den_v IS NULL OR v_den_v = 0 THEN NULL
      WHEN v_unit = 'percent'  THEN round(100.0 * v_num_v / v_den_v, 2)
      WHEN v_unit = 'currency' THEN round(v_num_v / v_den_v, 2)
      ELSE round(v_num_v / v_den_v, 4)
    END;

    RETURN jsonb_build_object(
      'kind', 'ratio',
      'measure_ref', p_measure_ref,
      'unit', v_unit,
      'currency', CASE WHEN v_unit = 'currency' THEN 'BRL' ELSE NULL END,
      'anchor', v_num->>'anchor',
      'value', v_val,
      'series', NULL,
      'num', jsonb_build_object('measure_id', v_num->>'measure_id', 'value', v_num_v, 'unit', v_num->>'unit'),
      'den', jsonb_build_object('measure_id', v_den->>'measure_id', 'value', v_den_v, 'unit', v_den->>'unit'),
      'empty_reason', CASE WHEN v_den_v IS NULL OR v_den_v = 0 THEN 'no_rows' ELSE NULL END,
      'provenance', jsonb_build_object('period_label', v_period_label, 'stream', p_filters->>'stream', 'note', NULL)
    );

  ELSIF v_kind IN ('custom', 'tree') THEN
    -- `custom` = definição SALVA, pelo id. `tree` = árvore INLINE, para a
    -- prévia do compositor antes de existir linha. Os dois passam pelo MESMO
    -- validador e pelo MESMO avaliador; a prévia não é caminho privilegiado.
    IF v_kind = 'custom' THEN
      v_ref_id := NULLIF(p_measure_ref->>'id', '')::uuid;
      IF v_ref_id IS NULL THEN
        RAISE EXCEPTION 'measure_ref custom sem id' USING ERRCODE = '22023';
      END IF;
      -- O filtro por organização usa o parâmetro do servidor, JÁ conferido por
      -- assert_org_access. A definição de outra org é invisível aqui mesmo que
      -- o id seja adivinhado.
      SELECT d.id, d.name, d.format_id, d.tree
        INTO v_def_id, v_def_name, v_def_format, v_tree
      FROM public.metric_custom_definitions d
      WHERE d.id = v_ref_id AND d.organization_id = p_org_id;
      IF v_def_id IS NULL THEN
        RAISE EXCEPTION 'métrica personalizada % não existe nesta organização', v_ref_id
          USING ERRCODE = '22023';
      END IF;
    ELSE
      v_tree := p_measure_ref->'tree';
    END IF;

    -- RUNTIME é a SEGUNDA ponta da validação (obrigação 1 da Emenda 1). A
    -- linha gravada sobrevive a mudança de validador; sem esta chamada, uma
    -- definição legada viraria número errado depois de um aperto de regra.
    v_unit := public.fn_metric_tree_validate(v_tree);

    v_val := public._metric_tree_eval(
               p_org_id, v_tree, p_period, p_ref, p_start, p_end, p_filters, 1);

    -- ⚠ NENHUMA multiplicação por 100 aqui, em nenhuma unidade. Ver o cabeçalho.
    v_val := CASE
      WHEN v_val IS NULL          THEN NULL
      WHEN v_unit = 'currency'    THEN round(v_val, 2)
      WHEN v_unit = 'count'       THEN round(v_val, 0)
      ELSE                             round(v_val, 4)
    END;

    RETURN jsonb_build_object(
      'kind', v_kind,
      'measure_ref', p_measure_ref,
      'measure_id', v_def_id::text,
      'label',      v_def_name,
      'format_id',  COALESCE(v_def_format, p_measure_ref->>'format_id'),
      'unit', v_unit,
      'currency', CASE WHEN v_unit = 'currency' THEN 'BRL' ELSE NULL END,
      -- A árvore compõe escalares de janela; não há coorte única a declarar.
      'anchor', NULL,
      'recorte', 'total',
      'value', v_val,
      'series', NULL,
      'target', NULL,
      'empty_reason', CASE WHEN v_val IS NULL THEN 'no_rows' ELSE NULL END,
      'provenance', jsonb_build_object('period_label', v_period_label, 'stream', p_filters->>'stream', 'note', NULL)
    );

  ELSE
    RAISE EXCEPTION 'unknown measure_ref kind %', v_kind USING ERRCODE = '22023';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.fn_metric_measure(uuid, jsonb, text, text, date, date, date, jsonb) IS
  'Motor de leitura das Métricas Montáveis (#1194 / ADR-0023 + Emenda 1). '
  'Despacho sobre catálogo FECHADO, ZERO EXECUTE. kind=leaf → 1 medida; '
  'kind=ratio → 2 filhos (total), count/count→percent com ×100; '
  'kind=custom → definição salva; kind=tree → árvore inline (prévia). Nos dois '
  'últimos a árvore é revalidada em runtime, profundidade ≤ 3, operadores '
  '+ − × ÷, e o motor NUNCA multiplica por 100 — percentual se escreve na '
  'própria árvore.';

-- ===========================================================================
-- 8 — GRANTS
-- ===========================================================================
-- O validador é público a `authenticated`: o compositor precisa dele para
-- dizer "essa árvore não fecha" ANTES de tentar gravar. Ele não lê dado de
-- tenant nenhum — só o catálogo fechado.
REVOKE EXECUTE ON FUNCTION public.fn_metric_tree_validate(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_metric_tree_validate(jsonb) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_metric_tree_validate(jsonb) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public._metric_tree_unit(jsonb, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._metric_tree_unit(jsonb, int) FROM anon;
GRANT  EXECUTE ON FUNCTION public._metric_tree_unit(jsonb, int) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public._metric_tree_op_unit(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._metric_tree_op_unit(text, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public._metric_tree_op_unit(text, text, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public._metric_tree_formats_for_unit(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._metric_tree_formats_for_unit(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public._metric_tree_formats_for_unit(text) TO authenticated, service_role;

-- O avaliador NÃO: ele chama `_metric_leaf` (interno) e recebe o org_id como
-- parâmetro. Exposto a `authenticated`, seria leitura cross-org por parâmetro.
REVOKE EXECUTE ON FUNCTION public._metric_tree_eval(uuid, jsonb, text, date, date, date, jsonb, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._metric_tree_eval(uuid, jsonb, text, date, date, date, jsonb, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public._metric_tree_eval(uuid, jsonb, text, date, date, date, jsonb, int) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public._metric_tree_eval(uuid, jsonb, text, date, date, date, jsonb, int) TO service_role;

REVOKE EXECUTE ON FUNCTION public.fn_metric_measure(uuid, jsonb, text, text, date, date, date, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_metric_measure(uuid, jsonb, text, text, date, date, date, jsonb) TO authenticated, service_role;

-- ===========================================================================
-- 9 — GUARDA (aborta a transação)
-- ===========================================================================
DO $guard$
DECLARE
  v_unit text;
BEGIN
  -- (a) O avaliador não pode ser alcançável por quem manda o org_id.
  IF has_function_privilege('authenticated',
       'public._metric_tree_eval(uuid, jsonb, text, date, date, date, jsonb, int)'::regprocedure,
       'EXECUTE') THEN
    RAISE EXCEPTION 'GUARDA: authenticated executa _metric_tree_eval — leitura cross-org por parâmetro';
  END IF;
  IF has_function_privilege('anon',
       'public.fn_metric_tree_validate(jsonb)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'GUARDA: anon executa fn_metric_tree_validate';
  END IF;

  -- (b) A tabela precisa nascer com RLS. Sem ela, definição de métrica de uma
  -- org seria legível e editável por qualquer autenticado.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE relname = 'metric_custom_definitions') THEN
    RAISE EXCEPTION 'GUARDA: metric_custom_definitions sem RLS';
  END IF;
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'metric_custom_definitions') <> 4 THEN
    RAISE EXCEPTION 'GUARDA: metric_custom_definitions não tem as 4 policies esperadas';
  END IF;

  -- (c) ZERO EXECUTE no motor — a invariante que a Emenda 1 manteve intacta.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('fn_metric_measure', '_metric_tree_eval', '_metric_tree_unit',
                        'fn_metric_tree_validate', '_metric_leaf')
      AND p.prosrc ~* '(^|[^_[:alnum:]])execute[[:space:]]'
  ) THEN
    RAISE EXCEPTION 'GUARDA: EXECUTE apareceu no motor — o desenho do ADR-0023 foi violado';
  END IF;

  -- (d) O teto de profundidade recusa 4. Verificado com árvore real, não por
  -- leitura de código: `((a ÷ b) ÷ c) ÷ d` tem quatro operadores empilhados.
  BEGIN
    PERFORM public.fn_metric_tree_validate($tree$
      {"type":"op","op":"div",
       "left":{"type":"op","op":"div",
         "left":{"type":"op","op":"div",
           "left":{"type":"op","op":"div",
             "left":{"type":"measure","id":"receita"},
             "right":{"type":"literal","value":2}},
           "right":{"type":"literal","value":2}},
         "right":{"type":"literal","value":2}},
       "right":{"type":"literal","value":2}}
    $tree$::jsonb);
    RAISE EXCEPTION 'GUARDA: profundidade 4 foi ACEITA — o teto da Emenda 1 não pega';
  EXCEPTION
    -- 22023 = invalid_parameter_value, o errcode que o contrato usa para
    -- "árvore fora do contrato". Recusou: correto. O RAISE acima é P0001 e
    -- NÃO cai aqui — ele propaga e derruba o apply, que é o ponto.
    WHEN invalid_parameter_value THEN NULL;
  END;

  -- (e) count ÷ count deriva `ratio`. Se algum dia derivar `percent`, a árvore
  -- personalizada volta a mentir por 100×.
  v_unit := public._metric_tree_op_unit('div', 'count', 'count');
  IF v_unit <> 'ratio' THEN
    RAISE EXCEPTION 'GUARDA: count ÷ count deriva % — a armadilha de 100× voltou', v_unit;
  END IF;

  -- (f) O caminho público continua aberto a quem usa o produto.
  IF NOT has_function_privilege('authenticated',
       'public.fn_metric_measure(uuid, jsonb, text, text, date, date, date, jsonb)'::regprocedure,
       'EXECUTE') THEN
    RAISE EXCEPTION 'GUARDA: authenticated perdeu fn_metric_measure';
  END IF;
END
$guard$;
