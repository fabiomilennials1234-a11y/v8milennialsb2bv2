-- ============================================================
-- A lei de classificação passa a trabalhar em LOTE
-- ============================================================
--
-- 🔴 A versão anterior estourava `statement_timeout` na primeira execução e
-- classificava ZERO. Medido em prod 03/09:
--   apply_erp_lead_classification: canceling statement due to statement timeout
--
-- A causa não é a consulta — é a escrita. `public.leads` tem **21 triggers**, e
-- dois deles gravam uma linha por lead alterado: `audit_leads`
-- (`audit_table_change`) e `trg_lead_field_changes`
-- (`fn_track_lead_field_changes`). Reclassificar 12.677 leads de uma vez são
-- ~25 mil linhas extras num único statement, mais 19 outros triggers avaliados
-- por linha.
--
-- ⚠️ E há um risco maior que a lentidão, que só não se materializou por sorte:
-- `trg_enqueue_lead_webhooks` dispara em QUALQUER update, sem filtro de coluna,
-- e enfileira um `lead.updated` por webhook ativo da org. Numa org com webhook
-- de `lead.updated`, a classificação em massa viraria **um disparo HTTP por
-- lead** para o endpoint do cliente. Conferido antes de aplicar: a Café Jurerê
-- tem 0 webhooks e 0 workflows `field_changed`, então nada externo foi acionado.
-- O lote também limita esse estrago em qualquer org futura.
--
-- Solução: a função passa a alterar no máximo `p_limit` leads por chamada e a
-- devolver quantos ficaram pendentes. Quem chama repete até zerar. Como ela já
-- só escreve o que difere, repetir é barato e converge.

CREATE OR REPLACE FUNCTION public.apply_erp_lead_classification(
  p_organization_id UUID,
  p_limit INTEGER DEFAULT 2000
)
RETURNS TABLE (
  virou_cliente INTEGER,
  virou_indefinido INTEGER,
  virou_lead INTEGER,
  restantes INTEGER
)
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
  v_restantes INTEGER := 0;
BEGIN
  SELECT classificar_leads_por_situacao, clientes_situacoes
    INTO v_ligado, v_situacoes
    FROM public.toth_connections
   WHERE organization_id = p_organization_id;

  IF v_ligado IS NOT TRUE OR v_situacoes IS NULL OR btrim(v_situacoes) = '' THEN
    RETURN QUERY SELECT 0, 0, 0, 0;
    RETURN;
  END IF;

  v_permitidas := string_to_array(v_situacoes, ',');

  CREATE TEMP TABLE IF NOT EXISTS _classif_pendente (
    id UUID PRIMARY KEY,
    destino TEXT NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE _classif_pendente;

  INSERT INTO _classif_pendente (id, destino)
  SELECT alvo.id, alvo.destino
    FROM (
      SELECT l.id,
             l.classificacao AS atual,
             CASE
               WHEN l.erp_code IS NULL OR btrim(l.erp_code) = '' THEN 'lead'
               WHEN btrim(c.erp_status) = ANY (v_permitidas) THEN 'cliente'
               ELSE 'indefinido'
             END AS destino
        FROM public.leads l
        LEFT JOIN public.upsell_clients c
          ON c.lead_id = l.id
         AND c.organization_id = l.organization_id
       WHERE l.organization_id = p_organization_id
         AND l.classificacao_manual = false
    ) alvo
   WHERE alvo.atual IS DISTINCT FROM alvo.destino;

  SELECT count(*) INTO v_restantes FROM _classif_pendente;

  -- `ORDER BY id` não é capricho: sem ordem estável, duas chamadas seguidas
  -- poderiam sortear o mesmo subconjunto e a convergência nunca fecharia.
  WITH lote AS (
    SELECT id, destino FROM _classif_pendente ORDER BY id LIMIT p_limit
  ),
  aplicado AS (
    UPDATE public.leads l
       SET classificacao = lote.destino
      FROM lote
     WHERE l.id = lote.id
    RETURNING lote.destino
  )
  SELECT
    count(*) FILTER (WHERE destino = 'cliente')::INTEGER,
    count(*) FILTER (WHERE destino = 'indefinido')::INTEGER,
    count(*) FILTER (WHERE destino = 'lead')::INTEGER
    INTO v_cliente, v_indefinido, v_lead
  FROM aplicado;

  RETURN QUERY SELECT
    v_cliente,
    v_indefinido,
    v_lead,
    GREATEST(v_restantes - (v_cliente + v_indefinido + v_lead), 0)::INTEGER;
END;
$$;

COMMENT ON FUNCTION public.apply_erp_lead_classification(UUID, INTEGER) IS
  'Aplica a lei de classificação do ERP em LOTES de p_limit (padrão 2000) e '
  'devolve quantos ficaram pendentes — quem chama repete até `restantes` zerar. '
  'O lote existe porque leads tem 21 triggers, dois deles gravando uma linha por '
  'lead (audit + field_changes): 12.677 de uma vez estoura o statement_timeout, '
  'e numa org com webhook de lead.updated viraria um disparo HTTP por lead.';

REVOKE ALL     ON FUNCTION public.apply_erp_lead_classification(UUID, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_erp_lead_classification(UUID, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.apply_erp_lead_classification(UUID, INTEGER) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.apply_erp_lead_classification(UUID, INTEGER) TO service_role;

-- A assinatura de um argumento vira ambígua ao lado da nova (o default cobre a
-- mesma chamada) e o PostgREST recusaria escolher. Some.
DROP FUNCTION IF EXISTS public.apply_erp_lead_classification(UUID);
