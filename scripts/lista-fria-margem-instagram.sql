-- Margem real do Instagram por seguidor varrido (ADR-0046).
--
-- Roda como dono do banco (a tabela de custo não é legível pelo cliente). Para cada busca por varredura:
-- receita = créditos pagos × R$ 0,15 (preço de lista; pacotes com desconto rendem menos, veja a coluna
-- `receita_no_pacote_max`), custo = o que a Apify cobrou × câmbio. Ajuste :cambio e :preco_credito.
--
--   psql "$DATABASE_URL" -v cambio=5.50 -v preco_credito=0.15 -f scripts/lista-fria-margem-instagram.sql
--
-- Leitura:
--   margem_pct < 12   -> a busca sem contato está no limite do que o ADR prevê (+12% com preço de lista)
--   margem_pct < 0    -> prejuízo: confira o custo por seguidor (US$ 0,012 hoje) e o câmbio
--   sem_contato = true e creditos_pagos = varridos/2 -> a devolução de metade funcionou

WITH b AS (
  SELECT
    bu.id, bu.organization_id, bu.status, bu.created_at,
    bu.varridos, bu.creditos_usados AS creditos_pagos, bu.contatos_novos,
    (bu.contatos_novos = 0 AND NOT EXISTS (SELECT 1 FROM public.lista_fria_resultados r WHERE r.busca_id = bu.id)) AS sem_contato,
    c.custo_usd
  FROM public.lista_fria_buscas bu
  LEFT JOIN public.lista_fria_busca_custos c ON c.busca_id = bu.id
  WHERE bu.cobranca = 'por_varredura' AND bu.status IN ('concluida', 'parada', 'falhou')
)
SELECT
  id, organization_id, status, created_at::date AS dia, varridos, creditos_pagos, contatos_novos, sem_contato,
  custo_usd,
  round(creditos_pagos * :preco_credito::numeric, 2)           AS receita_brl,
  round(custo_usd * :cambio::numeric, 2)                         AS custo_brl,
  round(creditos_pagos * :preco_credito::numeric - custo_usd * :cambio::numeric, 2) AS margem_brl,
  CASE WHEN creditos_pagos > 0
       THEN round(100 * (creditos_pagos * :preco_credito::numeric - custo_usd * :cambio::numeric)
                  / (creditos_pagos * :preco_credito::numeric), 1) END AS margem_pct
FROM b
ORDER BY created_at DESC;

-- Total do período, para o acompanhamento semanal.
WITH b AS (
  SELECT bu.creditos_usados AS pagos, c.custo_usd
  FROM public.lista_fria_buscas bu
  JOIN public.lista_fria_busca_custos c ON c.busca_id = bu.id
  WHERE bu.cobranca = 'por_varredura' AND bu.status IN ('concluida', 'parada', 'falhou')
)
SELECT
  count(*)                                                       AS buscas,
  sum(pagos)                                                     AS creditos_pagos,
  round(sum(pagos) * :preco_credito::numeric, 2)                 AS receita_brl,
  round(sum(custo_usd) * :cambio::numeric, 2)                    AS custo_brl,
  round(100 * (sum(pagos) * :preco_credito::numeric - sum(custo_usd) * :cambio::numeric)
        / NULLIF(sum(pagos) * :preco_credito::numeric, 0), 1)    AS margem_pct
FROM b;
