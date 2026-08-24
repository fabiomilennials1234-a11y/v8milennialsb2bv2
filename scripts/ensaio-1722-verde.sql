-- ═══════════════════════════════════════════════════════════════════════════
-- ENSAIO 1721+1722 — VERDE: as duas migrations acabaram de rodar acima.
-- Toda asserção que falhar aborta a transação antes do ROLLBACK final — o que
-- é seguro, porque abortar também não aplica nada.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. O que o #1721 tinha de trazer ──────────────────────────────────────
DO $$
DECLARE faltando TEXT := '';
BEGIN
  FOREACH faltando IN ARRAY ARRAY['sent_at','delivered_at','claimed_at',
                                  'provider_message_id','estimated_cost','actual_cost']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='blast_plan_recipients'
                     AND column_name=faltando) THEN
      RAISE EXCEPTION 'VERDE FALHOU: coluna % do #1721 não existe', faltando;
    END IF;
  END LOOP;
  RAISE NOTICE 'verde OK: as 6 colunas do #1721 existem';
END $$;

-- delivered e unconfirmed passam a ser aceitos; um valor inventado continua não.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.blast_plan_recipients (plan_id, status)
    SELECT id, 'delivered' FROM public.blast_plans LIMIT 1;
    RAISE EXCEPTION 'sonda_ok';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'sonda_ok' THEN RAISE; END IF;
      RAISE NOTICE 'verde OK: delivered aceito';
    WHEN check_violation THEN
      RAISE EXCEPTION 'VERDE FALHOU: delivered ainda estoura depois da migration';
  END;

  BEGIN
    INSERT INTO public.blast_plan_recipients (plan_id, status)
    SELECT id, 'estado_que_nao_existe' FROM public.blast_plans LIMIT 1;
    RAISE EXCEPTION 'VERDE FALHOU: o CHECK aceitou um estado inventado — virou peneira';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'verde OK: o CHECK continua fechado para valor inventado';
  END;
END $$;

-- ─── 2. O que o #1722 tinha de trazer ──────────────────────────────────────
DO $$
DECLARE d TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='blast_plans'
                   AND column_name='template' AND data_type='jsonb') THEN
    RAISE EXCEPTION 'VERDE FALHOU: blast_plans.template ausente ou não é jsonb';
  END IF;

  SELECT indexdef INTO d FROM pg_indexes
   WHERE schemaname='public' AND indexname='idx_blast_plan_recipients_claim';
  IF d IS NULL THEN
    RAISE EXCEPTION 'VERDE FALHOU: idx_blast_plan_recipients_claim não existe';
  END IF;
  IF d NOT LIKE '%status = ''pending''%' OR d NOT LIKE '%claimed_at IS NULL%' THEN
    RAISE EXCEPTION 'VERDE FALHOU: o predicado do índice não é o esperado: %', d;
  END IF;
  RAISE NOTICE 'verde OK: template jsonb e índice parcial do claim com o predicado certo';
END $$;

-- ─── 3. As duas funções: DEFINER, search_path fixo, assinatura única ───────
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT p.proname, p.prosecdef, p.proconfig, count(*) OVER (PARTITION BY p.proname) AS sigs
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname='public'
              AND p.proname IN ('claim_blast_recipients','invoke_process_blast_recipients')
  LOOP
    IF NOT r.prosecdef THEN
      RAISE EXCEPTION 'VERDE FALHOU: % não é SECURITY DEFINER', r.proname;
    END IF;
    IF r.proconfig IS NULL OR NOT (r.proconfig @> ARRAY['search_path=public']) THEN
      RAISE EXCEPTION 'VERDE FALHOU: % sem search_path=public fixo (proconfig=%)', r.proname, r.proconfig;
    END IF;
    IF r.sigs <> 1 THEN
      RAISE EXCEPTION 'VERDE FALHOU: % tem % assinaturas — sobrecarga faz o PostgREST devolver PGRST202', r.proname, r.sigs;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname IN ('claim_blast_recipients','invoke_process_blast_recipients')) <> 2 THEN
    RAISE EXCEPTION 'VERDE FALHOU: esperava as 2 funções';
  END IF;
  RAISE NOTICE 'verde OK: as 2 funções são DEFINER, com search_path fixo e assinatura única';
END $$;

-- ─── 4. GRANTS — o item que a migration verde NÃO substitui ────────────────
-- claim_blast_recipients devolve destinatários de TODAS as organizações por
-- desenho. Grant aberto aqui é vazamento cross-tenant, não inconveniência.
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.claim_blast_recipients(int,int)', 'EXECUTE')
  OR has_function_privilege('authenticated', 'public.claim_blast_recipients(int,int)', 'EXECUTE')
  OR has_function_privilege('anon', 'public.invoke_process_blast_recipients()', 'EXECUTE')
  OR has_function_privilege('authenticated', 'public.invoke_process_blast_recipients()', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERDE FALHOU — VAZAMENTO CROSS-TENANT: anon ou authenticated alcança o claim';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.claim_blast_recipients(int,int)', 'EXECUTE')
  OR NOT has_function_privilege('service_role', 'public.invoke_process_blast_recipients()', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERDE FALHOU: service_role NÃO alcança — o worker não roda';
  END IF;
  RAISE NOTICE 'verde OK: anon=false authenticated=false service_role=true nas duas';
END $$;

-- ─── 5. O cron: uma vez só, com o agendamento versionado ───────────────────
DO $$
DECLARE n INT; s TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    RAISE NOTICE 'verde N/A: pg_cron ausente neste alvo — a migration pula o bloco de propósito';
  ELSE
    SELECT count(*), max(schedule) INTO n, s FROM cron.job WHERE jobname='process-blast-recipients';
    IF n <> 1 THEN RAISE EXCEPTION 'VERDE FALHOU: job do cron aparece % vezes', n; END IF;
    IF s <> '* * * * *' THEN RAISE EXCEPTION 'VERDE FALHOU: agendamento é %, esperado * * * * *', s; END IF;
    RAISE NOTICE 'verde OK: cron agendado uma vez, a cada minuto';
  END IF;
END $$;

-- ─── 6. NADA MUDOU nos dados ───────────────────────────────────────────────
DO $$
DECLARE a RECORD; p BIGINT; d BIGINT; nulos BIGINT; div BIGINT;
BEGIN
  SELECT * INTO a FROM _antes;
  SELECT count(*) INTO p FROM public.blast_plans;
  SELECT count(*) INTO d FROM public.blast_plan_recipients;
  IF p <> a.planos       THEN RAISE EXCEPTION 'VERDE FALHOU: blast_plans % -> %', a.planos, p; END IF;
  IF d <> a.destinatarios THEN RAISE EXCEPTION 'VERDE FALHOU: destinatários % -> %', a.destinatarios, d; END IF;

  SELECT count(*) INTO div FROM (
    SELECT status, count(*) n FROM public.blast_plan_recipients GROUP BY status
    EXCEPT SELECT status, n FROM _antes_dist
  ) x;
  IF div > 0 THEN RAISE EXCEPTION 'VERDE FALHOU: a distribuição por status mudou'; END IF;

  SELECT count(*) INTO nulos FROM public.blast_plan_recipients
   WHERE claimed_at IS NOT NULL OR provider_message_id IS NOT NULL
      OR sent_at IS NOT NULL OR delivered_at IS NOT NULL;
  IF nulos > 0 THEN
    RAISE EXCEPTION 'VERDE FALHOU: % linhas pré-existentes nasceram com coluna nova preenchida', nulos;
  END IF;

  IF EXISTS (SELECT 1 FROM public.blast_plans WHERE template IS NOT NULL) THEN
    RAISE EXCEPTION 'VERDE FALHOU: plano pré-existente nasceu com template preenchido';
  END IF;

  RAISE NOTICE 'verde OK: % planos e % destinatários intactos, colunas novas todas NULL', p, d;
END $$;

-- ─── 7. Os índices antigos, literais e inalterados ─────────────────────────
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM _antes_idx a
   WHERE NOT EXISTS (SELECT 1 FROM pg_indexes i
                      WHERE i.schemaname='public' AND i.indexname=a.indexname
                        AND i.indexdef = a.indexdef);
  IF n > 0 THEN RAISE EXCEPTION 'VERDE FALHOU: % índice(s) pré-existente(s) mudaram de definição', n; END IF;
  RAISE NOTICE 'verde OK: todos os índices anteriores intactos, comparados por pg_get_indexdef literal';
END $$;
