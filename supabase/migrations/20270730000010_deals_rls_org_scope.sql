-- ============================================================================
-- `deals`: escopo de org multi-org + ramo de master na RLS.
--
-- Fatia 2 da separação Lead ↔ Negócio vai ACENDER esta tabela (hoje **0 linhas**,
-- nenhuma edge function escrevendo). Enquanto ela está vazia, consertar a RLS
-- custa zero. Depois do primeiro negócio real, custa incidente.
--
-- ⚠️ CORREÇÃO 2026-08-03, antes do apply: a versão anterior deste cabeçalho dizia
-- "nenhum `from('deals')` no front". **Falso** — existem 10, todos em
-- `src/modules/carteira/hooks/useDeals.ts`, o hook que serve a rota `/negocios`.
-- O argumento continua de pé, mas pelo motivo certo: o blast radius é zero porque
-- a TABELA está vazia, não porque ninguém a consulta. (O passo 3 do L2 apaga
-- `/negocios` e esse hook junto, e aí a frase antiga vira verdade — mas ela foi
-- escrita como fato medido quando não era.)
--
-- ── O defeito (medido em prod, 2026-07-30) ─────────────────────────────────
-- As 5 policies da tabela escopam por `get_user_organization_id()`:
--
--     SELECT organization_id FROM team_members
--     WHERE user_id = auth.uid() AND is_active
--     ORDER BY created_at ASC, id ASC LIMIT 1
--
-- Isto é **a primeira org do usuário**, não "as orgs do usuário", e não tem
-- ramo de master. Duas consequências reais:
--
--   1. Usuário multi-org (há 2 ativos em prod) enxerga e escreve negócio só na
--      org mais antiga dele. Nas demais: SELECT vazio e violação de RLS no
--      INSERT — sem mensagem que explique.
--   2. `master_select_all_deals` cobria só SELECT. O master-ghost LIA negócio
--      de qualquer org e não conseguia criar, editar nem excluir nenhum.
--
-- É a mesma classe do incidente de `lead_comments` (#1069, 2026-07-13): lá as
-- policies também usavam `get_user_organization_id()` e o sintoma foi idêntico
-- — master abrindo lead de outra org via SELECT vazio + INSERT recusado.
-- `leads` e `pipeline_entries` já foram migradas pro par
-- `get_my_organization_ids()` / `is_master_user()`; `deals` ficou pra trás
-- porque nunca teve tráfego pra denunciar.
--
-- ── Sobre "UPDATE sem WITH CHECK" ──────────────────────────────────────────
-- A CLAUDE.md de `supabase/migrations/` diz, na regra 5, que policy de UPDATE
-- sem `WITH CHECK` é escalada de privilégio. **Isso é impreciso e foi medido
-- como falso aqui**: o PostgreSQL usa a expressão de `USING` como `WITH CHECK`
-- quando este é omitido, então o `deals_update` antigo já barrava mudar
-- `organization_id` pra fora do escopo. 50 das 90 policies de UPDATE do schema
-- `public` omitem `WITH CHECK`, incluindo
-- `leads_update_by_responsibility_and_permissions`. Escrevemos o `WITH CHECK`
-- explícito mesmo assim — é **higiene de legibilidade** (quem audita a policy
-- lê a regra de escrita sem precisar saber da regra implícita do Postgres),
-- não conserto de falha. Não registre isso como vulnerabilidade corrigida.
--
-- ── Por que `get_my_organization_ids()` e não subquery inline ──────────────
-- É `SECURITY DEFINER` e bypassa RLS. `SELECT ... FROM team_members` inline
-- dentro de policy causa recursão infinita quando o Realtime avalia
-- `apply_rls()` — regra da CLAUDE.md raiz, já paga em incidente.
-- Ambas as chamadas vão embrulhadas em `(SELECT ...)` de propósito: vira
-- InitPlan avaliado UMA vez por query, não uma vez por linha. É o formato que
-- `leads`/`pipeline_entries` usam.
--
-- ── `master_select_all_deals` é DROPADA (desvio consciente do plano) ───────
-- O backlog (`08 — Backlog/em-progresso/lead-negocio-migrations-db.md`, M3a)
-- só previa dropar as 4. Com o ramo `OR is_master_user()` dobrado nas quatro,
-- ela vira redundante — e o único efeito residual que sobraria é nocivo: ela
-- NÃO tem `deleted_at IS NULL`, então o master continuaria enxergando negócio
-- soft-deletado, furando exatamente a guarda que `deals_select` mantém.
-- `master_select_all_leads`, a policy que ela diz espelhar, é gatilhada por
-- `deleted_at IS NULL`. Blast radius do drop: 0 linhas na tabela, nenhum
-- consumidor. O rollback no rodapé recria ela literal.
--
-- ── `anon` perde o grant ───────────────────────────────────────────────────
-- `deals` nasceu com `SELECT, REFERENCES, TRIGGER, MAINTAIN` pra `anon` (ACL
-- medido: `anon=rxtm/postgres`; o mesmo quarteto está literal em
-- `20260101000000_baseline_prod_schema.sql:44961`) — herança do
-- `ALTER DEFAULT PRIVILEGES` do Supabase, igual `leads` e `pipeline_entries`.
-- Não é explorável (sem JWT, `get_my_organization_ids()` devolve 0 linhas e
-- `is_master_user(NULL)` é false, então anon lê 0 linhas), mas é grant sem
-- consumidor numa tabela que ainda não foi acesa — endurecer agora é de graça.
-- Mesmo movimento da 20270728000002 em `meta_conversations`.
-- **As duas metades do revoke**: `REVOKE ... FROM PUBLIC` NÃO alcança grant
-- nominal a `anon`, e vice-versa. Aqui o grant medido é nominal (não há linha
-- de PUBLIC no ACL), mas revogamos dos dois porque a assimetria já custou uma
-- migration de correção neste repo.
-- `leads`/`pipeline_entries` mantêm o grant herdado: é dívida que esta branch
-- não criou e mexer nelas é risco fora do diff. HERDADO — public.leads,
-- public.pipeline_entries, public.custom_pipe_entries — grant SELECT a anon.
--
-- ── Soft-delete: a guarda entra no SELECT, no UPDATE e no DELETE ──────────
-- Espelha `leads` (medido na branch de QA, 2026-07-30): as quatro policies
-- comparáveis — `leads_select_by_responsibility_and_permissions`,
-- `leads_update_by_responsibility_and_permissions`,
-- `leads_delete_admin_or_permission` e `master_all_leads` — TÊM
-- `(deleted_at IS NULL)` no `USING`. `pipeline_entries`, a outra tabela que esta
-- migration copia, não tem coluna `deleted_at`: nesta dimensão ela não é
-- comparável, então quem manda é `leads`.
--
-- Uma versão anterior deste arquivo omitia a guarda em UPDATE/DELETE alegando
-- que, com ela, "ninguém conseguiria limpar o `deleted_at` de um negócio na
-- lixeira sem service_role". **A alegação era falsa** — fica registrada aqui pra
-- ninguém reintroduzir a omissão achando que compra alguma coisa:
--   (a) O Postgres aplica a policy de SELECT também ao UPDATE e ao DELETE sempre
--       que o comando precisa ler a linha existente. Fonte (conferida em
--       2026-07-31, PG 17): `sql-createpolicy`, Table 297 "Policies Applied by
--       Command Type", nota [a], verbatim: "If read access is required to either
--       the existing or new row (for example, a WHERE or RETURNING clause that
--       refers to columns from the relation)." — uma versão anterior deste
--       arquivo citava "Table 5.1 de ddl-rowsecurity", que não existe nessa
--       página; a tabela mora na referência de CREATE POLICY.
--       O PostgREST SEMPRE emite `WHERE`. Ou seja: `deals_select`
--       já escondia o negócio da lixeira do próprio UPDATE, e o "caminho de
--       restauração" que a omissão dizia preservar nunca existiu por ali.
--       O que ela entregava de fato era o contrário: por qualquer caminho que NÃO
--       dispare a policy de SELECT (UPDATE/DELETE sem WHERE/RETURNING sobre
--       colunas da tabela, função SECURITY INVOKER), uma linha invisível pro
--       usuário continuava alcançável — inclusive pra hard-delete de item da
--       lixeira.
--   (b) A restauração real do produto não é UPDATE direto: é RPC SECURITY
--       DEFINER. Em `leads` o ciclo inteiro passa por RPC — `bulk_delete_leads`
--       (`src/modules/leads/hooks/useLeads.ts:310`), `restore_lead` /
--       `restore_leads_bulk` e `purge_lead`
--       (`src/modules/leads/hooks/useTrashLeads.ts:35,49,63`). Todas são DEFINER
--       owned by `postgres`, que tem `BYPASSRLS` — RLS não entra na conta desse
--       caminho, com ou sem guarda na policy.
--
-- O `WITH CHECK` de `deals_update` REPETE a guarda. Não é assimetria — é o que
-- deixa `deals` idêntica a `leads` nesta dimensão. Medido em prod (`pg_policies`,
-- 2026-07-31): `leads_update_by_responsibility_and_permissions` tem
-- `with_check = NULL` e `qual = ((deleted_at IS NULL) AND (organization_id IN
-- (SELECT get_my_organization_ids())) AND (...))`; com `WITH CHECK` omitido o
-- Postgres reusa o `USING`, então o `WITH CHECK` EFETIVO de `leads` tem a guarda.
-- `master_all_leads` (que é `FOR ALL`, `with_check = NULL`, `qual` com
-- `(deleted_at IS NULL)`) idem. Escrevemos explícito por causa da 4b e da regra 5
-- da CLAUDE.md, mas o predicado é o mesmo que `leads` já roda hoje.
--
-- Uma versão anterior deste arquivo deixava o `WITH CHECK` frouxo, alegando que
-- isso preservava a transição visível→lixeira (`SET deleted_at = now()`) por
-- UPDATE direto. **Essa alegação também era falsa** — pela MESMA regra citada em
-- (a) logo acima, que vale para a linha NOVA e não só pra velha: na Table 297, a
-- linha `UPDATE` diz que a expressão `USING` da policy de SELECT faz "Filter
-- existing row [a] & check new row [a]". Como `deals_select` exige
-- `deleted_at IS NULL`, a linha RESULTANTE de um soft-delete reprova nessa
-- checagem, e o `WITH CHECK` do UPDATE — frouxo ou não — não decide nada.
-- Medido na branch efêmera de QA (PG 17.6, 2026-07-30) em tabela temporária
-- dentro de transação abortada, nada persistido; a branch já foi encerrada, então
-- o que fica aqui é o registro do resultado, não algo reproduzível deste repo:
--     SELECT policy USING (deleted_at IS NULL)
--     UPDATE policy USING (deleted_at IS NULL) WITH CHECK (true)
--     UPDATE t SET deleted_at = now() WHERE id = 1;
--        -> ERRO 42501 "new row violates row-level security policy"
--     UPDATE t SET deleted_at = now();   -> PASSOU (sem `WHERE` nem `RETURNING`
--        o comando não requer SELECT na relação, então a nota [a] não dispara)
-- Ou seja: o único caminho que o `WITH CHECK` frouxo abria era o UPDATE sem
-- `WHERE` nenhum — que o PostgREST não emite, e que numa tabela multi-tenant é o
-- último que a gente quer aberto. Repetir a guarda fecha esse caminho e custa uma
-- linha. NÃO custa a lixeira: ela já era inalcançável por UPDATE direto.
--
-- ── A verdade inconveniente que isso implica pra Fatia 2 ───────────────────
-- Lixeira de negócio NÃO pode ser `.update({ deleted_at })` do client — vai
-- devolver `42501 new row violates row-level security policy for table "deals"`,
-- com ou sem a guarda no `WITH CHECK`. Tem que ser RPC `SECURITY DEFINER`, igual
-- `leads`. E essas RPCs NÃO EXISTEM: medido em prod (`pg_proc` do schema
-- `public`, 2026-07-31) há `bulk_delete_leads`, `restore_lead`,
-- `restore_leads_bulk` e `purge_lead` (as quatro com `prosecdef = true`) e nenhuma
-- equivalente pra negócio — as únicas funções que casam `%deal%` são os dois
-- triggers (`fn_sync_deal_value_from_items`, `fn_deal_won_populate_lead_products`).
-- Esta migration **não** cria essas RPCs: está fora do escopo dela. A Fatia 2
-- precisa de `bulk_delete_deals` / `restore_deal` / `purge_deal` ANTES de
-- qualquer UI de lixeira de negócio. Escrito aqui porque quem ler esta policy no
-- futuro vai bater exatamente nesse 42501 e merece a pista.
--
-- Blast radius de acrescentar a guarda agora: zero — **0 linhas na tabela** (a
-- razão que sustenta o argumento sozinha; os 10 `.from('deals')` de
-- `useDeals.ts` não alcançam linha nenhuma), e os três triggers que escrevem em `deals`
-- (`fn_sync_deal_value_from_items`, `fn_deal_won_populate_lead_products`,
-- `update_updated_at`) são SECURITY DEFINER owned by `postgres`. Custo hoje: uma
-- linha no `USING` de cada uma das três policies que leem linha existente, mais
-- uma no `WITH CHECK` do UPDATE. Depois do apply, migration é imutável.
--
-- Só schema e ACL: nenhum dado de cliente é lido, escrito ou movido.
-- ============================================================================

-- ── 1. Remove as policies antigas ───────────────────────────────────────────
-- `IF EXISTS` porque a branch efêmera pode ter sido reconstruída de um baseline
-- em qualquer estado intermediário; a verificação no fim é quem garante o alvo.
DROP POLICY IF EXISTS "deals_select"            ON public.deals;
DROP POLICY IF EXISTS "deals_insert"            ON public.deals;
DROP POLICY IF EXISTS "deals_update"            ON public.deals;
DROP POLICY IF EXISTS "deals_delete"            ON public.deals;
DROP POLICY IF EXISTS "master_select_all_deals" ON public.deals;

-- ── 2. Policies novas — espelham leads/pipeline_entries ─────────────────────
-- Sem cláusula `TO`: PERMISSIVE pra PUBLIC, igual `leads` e `pipeline_entries`.
-- Quem barra o não-autenticado é o predicado (e, a partir desta migration,
-- também a ausência de grant). `service_role` e `postgres` têm BYPASSRLS=true
-- em prod (verificado), então edge function com service_role não é afetada.

CREATE POLICY "deals_select" ON public.deals
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      organization_id IN (SELECT public.get_my_organization_ids())
      OR (SELECT public.is_master_user())
    )
  );

COMMENT ON POLICY "deals_select" ON public.deals IS
  'Le negocio de QUALQUER org do usuario (get_my_organization_ids cobre multi-org e gestor), mais o master-ghost. Soft-deletado nao aparece.';

CREATE POLICY "deals_insert" ON public.deals
  FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT public.get_my_organization_ids())
    OR (SELECT public.is_master_user())
  );

COMMENT ON POLICY "deals_insert" ON public.deals IS
  'Cria negocio so dentro de org do usuario. Master cria em qualquer org (o escopo de org fica na query da app, como em leads).';

CREATE POLICY "deals_update" ON public.deals
  FOR UPDATE
  USING (
    deleted_at IS NULL
    AND (
      organization_id IN (SELECT public.get_my_organization_ids())
      OR (SELECT public.is_master_user())
    )
  )
  WITH CHECK (
    deleted_at IS NULL
    AND (
      organization_id IN (SELECT public.get_my_organization_ids())
      OR (SELECT public.is_master_user())
    )
  );

COMMENT ON POLICY "deals_update" ON public.deals IS
  'USING = negocio VIVO dentro do escopo de org, mais master. WITH CHECK repete a guarda: a linha RESULTANTE tambem precisa estar viva. Espelha leads_update_by_responsibility_and_permissions, que omite o WITH CHECK e por isso reusa o USING com a guarda dentro. Consequencia: soft-delete, restauracao e purga de negocio sao RPC SECURITY DEFINER (como bulk_delete_leads/restore_lead/purge_lead), nunca UPDATE direto do client — a policy de SELECT ja checa a linha nova quando o comando tem WHERE, entao UPDATE direto devolveria 42501 mesmo com WITH CHECK frouxo.';

CREATE POLICY "deals_delete" ON public.deals
  FOR DELETE
  USING (
    deleted_at IS NULL
    AND (
      organization_id IN (SELECT public.get_my_organization_ids())
      OR (SELECT public.is_master_user())
    )
  );

COMMENT ON POLICY "deals_delete" ON public.deals IS
  'Hard-delete de negocio VIVO dentro do escopo de org, mais master. Guarda de soft-delete igual leads_delete_admin_or_permission: purgar item da lixeira e RPC SECURITY DEFINER (como purge_lead), nao DELETE direto. O caminho normal do produto e soft-delete (deleted_at/deleted_by).';

-- ── 3. ACL: anon sai ────────────────────────────────────────────────────────
REVOKE ALL ON public.deals FROM PUBLIC;  -- no-op medido (nao ha linha de PUBLIC no ACL), mantido pela regra das duas metades
REVOKE ALL ON public.deals FROM anon;

-- ── 4. Verificação — aborta a transação se o alvo não bater ─────────────────
DO $$
DECLARE
  r          record;
  v_priv     text;
  v_n        int;
  v_qual     text;
  v_role_ok  boolean;
  v_anon_leu boolean;
BEGIN
  -- 4a. Exatamente as 4 policies esperadas, nada além.
  SELECT count(*) INTO v_n
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'deals';
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'FAIL: deals tem % policies (esperava 4). Policy sobrando reintroduz caminho de leitura fora do predicado novo.', v_n;
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('deals_select','SELECT'), ('deals_insert','INSERT'),
      ('deals_update','UPDATE'), ('deals_delete','DELETE')
    ) AS e(nome, cmd)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = 'deals'
        AND p.policyname = r.nome AND p.cmd = r.cmd
    ) THEN
      RAISE EXCEPTION 'FAIL: policy % (%) nao existe em deals.', r.nome, r.cmd;
    END IF;
  END LOOP;

  -- 4b. Nenhuma policy pode continuar presa na primeira-org, e todas precisam
  --     ter as DUAS pernas (org + master) — foi a falta da segunda que deixou
  --     o master sem escrita.
  FOR r IN
    SELECT policyname, cmd,
           COALESCE(qual, '') || ' ' || COALESCE(with_check, '') AS expr,
           with_check
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'deals'
  LOOP
    IF r.expr LIKE '%get_user_organization_id%' THEN
      RAISE EXCEPTION 'FAIL: policy % ainda referencia get_user_organization_id (primeira org, sem master).', r.policyname;
    END IF;
    IF r.expr NOT LIKE '%get_my_organization_ids%' THEN
      RAISE EXCEPTION 'FAIL: policy % nao escopa por get_my_organization_ids — usuario multi-org ficaria cego.', r.policyname;
    END IF;
    IF r.expr NOT LIKE '%is_master_user%' THEN
      RAISE EXCEPTION 'FAIL: policy % nao tem ramo de master.', r.policyname;
    END IF;
    IF r.cmd IN ('INSERT', 'UPDATE') AND r.with_check IS NULL THEN
      RAISE EXCEPTION 'FAIL: % (%) ficou sem WITH CHECK explicito.', r.policyname, r.cmd;
    END IF;
  END LOOP;

  -- 4c. Soft-delete: a guarda tem que estar no `USING` das TRÊS policies que
  --     leem linha existente (SELECT/UPDATE/DELETE), como em `leads`. INSERT não
  --     tem `qual`, fica de fora.
  FOR r IN
    SELECT * FROM (VALUES ('deals_select'), ('deals_update'), ('deals_delete')) AS e(nome)
  LOOP
    SELECT qual INTO v_qual
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'deals' AND policyname = r.nome;
    -- `IS NULL` explícito porque `NULL NOT LIKE ...` é NULL, e `IF NULL` não
    -- dispara: sem isso a checagem passaria calada se a policy sumisse.
    IF v_qual IS NULL OR v_qual NOT LIKE '%deleted_at IS NULL%' THEN
      RAISE EXCEPTION 'FAIL: % perdeu a guarda de soft-delete no USING.', r.nome;
    END IF;
  END LOOP;

  -- 4c-bis. A guarda TAMBÉM tem que estar no `WITH CHECK` do UPDATE: a linha
  --     resultante precisa continuar viva. É o que iguala `deals` a `leads`, onde
  --     o `WITH CHECK` é omitido e o Postgres reusa o `USING` com a guarda dentro.
  --     ATENÇÃO ao ler o histórico: uma versão anterior desta checagem exigia o
  --     OPOSTO — abortava a migration SE a guarda estivesse aqui — em nome de
  --     preservar o soft-delete por UPDATE direto. Esse benefício não existe (a
  --     policy de SELECT checa a linha nova; ver cabeçalho), e a checagem invertida
  --     congelava a divergência de `leads` num arquivo imutável. Não reintroduza.
  SELECT with_check INTO v_qual
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'deals' AND policyname = 'deals_update';
  IF v_qual IS NULL OR v_qual NOT LIKE '%deleted_at IS NULL%' THEN
    RAISE EXCEPTION 'FAIL: WITH CHECK de deals_update ausente ou sem a guarda de soft-delete — divergiria de leads, cujo WITH CHECK efetivo tem a guarda.';
  END IF;

  -- 4d. RLS continua ligada (policy sem RLS ligada é decoração).
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.deals'::regclass) THEN
    RAISE EXCEPTION 'FAIL: RLS desligada em public.deals.';
  END IF;

  -- 4e. anon nao tem privilegio nenhum na tabela. A lista cobre os 4 privilégios
  --     do ACL medido (`anon=rxtm` = SELECT/REFERENCES/TRIGGER/MAINTAIN) mais os
  --     de escrita, que ele nunca teve. `MAINTAIN` existe a partir do PG 17;
  --     prod e a branch de QA rodam 17.6 (medido), então o literal é aceito.
  FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
    IF has_table_privilege('anon', 'public.deals', v_priv) THEN
      RAISE EXCEPTION 'FAIL: anon ainda tem % em public.deals.', v_priv;
    END IF;
  END LOOP;

  -- 4f. authenticated NAO pode ter perdido nada — o REVOKE acima erraria o alvo
  --     em silêncio se algum dia `authenticated` herdasse de `anon`.
  FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
    IF NOT has_table_privilege('authenticated', 'public.deals', v_priv) THEN
      RAISE EXCEPTION 'FAIL: authenticated perdeu % em public.deals — o app quebraria.', v_priv;
    END IF;
  END LOOP;

  -- 4g. Prova de EXECUÇÃO de que anon não alcança a tabela.
  --     A versão anterior desta checagem media `get_my_organization_ids() = 0` e
  --     `is_master_user() = false` sem JWT. Isso é verdade ANTES e DEPOIS deste
  --     arquivo, e passaria idêntico se todos os CREATE POLICY fossem apagados —
  --     não provava nada sobre a migration.
  --     O motivo declarado antes era "cobrir grant em COLUNA, que
  --     `has_table_privilege(...,'SELECT')` não enxerga". A premissa sobre
  --     `has_table_privilege` procede, mas o CENÁRIO não sobrevive ao `REVOKE`
  --     deste arquivo — a justificativa estava superdimensionada. Doc de `REVOKE`
  --     (PG 17, Notes), verbatim: "When revoking privileges on a table, the
  --     corresponding column privileges (if any) are automatically revoked on
  --     each column of the table, as well." E não há ACL de coluna em `deals`
  --     hoje (medido em prod 2026-07-31: `pg_attribute.attacl` não-nulo em
  --     `public.deals` = 0 linhas; em `public.leads`, também 0).
  --     O que 4g vale de verdade, e por isso fica: é a única prova de EXECUÇÃO
  --     ponta-a-ponta. Exercita `USAGE` no schema, membership de role e um
  --     `REVOKE` que tenha errado o alvo — coisas que a leitura de catálogo da 4e
  --     não distingue de um catálogo que só PARECE certo.
  --     Não conseguir assumir o role é SKIP, não FAIL: é fato sobre o role do
  --     apply, não sobre o alvo — e 4e continua sendo a trava dura.
  BEGIN
    SET LOCAL ROLE anon;
    -- Confirma que a troca PEGOU. `SET LOCAL` fora de bloco de transação vira
    -- WARNING e é descartado; sem esta linha o `PERFORM` abaixo rodaria como
    -- `postgres`, leria a tabela e a checagem reprovaria uma migration correta.
    v_role_ok := (current_user = 'anon');
  EXCEPTION WHEN OTHERS THEN
    v_role_ok := false;
  END;

  IF v_role_ok THEN
    BEGIN
      PERFORM 1 FROM public.deals LIMIT 1;
      v_anon_leu := true;
    EXCEPTION WHEN insufficient_privilege THEN
      v_anon_leu := false;
    END;
    RESET ROLE;  -- antes de qualquer RAISE: erro levantado como anon confunde o log
    IF v_anon_leu THEN
      RAISE EXCEPTION 'FAIL: anon ainda le public.deals apos o REVOKE (grant em coluna nao aparece em has_table_privilege).';
    END IF;
  ELSE
    RAISE NOTICE 'SKIP 4g: o role do apply (%) nao assumiu anon (sem membership ou SET LOCAL descartado); 4e segue como trava.', current_user;
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: 4 policies org-scoped com ramo de master, guarda de soft-delete no USING de SELECT/UPDATE/DELETE e no WITH CHECK do UPDATE, anon sem grant.';
END$$;

-- ============================================================================
-- ROLLBACK
--
-- Grátis enquanto `deals` tiver 0 linhas: nenhuma linha muda de visibilidade,
-- só o catálogo. Restaura o estado medido em prod em 2026-07-30 — inclusive os
-- defeitos (primeira-org, master read-only, grant de anon). Só faz sentido se o
-- predicado novo quebrar algum caminho que ninguém previu; a correção certa
-- nesse caso é ajustar o predicado, não voltar pra get_user_organization_id().
--
--   DROP POLICY IF EXISTS "deals_select" ON public.deals;
--   DROP POLICY IF EXISTS "deals_insert" ON public.deals;
--   DROP POLICY IF EXISTS "deals_update" ON public.deals;
--   DROP POLICY IF EXISTS "deals_delete" ON public.deals;
--
--   CREATE POLICY "deals_select" ON public.deals FOR SELECT
--     USING ((organization_id = (SELECT public.get_user_organization_id())) AND (deleted_at IS NULL));
--   CREATE POLICY "deals_insert" ON public.deals FOR INSERT
--     WITH CHECK (organization_id = (SELECT public.get_user_organization_id()));
--   CREATE POLICY "deals_update" ON public.deals FOR UPDATE
--     USING (organization_id = (SELECT public.get_user_organization_id()));
--   CREATE POLICY "deals_delete" ON public.deals FOR DELETE
--     USING (organization_id = (SELECT public.get_user_organization_id()));
--   CREATE POLICY "master_select_all_deals" ON public.deals FOR SELECT TO authenticated
--     USING ((SELECT public.is_master_user()));
--   COMMENT ON POLICY "master_select_all_deals" ON public.deals IS
--     'Ghost master le esta tabela em qualquer org. Espelha master_select_all_leads. Escopo de org e feito pela query da app (.eq organization_id).';
--
--   -- ACL medido: `anon=rxtm/postgres`. `MAINTAIN` (o `m`) faz parte do estado
--   -- de prod e está literal em `20260101000000_baseline_prod_schema.sql:44961`;
--   -- sem ele o rollback deixaria um quarto estado e um `db diff` futuro
--   -- acusaria drift de ACL sem causa aparente.
--   GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON public.deals TO anon;
-- ============================================================================
