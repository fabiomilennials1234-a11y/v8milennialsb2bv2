-- 20261114000000_fix_view_rls_bypass_security_invoker.sql
--
-- INCIDENTE DE SEGURANÇA 2026-06-01 — vazamento cross-tenant (e anônimo) de PII via views.
--
-- Root cause: views públicas owned by `postgres` criadas SEM `security_invoker=on`
-- (default => semântica DEFINER => executam como o dono => BYPASSAM a RLS das tabelas-base).
-- Com GRANT SELECT a `authenticated` (e `anon` em algumas), qualquer usuário logado — e em
-- parte qualquer requisição anônima com a anon key pública — lia dados de TODAS as orgs.
-- Verificado em prod: como admin de 1 org, `pipe_whatsapp` retornava 7.587 linhas / 36 orgs
-- (vs 15/1 esperado); `leads_compat` (anon) expunha 14.452 leads / 41 orgs.
--
-- Tabelas-base (leads, pipeline_entries, channel_messages, emails, pipelines) sempre tiveram
-- RLS correta. O furo eram só as views.
--
-- Fix:
--   (1) Forçar security_invoker=on nas views vivas => respeitam a RLS do chamador.
--   (2) Revogar TODO acesso de `anon` nessas views.
--   (3) Dropar as views *_compat órfãs (0 uso runtime; 0 dependentes em prod).
--
-- Guards relkind='v': no dev as pipe_* existem como TABLES (drift estrutural conhecido),
-- então o bloco é no-op seguro lá. Idempotente. (Efeito já aplicado out-of-band no prod
-- durante a resposta ao incidente; esta migration é o registro versionado.)

DO $$
DECLARE
  v text;
  secure_views text[] := ARRAY[
    'pipe_whatsapp', 'pipe_confirmacao', 'pipe_propostas',
    'leads_compat', 'unified_inbox_messages',
    'portfolio_retention_cohorts', 'v_cron_job_status'
  ];
BEGIN
  FOREACH v IN ARRAY secure_views LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = v AND c.relkind = 'v'
    ) THEN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = on)', v);
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', v);
      RAISE NOTICE 'secured view %', v;
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  v text;
  orphan_views text[] := ARRAY[
    'pipe_whatsapp_compat', 'pipe_confirmacao_compat', 'pipe_propostas_compat'
  ];
BEGIN
  FOREACH v IN ARRAY orphan_views LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = v AND c.relkind = 'v'
    ) THEN
      EXECUTE format('DROP VIEW public.%I', v);
      RAISE NOTICE 'dropped orphan view %', v;
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'v'
    AND c.relname IN ('pipe_whatsapp','pipe_confirmacao','pipe_propostas',
                      'leads_compat','unified_inbox_messages',
                      'portfolio_retention_cohorts','v_cron_job_status')
    AND COALESCE((SELECT option_value FROM pg_options_to_table(c.reloptions)
                  WHERE option_name = 'security_invoker'), 'off') <> 'true';
  IF bad > 0 THEN
    RAISE WARNING 'ATENCAO: % views alvo ainda sem security_invoker', bad;
  END IF;
END $$;
