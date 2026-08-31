-- Ferramenta `metricas` do Oráculo + a permissão que recorta a leitura.
-- SCRUM-594, ADR-0032 §4 e §5, ADR-0017.

-- ── 1. A permissão ────────────────────────────────────────────────────────
-- Sem uma chave própria, o recorte fica implícito no papel e nenhuma
-- organização consegue afrouxá-lo sem alguém alterar código. Nasce concedida
-- ao `admin` (que a resolve pelo papel, antes de olhar aqui) e negada ao
-- `member` — `default_value = false` —, e NÃO é `is_admin_only`, senão a
-- exceção por organização deixaria de existir.
INSERT INTO public.feature_permissions (key, module, name, description, is_admin_only, default_value, sort_order)
VALUES (
  'metrics.view_org',
  'Métricas',
  'Ver métricas da organização inteira',
  'Permite ler números agregados de toda a organização — ranking, funil e receita — em vez de apenas o que a pessoa atende. O Oráculo respeita esta chave.',
  false,
  false,
  (SELECT coalesce(max(sort_order), 0) + 1 FROM public.feature_permissions WHERE module = 'Métricas')
)
ON CONFLICT (key) DO NOTHING;

-- ── 2. A ferramenta ───────────────────────────────────────────────────────
-- Uma única RPC, consultada sob demanda pelo laço, no lugar do dump fixo de
-- seis consultas que o Oráculo antigo montava ANTES de saber a pergunta.
--
-- 🚨 A ORGANIZAÇÃO VEM POR PARÂMETRO — e é por isso que esta função NÃO é
-- alcançável por `authenticated`. Quem resolve o Escopo é a edge function, a
-- partir do JWT (ADR-0032 §4); ela chama aqui com `service_role`. Conceder
-- EXECUTE a `authenticated` recriaria, letra por letra, o vetor cross-tenant
-- que esta base já teve que fechar em 14 funções.
--
-- `p_team_member_id` NULL = Escopo de organização. Não-NULL = a pessoa só
-- mede o que atende.
--
-- Receita sai do caderno `sale_events`, líquida de estornos (ADR-0017): venda
-- é `event_type = 'sale'` cujo `id` não foi revertido. Atribuição usa UMA
-- chave canônica por papel — `sale_responsible_id` para fechamento e
-- `pre_sale_responsible_id` para pré-venda —, nunca cadeia de fallback.
CREATE OR REPLACE FUNCTION public.oraculo_metricas(
  p_organization_id uuid,
  p_team_member_id  uuid,
  p_periodo_dias    integer
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH periodo AS (
    SELECT now() - make_interval(days => greatest(1, least(coalesce(p_periodo_dias, 30), 365))) AS desde
  ),
  leads_periodo AS (
    SELECT count(*) AS n
    FROM public.leads l, periodo p
    WHERE l.organization_id = p_organization_id
      AND l.created_at >= p.desde
      AND l.deleted_at IS NULL
      AND coalesce(l.is_shadow, false) = false
      AND (
        p_team_member_id IS NULL
        OR l.responsible_id = p_team_member_id
        OR l.sdr_id         = p_team_member_id
        OR l.closer_id      = p_team_member_id
      )
  ),
  vendas AS (
    SELECT se.sale_value
    FROM public.sale_events se, periodo p
    WHERE se.organization_id = p_organization_id
      AND se.event_type = 'sale'
      AND se.sold_at >= p.desde
      AND NOT EXISTS (
        SELECT 1 FROM public.sale_events r
        WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = se.id
      )
      AND (
        p_team_member_id IS NULL
        OR se.sale_responsible_id     = p_team_member_id
        OR se.pre_sale_responsible_id = p_team_member_id
      )
  ),
  perdas AS (
    SELECT count(*) AS n
    FROM public.sale_events se, periodo p
    WHERE se.organization_id = p_organization_id
      AND se.event_type = 'sale_lost'
      AND se.sold_at >= p.desde
      AND (
        p_team_member_id IS NULL
        OR se.sale_responsible_id     = p_team_member_id
        OR se.pre_sale_responsible_id = p_team_member_id
      )
  )
  SELECT jsonb_build_object(
    'escopo',           CASE WHEN p_team_member_id IS NULL THEN 'organizacao' ELSE 'pessoa' END,
    'periodo_dias',     greatest(1, least(coalesce(p_periodo_dias, 30), 365)),
    'leads_criados',    (SELECT n FROM leads_periodo),
    'vendas',           (SELECT count(*) FROM vendas),
    'perdas',           (SELECT n FROM perdas),
    'receita',          (SELECT coalesce(sum(sale_value), 0) FROM vendas),
    'ticket_medio',     (SELECT round(coalesce(avg(sale_value), 0), 2) FROM vendas),
    'conversao_lead_venda',
      CASE WHEN (SELECT n FROM leads_periodo) > 0
           THEN round((SELECT count(*) FROM vendas)::numeric / (SELECT n FROM leads_periodo), 4)
           ELSE NULL END
  );
$$;

COMMENT ON FUNCTION public.oraculo_metricas(uuid, uuid, integer) IS
  'Ferramenta `metricas` do Oráculo. A organização vem por parâmetro porque quem a resolve é a edge function a partir do JWT — por isso EXECUTE é exclusivo de service_role. Receita do caderno sale_events, líquida de estornos (ADR-0017).';

REVOKE ALL ON FUNCTION public.oraculo_metricas(uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.oraculo_metricas(uuid, uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.oraculo_metricas(uuid, uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.oraculo_metricas(uuid, uuid, integer) TO service_role;
