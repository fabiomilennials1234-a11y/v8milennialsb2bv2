-- ============================================================================
-- `deals`: escopo de org multi-org + ramo de master na RLS.
--
-- Fatia 2 da separação Lead ↔ Negócio vai ACENDER esta tabela (hoje 0 linhas,
-- nenhum `from('deals')` no front, nenhuma edge function escrevendo). Enquanto
-- ela está vazia, consertar a RLS custa zero. Depois do primeiro negócio real,
-- custa incidente.
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
--       que o comando precisa ler a linha existente (Table 5.1, nota [a] de
--       `ddl-rowsecurity`: "if read access is required to the existing or new row
--       — for example, a WHERE or RETURNING clause that refers to columns from
--       the relation"). O PostgREST SEMPRE emite `WHERE`. Ou seja: `deals_select`
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
-- O `WITH CHECK` de `deals_update` fica **sem** a guarda de propósito — é a
-- única divergência de `leads` NESTA dimensão (lá o `WITH CHECK` é omitido, então
-- o Postgres reusa o `USING`, guarda inclusa). Assim a transição visível→lixeira
-- (`SET deleted_at = now()`) continua possível por UPDATE direto, caso a Fatia 2
-- mande o soft-delete de negócio pelo PostgREST antes de existir uma RPC
-- equivalente à `bulk_delete_leads`. Mexer em linha que JÁ está na lixeira, não.
--
-- Blast radius de acrescentar a guarda agora: zero — 0 linhas na tabela, zero
-- `.from('deals')` no front, e os três triggers que escrevem em `deals`
-- (`fn_sync_deal_value_from_items`, `fn_deal_won_populate_lead_products`,
-- `update_updated_at`) são SECURITY DEFINER owned by `postgres`. Custo hoje: uma
-- linha em cada policy. Depois do apply, migration é imutável.
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
    organization_id IN (SELECT public.get_my_organization_ids())
    OR (SELECT public.is_master_user())
  );

COMMENT ON POLICY "deals_update" ON public.deals IS
  'USING = negocio VIVO dentro do escopo (guarda de soft-delete igual leads_update_by_responsibility_and_permissions; restaurar e RPC SECURITY DEFINER, nao UPDATE direto). WITH CHECK sem a guarda de proposito: permite a transicao visivel->lixeira. WITH CHECK explicito e legibilidade: o Postgres ja reusa USING quando ele e omitido.';

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

  -- 4c-bis. E a guarda NÃO pode estar no `WITH CHECK` do UPDATE: com ela, gravar
  --     `deleted_at = now()` (soft-delete por UPDATE direto) viraria violação de
  --     RLS. A assimetria é deliberada — ver cabeçalho.
  SELECT with_check INTO v_qual
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'deals' AND policyname = 'deals_update';
  IF v_qual IS NULL OR v_qual LIKE '%deleted_at IS NULL%' THEN
    RAISE EXCEPTION 'FAIL: WITH CHECK de deals_update ausente ou com a guarda de soft-delete — mandar negocio para a lixeira por UPDATE ficaria impossivel.';
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
  --     O que 4e (catálogo) não pega: grant em COLUNA. `SELECT 1 FROM deals`
  --     funciona com privilégio de UMA coluna, enquanto
  --     `has_table_privilege(...,'SELECT')` continua false. A tentativa real
  --     fecha esse vão.
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

  RAISE NOTICE 'VALIDATION PASSED: 4 policies org-scoped com ramo de master, soft-delete guardado em SELECT/UPDATE/DELETE, anon sem grant.';
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
