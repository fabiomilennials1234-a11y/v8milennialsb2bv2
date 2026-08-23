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
--
-- ⚠️ CORREÇÃO 2026-08-03 — este bloco tinha um ponto cego, e ele não era teórico.
-- A varredura exigia `organization_id` na PRÓPRIA tabela. **Oito tabelas
-- referenciam `team_members` sem ter essa coluna** — a org delas vem do pai:
--   campanha_allowed_viewers · campanha_leads · campanha_members ·
--   competition_participants · meeting_participants ·
--   pipe_distribution_members · user_badges · whatsapp_instance_allowed_members
-- Nenhuma aparecia aqui, então o "TOTAL de valores cross-org na base" era falso.
-- Medido em prod depois de fechar o furo: `campanha_leads` tem **503 linhas em 4
-- colunas** (Zaplub, o mesmo import de 2026-03-26) e `campanha_members` tem 1.
-- As outras seis estão em zero. Isso levou o inventário de 9 pares para 14.
-- O cabeçalho deste arquivo já citava as 503 da Zaplub como fato, mas nenhum
-- bloco daqui era capaz de encontrá-las — número herdado de leitura anterior,
-- não reproduzível pelo próprio script. Agora é.
--
-- A parte 2 descobre o caminho até a org pelo CATÁLOGO (qual FK desta tabela
-- aponta para um pai que tem `organization_id`), em vez de supor que a coluna se
-- chama `<pai>_id`. Tabela sem nenhum pai com org simplesmente não é varrida —
-- e aí não há como decidir o que é cross-org.
DO $$
DECLARE r record; v_n bigint; v_total bigint := 0;
BEGIN
  -- parte 1: org na própria linha
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

  -- parte 2: org herdada do pai
  FOR r IN
    SELECT filho.conrelid::regclass::text AS tabela,
           af.attname::text                AS coluna,
           ap.attname::text                AS via_coluna,
           pai.confrelid::regclass::text   AS pai_tabela
      FROM pg_constraint filho
      JOIN unnest(filho.conkey) kf(attnum) ON true
      JOIN pg_attribute af ON af.attrelid = filho.conrelid AND af.attnum = kf.attnum
      JOIN pg_constraint pai ON pai.conrelid = filho.conrelid AND pai.contype = 'f'
                            AND pai.confrelid <> 'public.team_members'::regclass
      JOIN unnest(pai.conkey) kp(attnum) ON true
      JOIN pg_attribute ap ON ap.attrelid = pai.conrelid AND ap.attnum = kp.attnum
     WHERE filho.contype = 'f'
       AND filho.confrelid = 'public.team_members'::regclass
       AND NOT EXISTS (SELECT 1 FROM pg_attribute o WHERE o.attrelid = filho.conrelid
                        AND o.attname = 'organization_id' AND NOT o.attisdropped)
       AND EXISTS (SELECT 1 FROM pg_attribute o WHERE o.attrelid = pai.confrelid
                    AND o.attname = 'organization_id' AND NOT o.attisdropped)
     ORDER BY 1, 2
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %s x JOIN %s p ON p.id = x.%I
         JOIN public.team_members m ON m.id = x.%I
        WHERE m.organization_id <> p.organization_id',
      r.tabela, r.pai_tabela, r.via_coluna, r.coluna) INTO v_n;
    IF v_n > 0 THEN
      v_total := v_total + v_n;
      RAISE NOTICE 'CROSS-ORG (org via %.%): %.% → % linha(s)',
        r.pai_tabela, r.via_coluna, r.tabela, r.coluna, v_n;
    END IF;
  END LOOP;

  RAISE NOTICE 'TOTAL de valores cross-org na base (org local + org herdada): %', v_total;
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


-- ── 2. LIMPEZA — MUDOU DE ARQUIVO ──────────────────────────────────────────
--
-- A limpeza vive agora em `scripts/m6-limpeza-cross-org.sql`, executável, com
-- backup, guarda de ordem (recusa rodar com a trava do M6 já acesa) e verificação
-- que desfaz a transação se sobrar sujeira.
--
-- O rascunho que ficava aqui terminava em `...`, não rodava, e cobria 5 das 9
-- colunas — faltavam `responsible_user_id` e as três de `custom_pipe_entries`.
-- O texto abaixo fica como registro da DECISÃO (zerar, não reapontar), que é a
-- parte que não é código.
--
-- ── por que ZERAR e não REAPONTAR ──────────────────────────────────────────
--
-- Duas opções, e a diferença não é técnica:
--
-- (a) ZERAR. O responsável some. É o que o operador **já vê hoje**: a
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
-- Recomendação: (a). É reversível pelo backup que a limpeza tira antes de
-- escrever, e não fabrica história. A decisão é do CTO; este arquivo não escolhe
-- sozinho.
--
-- O backup deixou de ser um `COPY ... TO STDOUT` na mão: a limpeza grava
-- `public.backup_cross_org_responsaveis` (formato longo: tabela, coluna, row_id,
-- valor_antigo) dentro da própria transação, então restaurar é SQL e não depende
-- de alguém ter guardado um CSV.
--
-- ⚠️ Escrever em `leads` acorda `enqueue_lead_webhooks` (sem comparar OLD/NEW:
-- todo UPDATE vira entrega) e `fn_track_lead_field_changes` (grava em
-- `field_changes` + `lead_history` — aqui isso é DESEJÁVEL: a limpeza fica
-- auditada). Medido 2026-08-03: `webhooks` tem **0 linhas ativas**, então a
-- primeira ponta é inerte por configuração, não por desenho. A limpeza confere
-- isso em runtime e avisa se alguém tiver ligado um webhook nesse meio-tempo.
