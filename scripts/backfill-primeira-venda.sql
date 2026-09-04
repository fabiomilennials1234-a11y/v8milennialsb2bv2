-- ============================================================================
-- BACKFILL de `leads.primeira_venda_at` (DML — NÃO é migration, guarda F4)
--
-- Pré-requisito: a migration `20270932000000_lead_vira_cliente_quando_vende`
-- aplicada. Sem a coluna, isto falha no primeiro comando — de propósito.
--
-- Medido em prod 2026-09-04: 1.901 eventos em `sale_events`, 1.774 leads com
-- venda líquida, de 56.848 leads vivos. E **zero** webhooks `lead.updated`
-- ativos, então este UPDATE não dispara cascata HTTP nenhuma. Se essa contagem
-- deixar de ser zero, refaça a medição antes de rodar: `leads` tem 21 triggers.
--
-- Rode uma consulta por vez, conferindo o retorno.
-- ============================================================================

-- ── 0) GRANTS — rode ANTES do backfill e confira. Esperado: false, false, true.
--    A função é SECURITY DEFINER e escreve em `leads` bypassando RLS; se
--    `authenticated` puder executá-la, qualquer usuário logado dispara escrita
--    em lead de outra org. O grant é dado pelo banco no CREATE, então isto só
--    se prova aqui, contra o alvo do apply.
SELECT has_function_privilege('anon',
         'public.fn_lead_recalcula_primeira_venda(uuid)', 'EXECUTE')  AS anon,
       has_function_privilege('authenticated',
         'public.fn_lead_recalcula_primeira_venda(uuid)', 'EXECUTE')  AS authenticated,
       has_function_privilege('service_role',
         'public.fn_lead_recalcula_primeira_venda(uuid)', 'EXECUTE')  AS service_role;

-- ── 1) O que será marcado. Rode ANTES e guarde o número. ────────────────────
SELECT count(DISTINCT s.lead_id) AS leads_a_marcar
FROM public.sale_events s
WHERE s.lead_id IS NOT NULL
  AND s.reversed_event_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.sale_events r WHERE r.reversed_event_id = s.id
  );

-- ── 2) O backfill. Reusa a MESMA função do trigger — uma regra, um lugar. ───
--    Se este SELECT e o trigger divergissem, a lista discordaria de si mesma
--    conforme a venda fosse antiga (backfill) ou nova (trigger).
SELECT count(*) AS leads_processados
FROM (
  SELECT public.fn_lead_recalcula_primeira_venda(alvo.lead_id)
  FROM (
    SELECT DISTINCT s.lead_id
    FROM public.sale_events s
    WHERE s.lead_id IS NOT NULL
  ) AS alvo
) AS execucao;

-- ── 3) Conferência: o número tem de bater com o do passo 1. ─────────────────
SELECT
  count(*) FILTER (WHERE primeira_venda_at IS NOT NULL) AS clientes,
  count(*) FILTER (WHERE primeira_venda_at IS NULL)     AS leads,
  count(*)                                              AS total
FROM public.leads
WHERE deleted_at IS NULL;

-- ── 4) Por org, para conferir contra o que a tela mostra. ───────────────────
SELECT o.name AS org,
       count(*) FILTER (WHERE l.primeira_venda_at IS NOT NULL) AS clientes,
       count(*) FILTER (WHERE l.primeira_venda_at IS NULL)     AS leads
FROM public.leads l
JOIN public.organizations o ON o.id = l.organization_id
WHERE l.deleted_at IS NULL
GROUP BY 1
HAVING count(*) FILTER (WHERE l.primeira_venda_at IS NOT NULL) > 0
ORDER BY clientes DESC
LIMIT 20;

-- Esperado na Chiquê (38f3bea4-44c6-4732-bb20-065f547a7ed8): 36 clientes.

-- ── 5) DESFAZER (se for preciso): a coluna é derivada, some sem perda. ──────
-- UPDATE public.leads SET primeira_venda_at = NULL WHERE primeira_venda_at IS NOT NULL;
