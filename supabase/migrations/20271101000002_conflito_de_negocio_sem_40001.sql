-- Conflito de negócio é resposta HTTP definitiva, nunca `40001`.
--
-- INCIDENTE 2026-10-01 (13:56 → 17:58 UTC). `editar_valor_proposta` recusava ficha
-- desatualizada com `ERRCODE = '40001'` (serialization_failure). O PostgREST
-- (hasql-transaction) trata `40001` como falha transitória e REPETE A TRANSAÇÃO
-- SEM LIMITE, no mesmo backend, a cada ~5 ms. Como a ficha continua velha, o erro
-- volta sempre: um clique virou um laço eterno. Dois cliques simultâneos ocuparam
-- os 2 vCPU do compute SMALL a 100% por 4 h, com 1,35 milhão de ERROR no log;
-- auth, PostgREST, realtime e cron enfileiraram, o gateway passou a devolver 522
-- e o app ficou parado na tela de abertura. Só parou com `pg_terminate_backend`.
--
-- O mesmo defeito já tinha sido medido e corrigido no Oráculo
-- (20271019144201_oraculo_conflito_http.sql: "40001 não completou em 20 s; PT409
-- devolveu conflito em 142 ms") e em `set_workflow_data_grant`, mas o padrão
-- continuou sendo copiado. `PT409` faz o PostgREST responder HTTP 409 na hora;
-- o front já lê `PTxxx` como status (to-app-error.ts) e 409 como `conflict.stale`.
--
-- POR QUE REESCREVER A DEFINIÇÃO VIVA, E NÃO COLAR O CORPO DO REPO
-- O ledger já mentiu sobre funções de prod (corpo de prod mais velho ou mais novo
-- que o repo). Recriar a partir do repo poderia reverter algo em silêncio. Aqui a
-- fonte é `pg_get_functiondef` do próprio banco, e a única mudança é o código do
-- erro. `CREATE OR REPLACE` preserva dono, ACL, SECURITY DEFINER/INVOKER e
-- `search_path` (todos fazem parte da definição ou do catálogo, não do texto).
--
-- POR QUE VARRER, E NÃO LISTAR
-- Uma lista por nome já nasceria incompleta: `toth_order_private.preorder_lease`
-- levanta `40001` num schema privado e é chamada pelas RPCs públicas. O invariante
-- é "nenhuma função da aplicação levanta 40001 à mão"; a varredura o impõe e a
-- asserção final prova. Um `40001` legítimo (o Postgres abortando por
-- serialização real) não passa por `RAISE`, então não é tocado.
--
-- Funções afetadas no repo (definição mais recente): editar_valor_proposta,
-- bulk_move_pipeline_entries, ajustar_pedido_ganho, toth_save_order_draft,
-- toth_review_order_draft, toth_request_order_send, toth_mark_preorder_sending,
-- toth_order_private.preorder_lease, set_whatsapp_ingress_worker_pause,
-- set_whatsapp_edge_execution_mode, requeue_whatsapp_ingress_file_download.
--
-- Só schema. Idempotente: rodar de novo não encontra nada e não muda nada.

DO $$
DECLARE
  -- Só `RAISE ... USING ERRCODE = '40001'` (ou o nome da condição). Comparações
  -- de SQLSTATE em handlers (`WHEN serialization_failure`, `SQLSTATE '40001'`)
  -- ficam como estão: tratar serialização real continua correto.
  v_pattern constant text := '(ERRCODE\s*=\s*)''(40001|serialization_failure)''';
  v_fn record;
  v_def text;
  v_new text;
  v_count int := 0;
BEGIN
  FOR v_fn IN
    SELECT p.oid, n.nspname, p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.prokind = 'f'
       AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
       AND p.prosrc ~* v_pattern
       AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'extensions', 'auth', 'storage',
                             'realtime', 'graphql', 'graphql_public', 'vault', 'cron', 'net',
                             'pgsodium', 'pgsodium_masks', 'supabase_functions', 'supabase_migrations')
       AND n.nspname NOT LIKE 'pg\_%'
       -- Função de extensão pertence à extensão; não é nossa para reescrever.
       AND NOT EXISTS (SELECT 1 FROM pg_depend d
                        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
     ORDER BY n.nspname, p.proname
  LOOP
    v_def := pg_get_functiondef(v_fn.oid);
    v_new := regexp_replace(v_def, v_pattern, '\1''PT409''', 'gi');
    IF v_new = v_def THEN
      RAISE EXCEPTION 'prosrc casou mas a definição não mudou: %.%', v_fn.nspname, v_fn.proname;
    END IF;
    EXECUTE v_new;
    v_count := v_count + 1;
    RAISE NOTICE 'conflito 40001 -> PT409: %.%', v_fn.nspname, v_fn.proname;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
       AND p.prosrc ~* v_pattern
       AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'extensions', 'auth', 'storage',
                             'realtime', 'graphql', 'graphql_public', 'vault', 'cron', 'net',
                             'pgsodium', 'pgsodium_masks', 'supabase_functions', 'supabase_migrations')
       AND n.nspname NOT LIKE 'pg\_%'
       AND NOT EXISTS (SELECT 1 FROM pg_depend d
                        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
  ) THEN
    RAISE EXCEPTION 'ainda há função da aplicação levantando 40001';
  END IF;

  RAISE NOTICE 'funções corrigidas: %', v_count;
END
$$;
