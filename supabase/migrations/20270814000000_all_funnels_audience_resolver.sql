-- ============================================================================
-- get_all_funnels_lead_ids — resolver de público "Todos os funis" (Disparos)
-- ============================================================================
-- CONTEXTO: o passo "Pra quem" do wizard de disparo (/disparos/novo) só sabia
-- resolver público dentro de UM funil. Os 4 resolvers existentes
-- (get_stage_lead_ids, get_filtered_lead_ids, get_custom_filtered_lead_ids,
-- get_carteira_lead_ids — DDL vigente em archive/20261228000000) são todos
-- escopados a um único pipe, e nenhum cruza os dois modelos de funil. Não havia
-- caminho para "dispare para todo mundo que tem a tag X, em qualquer funil".
--
-- ESTA RPC: união da MEMBERSHIP em funil (pipeline_entries dos 3 pipes system
-- + custom_pipe_entries), deduplicada, juntada a leads, e então recortada pelas
-- 4 condições do wizard (tags / qualificação / pré-qualificação / origem).
--
-- ESCOPO DELIBERADO — "todos os funis" é união de MEMBERSHIP, não "base inteira".
-- Lead que nunca entrou em funil nenhum NÃO entra no público. Filtrar direto em
-- `leads` foi oferecido e recusado (decisão CTO): o disparo é uma ferramenta de
-- funil, e varrer `leads` transformaria um erro de clique numa mensagem real
-- para toda a base.
--
-- ── Por que NÃO existe DISTINCT externo ──────────────────────────────────────
-- O `UNION` (não `UNION ALL`) já deduplica os lead_ids: um lead presente nos 3
-- pipes system e mais 2 funis custom sai UMA vez do CTE. O join seguinte é 1:1
-- contra `leads.id` (PRIMARY KEY), logo não pode remultiplicar linha. Um
-- `SELECT DISTINCT` externo seria redundante e só acrescentaria um sort.
-- NÃO "conserte" isto adicionando DISTINCT.
--
-- ── Por que `p.slug IN (...)` além de `p.type = 'system'` ────────────────────
-- O enum PipelineType inclui `upsell_base` e `upsell_gestao` (funis de carteira),
-- que também são `type = 'system'`. Filtrar só por type arrastaria para o
-- público de disparo funis que esta tela NUNCA ofereceu ao operador. Os 3 slugs
-- espelham 1:1 a constante SYSTEM_FUNNELS do frontend
-- (src/modules/campaigns/components/disparo-wizard/audience-resolve.ts) —
-- acoplamento deliberado: se um funil system novo for oferecido na tela, esta
-- lista precisa mudar junto.
--
-- ── SEGURANÇA — o predicado de tenancy aparece DUAS vezes, de propósito ──────
-- Copiado VERBATIM de archive/20261228000000 e aplicado SEPARADAMENTE em cada
-- ramo da união (`pe` e `ce`). Esquecer um dos dois ramos vaza lead de outra org
-- num caminho que ENVIA MENSAGEM REAL de WhatsApp. Semântica:
--   * orgs do chamador via get_my_organization_ids() (derivado de team_members);
--   * OU, adicionalmente, a org pedida quando o chamador é comprovadamente
--     master (master-ghost — opera org sem membership). Escopado a
--     p_organization_id, nunca "todas as orgs": master operando UMA org recebe
--     só aquela, jamais agregado cross-org.
--   * Não-master que forje p_organization_id: is_master_user() é false, o ramo
--     master fica inerte, e só o helper vale -> nenhum acesso novo.
-- O `JOIN public.leads ... deleted_at IS NULL` é o backstop de RLS + soft-delete,
-- idêntico aos 4 resolvers existentes.
--
-- SECURITY INVOKER + SET search_path = '' + GRANT só a `authenticated`.
-- NADA de SECURITY DEFINER. is_master_user / get_my_organization_ids são
-- DEFINER e já vêm qualificados com `public.`.
--
-- Nome NOVO ⇒ não cria overload de assinatura existente, logo não precisa de
-- DROP. CREATE OR REPLACE mantém o arquivo idempotente em re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_all_funnels_lead_ids(
  p_tag_ids                UUID[] DEFAULT NULL,
  p_qualification_tier     TEXT[] DEFAULT NULL,
  p_pre_qualification_tier TEXT[] DEFAULT NULL,
  p_origin                 TEXT[] DEFAULT NULL,
  p_organization_id        UUID   DEFAULT NULL
)
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  -- Membership em QUALQUER funil, nos dois modelos. UNION (não ALL) dedupa o
  -- lead que está em vários funis ao mesmo tempo — invariante do domínio.
  WITH entry_leads AS (
    -- Ramo 1: funis system (pipeline_entries + pipelines).
    SELECT pe.lead_id
    FROM public.pipeline_entries pe
    JOIN public.pipelines p
      ON p.id = pe.pipeline_id
     AND p.type = 'system' -- metric-lint-allow: resolver de PÚBLICO de disparo, não métrica — a união inclui custom_pipe_entries explicitamente no ramo 2, então nenhum funil custom é cegado (o que a regra R3 protege). O par type+slug delimita os 3 pipes que a tela oferece.
     AND p.slug IN ('whatsapp', 'confirmacao', 'propostas')
    WHERE pe.lead_id IS NOT NULL
      -- Tenancy: orgs do chamador (helper) OU a org pedida quando master.
      AND (
        pe.organization_id IN (SELECT public.get_my_organization_ids())
        OR (p_organization_id IS NOT NULL
            AND public.is_master_user()
            AND pe.organization_id = p_organization_id)
      )

    UNION

    -- Ramo 2: funis custom (custom_pipe_entries). Sem join em pipelines — a
    -- entrada custom já carrega organization_id e pipeline_id próprios.
    SELECT ce.lead_id
    FROM public.custom_pipe_entries ce
    WHERE ce.lead_id IS NOT NULL
      -- Tenancy: orgs do chamador (helper) OU a org pedida quando master.
      -- (Mesmo predicado do ramo 1 — precisa existir nos DOIS.)
      AND (
        ce.organization_id IN (SELECT public.get_my_organization_ids())
        OR (p_organization_id IS NOT NULL
            AND public.is_master_user()
            AND ce.organization_id = p_organization_id)
      )
  )
  -- Join 1:1 contra a PK de leads (backstop de RLS + soft-delete) e recorte
  -- pelas 4 condições do wizard, verbatim de get_filtered_lead_ids.
  SELECT el.lead_id
  FROM entry_leads el
  JOIN public.leads l
    ON l.id = el.lead_id
   AND l.deleted_at IS NULL
  WHERE
    -- Tag filter (intersection: lead must have ALL specified tags).
    (p_tag_ids IS NULL OR array_length(p_tag_ids, 1) IS NULL OR NOT EXISTS (
      SELECT unnest(p_tag_ids)
      EXCEPT
      SELECT lt.tag_id FROM public.lead_tags lt WHERE lt.lead_id = l.id
    ))
    -- Qualification tier (sale-side) — text membership, NULL/empty = all.
    AND (p_qualification_tier IS NULL OR array_length(p_qualification_tier, 1) IS NULL
      OR l.qualification_tier::text = ANY(p_qualification_tier))
    -- Pre-qualification tier — text membership, NULL/empty = all.
    AND (p_pre_qualification_tier IS NULL OR array_length(p_pre_qualification_tier, 1) IS NULL
      OR l.pre_qualification_tier::text = ANY(p_pre_qualification_tier))
    -- Origin — text membership, NULL/empty = all.
    AND (p_origin IS NULL OR array_length(p_origin, 1) IS NULL
      OR l.origin::text = ANY(p_origin));
$$;

COMMENT ON FUNCTION public.get_all_funnels_lead_ids(UUID[], TEXT[], TEXT[], TEXT[], UUID) IS
  'Disparos: união DEDUPLICADA (UNION) dos leads com membership em qualquer funil — 3 pipes system (whatsapp/confirmacao/propostas) + todos os custom — recortada pelas condições do wizard. Tenancy replicada nos DOIS ramos da união. Não inclui lead sem funil (não é "base inteira").';

GRANT EXECUTE ON FUNCTION public.get_all_funnels_lead_ids(
  UUID[], TEXT[], TEXT[], TEXT[], UUID
) TO authenticated;

-- ── Índice de tenancy do ramo custom ────────────────────────────────────────
-- custom_pipe_entries tem índice em lead_id / pipeline_id / stage_id /
-- assigned_to (baseline + archive/20260627000000), mas NENHUM em
-- organization_id — ao contrário de pipeline_entries (idx_pipeline_entries_org).
-- Como o ramo 2 da união filtra SÓ por organization_id (sem pipeline_id), sem
-- este índice ele é seq scan a cada tecla do contador vivo do wizard.
--
-- ⚠️ ANTES DE APLICAR EM PROD, MEÇA:
--     SELECT count(*) FROM public.custom_pipe_entries;
-- Acima de ~500k linhas, este CREATE INDEX segura writes na tabela pelo tempo
-- da construção; nesse caso troque por CREATE INDEX CONCURRENTLY — que NÃO roda
-- dentro de transação e portanto precisa de arquivo/apply próprio (o CLI
-- envolve cada migration numa transação). A medição não pôde ser feita nesta
-- fatia (leitura de prod bloqueada na sessão); a variante não-concorrente ficou
-- aqui por ser a única que roda dentro da transação da migration.
CREATE INDEX IF NOT EXISTS idx_custom_pipe_entries_org
  ON public.custom_pipe_entries(organization_id);
