-- ============================================================
-- Classificação do lead: Lead · Cliente · Indefinido
-- ============================================================
--
-- Pedido do CTO em 03/09, vindo do responsável pela Café Jurerê.
--
-- ── O que é geral e o que é de UMA org ──────────────────────────────────────
--
-- A **classificação** é geral: toda org ganha as três gavetas e o seletor na
-- lista, e qualquer usuário pode mover um lead à mão. O padrão é `lead`, então
-- nas ~106 orgs sem ERP nada muda sozinho.
--
-- A **lei de divisão automática** é de quem tem ERP e a liga explicitamente
-- (`toth_connections.classificar_leads_por_situacao`). Hoje isso é só a Café
-- Jurerê. A regra:
--
--   · não está no ERP (`leads.erp_code IS NULL`)          → **lead**
--   · está no ERP, situação entre as importáveis           → **cliente**
--   · está no ERP, situação FORA das importáveis (ou nula) → **indefinido**
--
-- ⚠️ **A regra vale, o conjunto ainda não.** O responsável pediu "ATIVO e
-- INCONSISTENTE", mas o `/clientes` devolve `situacaoParceiro` como número puro
-- (0, 1, 2, 3) e o significado de cada um **não está documentado em lugar
-- nenhum** — conferido nos 57 campos do endpoint e no `erp_metadata` dos 11.238
-- clientes sincronizados. Por isso `clientes_situacoes` nasce NULL, e com ela
-- nula a lei NÃO RODA. Preencher é o ato deliberado, depois que o fornecedor
-- mandar o enum (ele mandou o de `StatusPedido` em horas quando foi pedido).
--
-- Distribuição medida em 03/09, que é o que sustenta a hipótese `0 = ATIVO`:
--
--   situação 0 → 5.403 clientes · 905 compraram nos últimos 12 meses · última
--                compra HOJE
--   situação 1 → 5.100 · 48 no ano · última em 14/08
--   situação 3 →   695 · 3 no ano
--   situação 2 →    40 · 1 no ano, mas 77,5% já faturaram algum dia
--   nula       → 1.429 · nenhuma compra
--
-- ── Mão vence cron (decisão do CTO) ─────────────────────────────────────────
--
-- A lei roda em TODA sincronização, não uma vez. Sem trava, a correção que
-- alguém fizesse pelos três pontos sumiria na madrugada seguinte, e o botão
-- viraria ilusão: o usuário muda, some no outro dia, ninguém entende.
--
-- `classificacao_manual` é essa trava. É o mesmo princípio já aplicado ao
-- responsável em `propagate_erp_owner_to_leads`: **o ERP não é dono da verdade
-- sobre trabalho feito dentro do CRM.**

-- ── 1. As três gavetas ───────────────────────────────────────────────────────

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS classificacao TEXT NOT NULL DEFAULT 'lead',
  ADD COLUMN IF NOT EXISTS classificacao_manual BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_classificacao_check;
ALTER TABLE public.leads
  ADD CONSTRAINT leads_classificacao_check
    CHECK (classificacao IN ('lead', 'cliente', 'indefinido'));

COMMENT ON COLUMN public.leads.classificacao IS
  'Gaveta do lead na lista: lead | cliente | indefinido. Geral a todas as orgs, '
  'padrão "lead". Onde a org liga a lei do ERP, a sincronização reclassifica — '
  'exceto onde classificacao_manual = true.';

COMMENT ON COLUMN public.leads.classificacao_manual IS
  'true = alguém escolheu a gaveta à mão e a sincronização NÃO mexe mais. '
  'Sem isto, a lei do ERP desfaria toda correção humana na madrugada seguinte, '
  'e o botão dos três pontos seria uma ilusão.';

-- O seletor da lista filtra por isto em cima de 12 mil linhas por org.
CREATE INDEX IF NOT EXISTS leads_org_classificacao_idx
  ON public.leads (organization_id, classificacao);

-- ── 2. Configuração por org ──────────────────────────────────────────────────

ALTER TABLE public.toth_connections
  ADD COLUMN IF NOT EXISTS clientes_situacoes TEXT,
  ADD COLUMN IF NOT EXISTS classificar_leads_por_situacao BOOLEAN NOT NULL DEFAULT false;

-- Mesma forma de `clientes_marcas`: CSV de códigos, validado para não virar
-- injeção nem lixo silencioso.
ALTER TABLE public.toth_connections
  DROP CONSTRAINT IF EXISTS toth_clientes_situacoes_forma;
ALTER TABLE public.toth_connections
  ADD CONSTRAINT toth_clientes_situacoes_forma
    CHECK (clientes_situacoes IS NULL OR clientes_situacoes ~ '^[0-9]+(,[0-9]+)*$');

COMMENT ON COLUMN public.toth_connections.clientes_situacoes IS
  'CSV dos códigos de situacaoParceiro que contam como CLIENTE (ex.: "0,2"). '
  'NULL = significado dos códigos ainda não confirmado pelo fornecedor, e a lei '
  'de classificação não roda. Ver a nota no topo da migration.';

COMMENT ON COLUMN public.toth_connections.classificar_leads_por_situacao IS
  'Liga a lei automática de classificação para esta org. false em todas por '
  'padrão: a classificação é geral, a LEI é de quem pediu.';

-- ── 3. A lei ─────────────────────────────────────────────────────────────────
--
-- Em SQL e não no isolate porque é uma varredura sobre 12 mil leads já no banco
-- — trazê-los para a edge function seria o caminho do `WORKER_RESOURCE_LIMIT`
-- que já matou o sync de clientes uma vez.

CREATE OR REPLACE FUNCTION public.apply_erp_lead_classification(
  p_organization_id UUID
)
RETURNS TABLE (virou_cliente INTEGER, virou_indefinido INTEGER, virou_lead INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ligado BOOLEAN;
  v_situacoes TEXT;
  v_permitidas TEXT[];
  v_cliente INTEGER := 0;
  v_indefinido INTEGER := 0;
  v_lead INTEGER := 0;
BEGIN
  SELECT classificar_leads_por_situacao, clientes_situacoes
    INTO v_ligado, v_situacoes
    FROM public.toth_connections
   WHERE organization_id = p_organization_id;

  -- Org sem conexão, sem a lei ligada, ou sem o conjunto de situações
  -- confirmado: não classifica NADA. Silêncio aqui é o comportamento correto —
  -- classificar por engano 12 mil leads é pior que não classificar nenhum.
  IF v_ligado IS NOT TRUE OR v_situacoes IS NULL OR btrim(v_situacoes) = '' THEN
    RETURN QUERY SELECT 0, 0, 0;
    RETURN;
  END IF;

  v_permitidas := string_to_array(v_situacoes, ',');

  WITH alvo AS (
    SELECT l.id,
           l.classificacao AS atual,
           CASE
             -- Sem código do ERP não há o que consultar: segue lead.
             WHEN l.erp_code IS NULL OR btrim(l.erp_code) = '' THEN 'lead'
             -- No ERP e dentro do recorte pedido: é cliente.
             WHEN btrim(c.erp_status) = ANY (v_permitidas) THEN 'cliente'
             -- No ERP e fora do recorte (inclusive situação nula): indefinido.
             ELSE 'indefinido'
           END AS destino
      FROM public.leads l
      LEFT JOIN public.upsell_clients c
        ON c.lead_id = l.id
       AND c.organization_id = l.organization_id
     WHERE l.organization_id = p_organization_id
       -- 🔴 A trava. Quem foi classificado à mão não é tocado.
       AND l.classificacao_manual = false
  ),
  mudou AS (
    -- Só escreve o que difere: sem isto, toda madrugada reescreveria 12 mil
    -- linhas idênticas e acordaria o Realtime de graça.
    SELECT id, destino FROM alvo WHERE atual IS DISTINCT FROM destino
  ),
  aplicado AS (
    UPDATE public.leads l
       SET classificacao = m.destino
      FROM mudou m
     WHERE l.id = m.id
    RETURNING m.destino
  )
  SELECT
    count(*) FILTER (WHERE destino = 'cliente')::INTEGER,
    count(*) FILTER (WHERE destino = 'indefinido')::INTEGER,
    count(*) FILTER (WHERE destino = 'lead')::INTEGER
    INTO v_cliente, v_indefinido, v_lead
  FROM aplicado;

  RETURN QUERY SELECT v_cliente, v_indefinido, v_lead;
END;
$$;

COMMENT ON FUNCTION public.apply_erp_lead_classification(UUID) IS
  'Aplica a lei de classificação do ERP: sem erp_code = lead; com erp_code e '
  'situacaoParceiro entre clientes_situacoes = cliente; caso contrário = '
  'indefinido. Pula quem tem classificacao_manual. Não faz NADA se a lei não '
  'estiver ligada ou se clientes_situacoes for NULL — classificar por engano é '
  'pior que não classificar.';

REVOKE ALL     ON FUNCTION public.apply_erp_lead_classification(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_erp_lead_classification(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.apply_erp_lead_classification(UUID) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.apply_erp_lead_classification(UUID) TO service_role;

-- ── 4. Grants: o default do schema NÃO é o que você escreveu ────────────────
--
-- `ALTER DEFAULT PRIVILEGES` age sobre tudo que nasce em `public` e já entregou
-- privilégio a mais duas vezes nesta integração (`erp_order_items` em 27/08 e
-- `erp_owner_map` em 03/09, esta última com ALL para `authenticated` numa
-- migration que concedia só SELECT). Aqui não nasce tabela, mas a conferência
-- abaixo é o que prova o estado — não o SQL.
--
-- Conferência (rodar DEPOIS, lendo pg_class.relacl e NÃO
-- information_schema.role_table_grants, que só mostra o papel corrente):
--   SELECT relname, array_to_string(relacl, E'\n') FROM pg_class
--    WHERE relname IN ('leads', 'toth_connections');
