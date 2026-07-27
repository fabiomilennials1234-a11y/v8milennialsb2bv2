-- ============================================================================
-- Limpeza dos overloads defasados que causam ERROR 42725 "is not unique".
--
-- Mesma patologia da 20270215000000 (aba Saúde / get_funnel_health): uma RPC
-- ganhou parâmetro novo com DEFAULT, mas o CREATE OR REPLACE não substituiu a
-- assinatura antiga — criou um OVERLOAD ao lado dela. Aí toda chamada que usa a
-- aridade menor vira ambígua e o Postgres recusa:
--
--   ERROR 42725: function ... is not unique
--   HINT: Could not choose a best candidate function.
--
-- Confirmado empiricamente em PROD com EXPLAIN (resolve no parse, não executa):
--   claim_copilot_batch(unknown)          -> 42725
--   get_phone_ai_status(unknown)          -> 42725
--   toggle_phone_ai(unknown, boolean)     -> 42725
--
-- ── 1. claim_copilot_batch — ÚNICO com impacto vivo ─────────────────────────
-- supabase/functions/agent-message/batch-helpers.ts:54 chama com p_batch_key só.
-- Pior: descarta o erro (`const { data: claimed } = ...`, sem `error`), então
-- `claimed` volta vazio, o break da linha 57 dispara e o loop de absorção
-- (agent-message/index.ts:451) morre na 1ª iteração — sempre, sem log.
-- Efeito: mensagens que chegam enquanto a IA pensa não entram no mesmo turno.
-- Não se perdem (copilot-batch-processor chama com 2 params e drena a fila),
-- mas a IA responde fragmentado em vez de consolidar.
-- O corpo de 1 arg é pior: não grava claimed_at, ignora next_attempt_at e não
-- reclama lease vencido.
--
-- ── 2/3. get_phone_ai_status e toggle_phone_ai — latentes ───────────────────
-- Os callers ambíguos (useLeads.ts:774 e :811) estão em usePhoneAiStatus e
-- useToggleConversationAI, que hoje NÃO têm consumidor vivo (só aparecem em
-- comentário de doc do useCopilotToggle.ts). O caminho vivo do toggle passa pelo
-- useCopilotToggle, que manda a org explícita e escapa da ambiguidade.
-- Removidos assim mesmo: são bomba-relógio pra quem religar esses hooks.
-- Seguro porque as versões canônicas tratam org NULL — derivam de team_members.
--
-- DROP sem CASCADE de propósito: se algo depender, a migration falha em vez de
-- derrubar o dependente junto.
-- Idempotente. Cada drop é guardado pela existência da assinatura canônica.
-- ============================================================================

DO $$
DECLARE
  r record;
  v_canonica int;
  v_velha    int;
  v_removidos int := 0;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('claim_copilot_batch',
       'p_batch_key text, p_lease_seconds integer',
       'p_batch_key text',
       'public.claim_copilot_batch(text)'),
      ('get_phone_ai_status',
       'p_phone text, p_organization_id uuid',
       'p_phone text',
       'public.get_phone_ai_status(text)'),
      ('toggle_phone_ai',
       'p_phone text, p_disabled boolean, p_organization_id uuid',
       'p_phone text, p_disabled boolean',
       'public.toggle_phone_ai(text, boolean)')
    ) AS t(fn, args_canonica, args_velha, drop_target)
  LOOP
    SELECT count(*) INTO v_canonica
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = r.fn
      AND pg_get_function_identity_arguments(p.oid) = r.args_canonica;

    SELECT count(*) INTO v_velha
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = r.fn
      AND pg_get_function_identity_arguments(p.oid) = r.args_velha;

    IF v_canonica = 0 THEN
      RAISE EXCEPTION
        'ABORTADO: assinatura canônica %(%) não existe. Dropar a antiga deixaria os callers sem RPC.',
        r.fn, r.args_canonica;
    END IF;

    IF v_velha = 0 THEN
      RAISE NOTICE 'No-op: %(%) já não existe.', r.fn, r.args_velha;
    ELSE
      EXECUTE format('DROP FUNCTION %s', r.drop_target);
      v_removidos := v_removidos + 1;
      RAISE NOTICE 'Removido overload defasado %(%).', r.fn, r.args_velha;
    END IF;
  END LOOP;

  RAISE NOTICE '% overload(s) defasado(s) removido(s).', v_removidos;
END$$;

-- ── Verificação: cada uma dessas RPCs tem assinatura única ──────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.proname, count(*) AS n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('claim_copilot_batch', 'get_phone_ai_status', 'toggle_phone_ai')
    GROUP BY p.proname
  LOOP
    IF r.n <> 1 THEN
      RAISE EXCEPTION 'FAIL: % ainda tem % assinaturas (esperava 1).', r.proname, r.n;
    END IF;
  END LOOP;

  RAISE NOTICE 'VALIDATION PASSED: as 3 RPCs com assinatura única.';
END$$;
