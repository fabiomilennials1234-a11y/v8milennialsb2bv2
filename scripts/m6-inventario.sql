-- ============================================================================
-- M6 — inventário do responsável cross-org. LEITURA em prod, limpeza em branch.
--
-- Ordem obrigatória: MEDIR → LIMPAR → só então acender
-- `supabase/migrations/20270731000010_assert_member_same_org.sql`. Com a trava no
-- ar antes da limpeza, todo `UPDATE` nas linhas sujas passa a falhar.
--
-- ── O QUE FOI MEDIDO EM PROD (leitura, 2026-07-31) ──────────────────────────
--
-- São DUAS orgs, não uma. Os dois documentos do repo tinham metade cada:
--   • o plano do vault dizia "1.091 linhas, uma org, um membro" — contou só
--     `pipeline_entries` da Maria Bonita;
--   • o handoff dizia "1.594 leads" — somou as duas orgs sem saber que eram duas.
-- Nenhum dos dois mencionava a Zaplub.
--
-- | Org da linha | Membro apontado           | Estado   | leads | pipeline_entries | custom_pipe_entries | Quando     |
-- |--------------|---------------------------|----------|-------|------------------|---------------------|------------|
-- | Maria Bonita | Gestor Diego (Mapila)     | ATIVO    | 1.091 | 1.091            | 1.091               | 2026-05-06 |
-- | Zaplub       | mayconBalloon (Good Ball.)| inativo  |   503 |     0            |     0               | 2026-03-26 |
--
-- `d72db961-3807-4eba-865f-321dc13af7d0` · `9e765332-de03-4348-81ec-33de55cdedb2`
--
-- Cada caso é um dia só e um membro só: import que reusou id, não exploração.
-- Maria Bonita tem 6 membros ativos próprios; Zaplub tem 1.
--
-- Em `leads` a sujeira está em QUATRO colunas ao mesmo tempo (`responsible_id`,
-- `sdr_id`, `pre_sale_responsible_id`, `sale_responsible_id`) — em
-- `custom_pipe_entries`, em três. Limpar só `responsible_id`, que é o reflexo
-- natural, deixaria a trava recusando `UPDATE` do mesmo jeito.
-- ============================================================================


-- ── 0. INVENTÁRIO GENÉRICO — descobre as colunas em vez de adivinhá-las ────
--
-- A versão anterior desta seção listava 9 pares (tabela, coluna) escritos à mão,
-- os mesmos do plano. Medido depois: existem **52 colunas com FK para
-- `team_members`, em 28 tabelas**. Escolher 3 tabelas a dedo é como o defeito
-- original nasceu — e já custou: `campanha_leads` tem 503 linhas cross-org da
-- Zaplub que a lista escrita à mão não enxergava.
--
-- Este bloco varre o catálogo. Rode-o ANTES do bloco 1: se ele devolver par que
-- o bloco 1 não cobre, o inventário fixo está desatualizado de novo.
DO $$
DECLARE r record; v_n bigint; v_total bigint := 0;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass::text AS tabela, a.attname::text AS coluna
      FROM pg_constraint c
      JOIN unnest(c.conkey) k(attnum) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     WHERE c.contype = 'f'
       AND c.confrelid = 'public.team_members'::regclass
       AND EXISTS (SELECT 1 FROM pg_attribute o
                    WHERE o.attrelid = c.conrelid AND o.attname = 'organization_id'
                      AND NOT o.attisdropped)
     ORDER BY 1, 2
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %s x JOIN public.team_members m ON m.id = x.%I
        WHERE m.organization_id <> x.organization_id', r.tabela, r.coluna)
      INTO v_n;
    IF v_n > 0 THEN
      v_total := v_total + v_n;
      RAISE NOTICE 'CROSS-ORG: %.% → % linha(s)', r.tabela, r.coluna, v_n;
    END IF;
  END LOOP;
  RAISE NOTICE 'TOTAL de valores cross-org na base: %', v_total;
END$$;


-- ── 1. INVENTÁRIO detalhado das 3 tabelas que o M6 trava ───────────────────
-- (o bloco 0 acima é quem garante que estas três continuam sendo as certas)
WITH viol AS (
  SELECT 'pipeline_entries' t, 'assigned_to' c, x.organization_id oid, m.organization_id mid, m.id memb, x.created_at ca
    FROM public.pipeline_entries x JOIN public.team_members m ON m.id = x.assigned_to
   WHERE m.organization_id <> x.organization_id
  UNION ALL SELECT 'custom_pipe_entries','assigned_to', x.organization_id, m.organization_id, m.id, x.created_at
    FROM public.custom_pipe_entries x JOIN public.team_members m ON m.id = x.assigned_to
   WHERE m.organization_id <> x.organization_id
  UNION ALL SELECT 'custom_pipe_entries','pre_sale_responsible_id', x.organization_id, m.organization_id, m.id, x.created_at
    FROM public.custom_pipe_entries x JOIN public.team_members m ON m.id = x.pre_sale_responsible_id
   WHERE m.organization_id <> x.organization_id
  UNION ALL SELECT 'custom_pipe_entries','sale_responsible_id', x.organization_id, m.organization_id, m.id, x.created_at
    FROM public.custom_pipe_entries x JOIN public.team_members m ON m.id = x.sale_responsible_id
   WHERE m.organization_id <> x.organization_id
  UNION ALL SELECT 'leads','responsible_id', x.organization_id, m.organization_id, m.id, x.created_at
    FROM public.leads x JOIN public.team_members m ON m.id = x.responsible_id
   WHERE m.organization_id <> x.organization_id
  UNION ALL SELECT 'leads','sdr_id', x.organization_id, m.organization_id, m.id, x.created_at
    FROM public.leads x JOIN public.team_members m ON m.id = x.sdr_id
   WHERE m.organization_id <> x.organization_id
  UNION ALL SELECT 'leads','closer_id', x.organization_id, m.organization_id, m.id, x.created_at
    FROM public.leads x JOIN public.team_members m ON m.id = x.closer_id
   WHERE m.organization_id <> x.organization_id
  UNION ALL SELECT 'leads','pre_sale_responsible_id', x.organization_id, m.organization_id, m.id, x.created_at
    FROM public.leads x JOIN public.team_members m ON m.id = x.pre_sale_responsible_id
   WHERE m.organization_id <> x.organization_id
  UNION ALL SELECT 'leads','sale_responsible_id', x.organization_id, m.organization_id, m.id, x.created_at
    FROM public.leads x JOIN public.team_members m ON m.id = x.sale_responsible_id
   WHERE m.organization_id <> x.organization_id
)
SELECT t AS tabela, c AS coluna,
       o.name AS org_da_linha, ob.name AS org_do_membro, mt.name AS membro, mt.is_active,
       count(*) AS linhas, min(ca)::date AS de, max(ca)::date AS ate
  FROM viol
  JOIN public.organizations o  ON o.id  = viol.oid
  JOIN public.organizations ob ON ob.id = viol.mid
  JOIN public.team_members  mt ON mt.id = viol.memb
 GROUP BY 1,2,3,4,5,6
 ORDER BY 7 DESC;


-- ── 2. LIMPEZA — NÃO rodar em prod sem ordem do CTO ────────────────────────
--
-- Duas opções, e a diferença não é técnica:
--
-- (a) ZERAR (abaixo). O responsável some. É o que o operador **já vê hoje**: a
--     RLS de `team_members` é org-scoped, então o join volta vazio e a tela mostra
--     branco. Zerar torna verdadeiro o que a interface já afirma.
--     Preço: métrica por vendedor não muda pelo caminho normal, mas **muda em
--     qualquer RPC `SECURITY DEFINER` ou edge function com `service_role`**
--     (que tem BYPASSRLS em prod) — esses hoje resolvem o nome do membro da
--     outra org e passam a resolver NULL. Auditar os RPCs de métrica por
--     responsável antes de considerar fechado é parte do achado original.
--
-- (b) REAPONTAR para um membro da org certa. Inventa atribuição: move
--     atendimento — e, onde houver comissão por responsável, dinheiro — para
--     alguém que não fez o trabalho, em 1.594 leads, com base em nenhum critério
--     conhecido. Maria Bonita tem 6 membros ativos e Zaplub tem 1; escolher um
--     é chute.
--
-- Recomendação: (a). É reversível por export prévio e não fabrica história.
-- A decisão é do CTO; este arquivo não escolhe sozinho.
--
-- Exportar ANTES (o zeramento é irreversível sem isto):
--   COPY (SELECT id, organization_id, responsible_id, sdr_id, closer_id,
--                pre_sale_responsible_id, sale_responsible_id
--           FROM public.leads WHERE ...) TO STDOUT WITH CSV HEADER;
--
-- Descomentar para executar. Roda com a trava do M6 AINDA DESLIGADA.
--
-- UPDATE public.leads l SET
--   responsible_id          = CASE WHEN m1.organization_id <> l.organization_id THEN NULL ELSE l.responsible_id END,
--   sdr_id                  = CASE WHEN m2.organization_id <> l.organization_id THEN NULL ELSE l.sdr_id END,
--   closer_id               = CASE WHEN m3.organization_id <> l.organization_id THEN NULL ELSE l.closer_id END,
--   pre_sale_responsible_id = CASE WHEN m4.organization_id <> l.organization_id THEN NULL ELSE l.pre_sale_responsible_id END,
--   sale_responsible_id     = CASE WHEN m5.organization_id <> l.organization_id THEN NULL ELSE l.sale_responsible_id END
-- FROM (SELECT 1) _
-- LEFT JOIN public.team_members m1 ON m1.id = l.responsible_id
-- ...
--
-- ⚠️ Escrever em `leads` acorda `enqueue_lead_webhooks` (sem comparar OLD/NEW:
-- todo UPDATE vira entrega) e `fn_track_lead_field_changes` (grava em
-- `field_changes` + `lead_history` — aqui isso é DESEJÁVEL: a limpeza fica
-- auditada). Hoje `webhooks` tem 0 linhas ativas, então a primeira ponta é
-- inerte por configuração, não por desenho. Conferir antes de rodar.
