-- ============================================================================
-- M6 — recusar responsável de OUTRA organização. Achado do /security-rubric.
--
-- A FK garante que o uuid do membro EXISTE; nunca de quem ele é. Efeito medido
-- em prod: 1.091 linhas de `pipeline_entries` da Maria Bonita apontam para um
-- membro da Mapila, todas criadas em 2026-05-06 — import que reusou id, não
-- exploração. O sintoma hoje é responsável em branco (a RLS de `team_members`
-- esconde o membro de fora) e métrica por vendedor contando a menos.
--
-- ⚠️ ESTE ARQUIVO CRIA A TRAVA. Ele NÃO limpa o que já viola, e a ordem importa:
-- com a trava no ar antes da limpeza, todo `UPDATE` naquelas linhas passa a
-- falhar — inclusive o do M4. Inventário e limpeza: `scripts/m6-inventario.sql`.
--
-- Só schema e corpo de função (guarda F4). Nenhuma linha de dado é lida ou
-- escrita por esta migration.
--
-- ── DUAS ESCOLHAS QUE DIVERGEM DO PLANO DO VAULT, com o porquê ──────────────
--
-- 1) `UPDATE OF <colunas>` em vez de `UPDATE` nu.
--    O plano anexava `BEFORE INSERT OR UPDATE` sem lista. Isso faria `to_jsonb(NEW)`
--    rodar em TODA escrita de `leads` — a tabela mais quente do produto — para
--    conferir colunas que a maioria dos UPDATEs nem menciona. Com a lista, o
--    gatilho só acorda quando alguém de fato mexe em responsável.
--    Efeito colateral desejado: o `SET deal_id` do M4 não menciona nenhuma delas,
--    então o M4 não acorda esta trava pelo lado do espelho. (Pelo lado da FONTE
--    custom ele ainda acorda: o `ON CONFLICT DO UPDATE` do sync menciona
--    `assigned_to`. Por isso a limpeza continua sendo pré-requisito.)
--
-- 2) A função continua genérica (`to_jsonb(NEW)`), e a lista de colunas vive no
--    CREATE TRIGGER, por tabela. Nomear campo dentro da função é o defeito que o
--    plano já corrigiu uma vez: `NEW.<campo inexistente>` é erro de runtime, não
--    NULL, e as três tabelas têm conjuntos diferentes de colunas —
--      pipeline_entries      → assigned_to
--      custom_pipe_entries   → assigned_to, pre_sale_responsible_id, sale_responsible_id
--      leads                 → responsible_id, sdr_id, closer_id,
--                              pre_sale_responsible_id, sale_responsible_id,
--                              responsible_user_id, claimed_by
--    (medido em pg_constraint, 2026-07-31). `jsonb ->> 'chave ausente'` devolve
--    NULL e a chave some do join sozinha.
--
-- 3) A verificação confere a lista de colunas contra o CATÁLOGO, não contra uma
--    lista escrita à mão: o conjunto vigiado por cada gatilho tem que ser
--    exatamente o conjunto de colunas daquela tabela com FK para `team_members`.
--    Foi essa checagem — e não leitura de doc — que achou as DUAS colunas que
--    faltavam: `responsible_user_id` (1.594 valores cross-org em prod, ausente
--    de todos os planos) e `claimed_by` (a coluna do "Assumir" que esta mesma
--    fatia criou dois dias atrás). No dia em que alguém acrescentar um
--    responsável novo, a migration seguinte reprova até incluí-lo.
--
-- ── O INVENTÁRIO QUE MUDOU O ESCOPO ────────────────────────────────────────
-- Varrendo as **40 colunas com FK para `team_members`** em tabelas que têm
-- `organization_id` (não as 3 tabelas que o plano listava), prod tem valor
-- cross-org em exatamente **9 pares**:
--
--   leads.responsible_id / sdr_id / pre_sale_responsible_id /
--   sale_responsible_id / responsible_user_id ......... 1.594 cada
--   pipeline_entries.assigned_to ...................... 1.091
--   custom_pipe_entries.assigned_to / pre_sale_responsible_id /
--   sale_responsible_id ............................... 1.091 cada
--
-- Todo o resto (activities, campanhas, commissions, deals, follow_ups, goals,
-- lead_comments, upsell_*, whatsapp_*) está em **zero**.
--
-- São DUAS orgs, não uma: Maria Bonita ← "Gestor Diego" (Mapila, ATIVO), 1.091,
-- 2026-05-06; e **Zaplub ← "mayconBalloon" (The Good Balloon, inativo), 503,
-- 2026-03-26** — esta segunda não aparece em documento nenhum do repo.
-- 1.091 + 503 = 1.594, que reconcilia os dois números que os docs traziam soltos.
--
-- NUNCA `DELETE` na cláusula de evento: em gatilho de DELETE o `NEW` não é
-- atribuído e `to_jsonb(NEW)` levanta erro em runtime — o mesmo modo de falha que
-- a escolha (2) existe para matar, reintroduzido pela porta dos fundos.
-- `BEFORE` porque a função existe para RECUSAR: recusar antes de escrever é mais
-- barato e não deixa o `AFTER` de outro gatilho rodar sobre escrita que será
-- desfeita.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_assert_member_same_org()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row jsonb := to_jsonb(NEW);
  v_bad uuid;
  v_bad_col text;
BEGIN
  -- SECURITY DEFINER: `team_members` tem RLS org-scoped. Sem DEFINER a subquery
  -- não enxergaria o membro da OUTRA org, o join voltaria vazio e a validação
  -- aprovaria exatamente o caso que existe para recusar.
  SELECT m.id, k.col INTO v_bad, v_bad_col
  FROM unnest(ARRAY[
         'responsible_id', 'sdr_id', 'closer_id',
         'pre_sale_responsible_id', 'sale_responsible_id', 'assigned_to',
         -- `responsible_user_id` NÃO estava em plano nenhum e o nome engana: apesar
         -- do `_user_`, a FK é `leads_responsible_user_id_fkey → team_members(id)`
         -- (lida em pg_constraint). Tem 1.594 valores cross-org em prod, o mesmo
         -- volume das outras cinco. Achado pelo scan genérico de
         -- `scripts/m6-inventario.sql`, que varre as 40 colunas com FK para
         -- team_members em vez de confiar numa lista escrita à mão — que foi
         -- exatamente como esta coluna passou batido três documentos.
         'responsible_user_id',
         -- `claimed_by` é a coluna do "Assumir", criada pela PRÓPRIA fatia 2
         -- (20270730000020_leads_claim). Também aponta `team_members`. Sem ela
         -- aqui, a feature nova nasceria com o buraco que esta migration existe
         -- para fechar: dá para assumir um lead em nome de vendedor de outra
         -- empresa. Zero linhas hoje (a coluna nunca foi usada) — fechar antes de
         -- existir dado é o único momento barato.
         'claimed_by'
       ]) AS k(col)
  JOIN public.team_members m
    ON m.id = (v_row ->> k.col)::uuid
  WHERE m.organization_id <> (v_row ->> 'organization_id')::uuid
  LIMIT 1;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'access_denied: % aponta para team_member % de outra organização', v_bad_col, v_bad
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

-- ⚠️ Aqui é FROM anon, e a razão contraria o gotcha mais citado deste repo.
-- A regra registrada ("REVOKE FROM anon é no-op, use FROM PUBLIC") vale quando o
-- EXECUTE chega por `GRANT TO PUBLIC`. NÃO é o caso: lido em `pg_default_acl`
-- nesta base, o `ALTER DEFAULT PRIVILEGES` do dono concede **nominalmente** —
-- `{postgres=X/postgres, anon=X/postgres, authenticated=X/postgres,
-- service_role=X/postgres}`. PUBLIC nunca teve o grant, então revogar de PUBLIC
-- é que seria o no-op.
-- Descoberto pela verificação embutida abaixo: a primeira versão desta migration
-- fazia só `FROM PUBLIC`, e a própria guarda a reprovou com "anon tem EXECUTE".
-- É o argumento a favor de guarda que aborta: o comentário estava errado e o
-- arquivo teria entrado assim mesmo.
REVOKE ALL ON FUNCTION public.fn_assert_member_same_org() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_assert_member_same_org() FROM anon;

COMMENT ON FUNCTION public.fn_assert_member_same_org() IS
  'M6: recusa linha cujo responsável pertença a outra organização. Genérica por '
  'to_jsonb(NEW) — a lista de colunas relevantes vive no CREATE TRIGGER de cada '
  'tabela. Nunca anexar a DELETE (NEW não é atribuído).';

DROP TRIGGER IF EXISTS trg_assert_member_same_org_pipeline_entries ON public.pipeline_entries;
CREATE TRIGGER trg_assert_member_same_org_pipeline_entries
  BEFORE INSERT OR UPDATE OF assigned_to
  ON public.pipeline_entries
  FOR EACH ROW EXECUTE FUNCTION public.fn_assert_member_same_org();

DROP TRIGGER IF EXISTS trg_assert_member_same_org_custom_pipe_entries ON public.custom_pipe_entries;
CREATE TRIGGER trg_assert_member_same_org_custom_pipe_entries
  BEFORE INSERT OR UPDATE OF assigned_to, pre_sale_responsible_id, sale_responsible_id
  ON public.custom_pipe_entries
  FOR EACH ROW EXECUTE FUNCTION public.fn_assert_member_same_org();

DROP TRIGGER IF EXISTS trg_assert_member_same_org_leads ON public.leads;
CREATE TRIGGER trg_assert_member_same_org_leads
  BEFORE INSERT OR UPDATE OF responsible_id, sdr_id, closer_id,
                             pre_sale_responsible_id, sale_responsible_id,
                             responsible_user_id, claimed_by
  ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.fn_assert_member_same_org();


-- ── VERIFICAÇÃO EMBUTIDA — aborta a transação ───────────────────────────────
-- Estrutural de propósito. O teste de COMPORTAMENTO (a trava recusa mesmo?) não
-- cabe numa migration: exige duas orgs e um membro cruzado, que é dado. Ele roda
-- em branch efêmera, por `supabase/qa-seed/m6-teste.sql`, e o resultado é
-- reportado no commit. Verificação que finge testar comportamento sem dado é
-- pior que verificação estrutural honesta.
DO $$
DECLARE
  v_src   text;
  v_col   text;
  v_n     int;
  v_anon  boolean;
  v_tg    record;
  v_cols_tg text[];
  v_cols_fk text[];
  v_faltando text[] := '{}';
BEGIN
  -- ⚠️ Os comentários SAEM antes da busca, e isso não é capricho.
  -- A primeira versão desta guarda fazia `strpos` no fonte cru. Provado por
  -- contrafactual: removendo 'responsible_user_id' do ARRAY, a verificação
  -- CONTINUOU passando — porque a palavra aparece no comentário que explica a
  -- coluna, três linhas acima dela. A guarda estava lendo a própria documentação
  -- como se fosse código. Depois do strip, o mesmo contrafactual reprova.
  SELECT regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g')
    INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_assert_member_same_org';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'FAIL: fn_assert_member_same_org nao existe.';
  END IF;

  -- As OITO colunas precisam estar na função. Uma sumindo daqui é buraco mudo —
  -- e `responsible_user_id` é a prova viva: ficou fora de três documentos e da
  -- primeira versão desta migration, com 1.594 valores cross-org em prod.
  FOREACH v_col IN ARRAY ARRAY['responsible_id','sdr_id','closer_id',
                               'pre_sale_responsible_id','sale_responsible_id','assigned_to',
                               'responsible_user_id','claimed_by']
  LOOP
    IF strpos(v_src, v_col) = 0 THEN
      v_faltando := v_faltando || v_col;
    END IF;
  END LOOP;
  IF array_length(v_faltando, 1) > 0 THEN
    RAISE EXCEPTION 'FAIL: a funcao nao cobre a(s) coluna(s) %.', v_faltando;
  END IF;

  IF strpos(v_src, 'SECURITY DEFINER') = 0 THEN
    RAISE EXCEPTION 'FAIL: a funcao precisa ser SECURITY DEFINER — sem isso a RLS de team_members esconde o membro da outra org e a validacao aprova o caso que deveria recusar.';
  END IF;
  IF strpos(v_src, 'search_path') = 0 THEN
    RAISE EXCEPTION 'FAIL: search_path nao esta pinado numa funcao SECURITY DEFINER.';
  END IF;

  SELECT has_function_privilege('anon', p.oid, 'EXECUTE') INTO v_anon
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_assert_member_same_org';
  IF v_anon THEN
    RAISE EXCEPTION 'FAIL: anon tem EXECUTE na funcao.';
  END IF;

  -- Os três gatilhos: BEFORE (tgtype bit 1), row-level (bit 0), INSERT (bit 2)
  -- e UPDATE (bit 4). DELETE (bit 3) é PROIBIDO: NEW não existe em DELETE.
  v_n := 0;
  FOR v_tg IN
    SELECT c.relname, t.tgname, t.tgtype, t.tgattr, t.tgrelid
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE NOT t.tgisinternal
       AND t.tgname LIKE 'trg_assert_member_same_org%'
  LOOP
    v_n := v_n + 1;
    IF (v_tg.tgtype & 1) = 0 THEN
      RAISE EXCEPTION 'FAIL: % nao e BEFORE.', v_tg.tgname;
    END IF;
    IF (v_tg.tgtype & 8) <> 0 THEN
      RAISE EXCEPTION 'FAIL: % dispara em DELETE — to_jsonb(NEW) levanta erro em runtime.', v_tg.tgname;
    END IF;
    IF (v_tg.tgtype & 4) = 0 OR (v_tg.tgtype & 16) = 0 THEN
      RAISE EXCEPTION 'FAIL: % precisa cobrir INSERT e UPDATE (tgtype=%).', v_tg.tgname, v_tg.tgtype;
    END IF;
    -- tgattr vazio = `UPDATE` nu. Aqui isso é regressão, não estilo: derruba a
    -- escolha (1) do cabeçalho e faz to_jsonb rodar em toda escrita de `leads`.
    IF v_tg.tgattr IS NULL OR array_length(v_tg.tgattr::int2[], 1) IS NULL THEN
      RAISE EXCEPTION 'FAIL: % foi criado como UPDATE nu, sem lista de colunas.', v_tg.tgname;
    END IF;

    -- Checagem pelo CATÁLOGO, não por texto: a lista de colunas do gatilho tem
    -- que ser exatamente o conjunto de colunas daquela tabela que apontam para
    -- `team_members`. É esta que não dá para enganar com comentário — e é ela
    -- que pega a coluna nova no dia em que alguém acrescentar um responsável.
    SELECT array_agg(a.attname ORDER BY a.attname)
      INTO v_cols_tg
      FROM unnest(v_tg.tgattr::int2[]) u(att)
      JOIN pg_attribute a ON a.attrelid = v_tg.tgrelid AND a.attnum = u.att;

    SELECT array_agg(DISTINCT a.attname ORDER BY a.attname)
      INTO v_cols_fk
      FROM pg_constraint c
      JOIN unnest(c.conkey) k(attnum) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     WHERE c.contype = 'f'
       AND c.conrelid = v_tg.tgrelid
       AND c.confrelid = 'public.team_members'::regclass;

    IF v_cols_tg IS DISTINCT FROM v_cols_fk THEN
      RAISE EXCEPTION
        'FAIL: % vigia % mas a tabela tem % apontando para team_members. Coluna de responsavel fora da lista = buraco mudo.',
        v_tg.tgname, v_cols_tg, v_cols_fk;
    END IF;
  END LOOP;

  IF v_n <> 3 THEN
    RAISE EXCEPTION 'FAIL: esperava 3 gatilhos (pipeline_entries, custom_pipe_entries, leads), encontrei %. Funcao de gatilho sem CREATE TRIGGER nao valida coisa nenhuma.', v_n;
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: fn_assert_member_same_org cobre as 8 colunas, e SECURITY DEFINER com search_path pinado, anon sem EXECUTE, e os 3 gatilhos sao BEFORE INSERT OR UPDATE OF <colunas>, nenhum em DELETE.';
END$$;
